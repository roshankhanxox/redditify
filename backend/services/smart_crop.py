"""
Active-speaker smart crop for clip segments.

Pipeline (adapted from Junhua-Liao/LR-ASD, device-agnostic):
  1. Read all frames from the clip video
  2. S3FD face detection per frame  → bounding boxes
  3. IoU face tracking              → continuous face tracks
  4. TalkNet ASD scoring            → speaking probability per track/frame
  5. Smooth scores (median filter)  → stable crop target
  6. Write 9:16 output via cv2.VideoWriter (crop or resize+blur mode)
  7. Mux original audio back via FFmpeg
"""

from __future__ import annotations

import logging
import math
import os
import shutil
import subprocess
import sys
import tempfile

import cv2
import numpy as np
from scipy import signal
from scipy.interpolate import interp1d

import torch

logger = logging.getLogger(__name__)

_VENDOR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "vendor", "lrasd"))
_WEIGHT = os.path.join(_VENDOR, "weight", "pretrain_AVA.model")
_S3FD_WEIGHT = os.path.join(_VENDOR, "model", "faceDetector", "s3fd", "sfd_face.pth")
_S3FD_GDRIVE_ID = "1KafnHz7ccT-3IyddBsL5yi2xGtxAKypt"


# ── device ───────────────────────────────────────────────────────────────────

def _device() -> torch.device:
    if torch.cuda.is_available():
        return torch.device("cuda")
    if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        return torch.device("mps")
    return torch.device("cpu")


# ── weights download ──────────────────────────────────────────────────────────

def _ensure_s3fd():
    if os.path.isfile(_S3FD_WEIGHT):
        return
    logger.info("Downloading S3FD weights (~50 MB)…")
    try:
        import gdown
    except ImportError:
        raise RuntimeError("gdown not installed — run: pip install gdown")
    gdown.download(id=_S3FD_GDRIVE_ID, output=_S3FD_WEIGHT, quiet=False)
    if not os.path.isfile(_S3FD_WEIGHT):
        raise RuntimeError("S3FD weight download failed")


# ── face detection ────────────────────────────────────────────────────────────

def _detect_faces(frames: list[np.ndarray], dev: torch.device, scale: float = 0.25) -> list[list[dict]]:
    """Run S3FD on every frame. Returns dets[frame_idx] = [{frame, bbox, conf}]."""
    _ensure_s3fd()
    if _VENDOR not in sys.path:
        sys.path.insert(0, _VENDOR)

    # s3fd/__init__.py uses os.getcwd() to build its weight path — must run from _VENDOR
    old_cwd = os.getcwd()
    os.chdir(_VENDOR)
    try:
        from model.faceDetector.s3fd import S3FD  # type: ignore
        detector = S3FD(device=str(dev))
    finally:
        os.chdir(old_cwd)
    dets: list[list[dict]] = []
    for fidx, frame in enumerate(frames):
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        bboxes = detector.detect_faces(rgb, conf_th=0.9, scales=[scale])
        dets.append([
            {"frame": fidx, "bbox": bbox[:-1].tolist(), "conf": float(bbox[-1])}
            for bbox in bboxes
        ])
    logger.debug("_detect_faces: %d frames, total dets=%d", len(frames), sum(len(d) for d in dets))
    return dets


# ── face tracking ─────────────────────────────────────────────────────────────

def _iou(a: list, b: list) -> float:
    xA, yA = max(a[0], b[0]), max(a[1], b[1])
    xB, yB = min(a[2], b[2]), min(a[3], b[3])
    inter = max(0.0, xB - xA) * max(0.0, yB - yA)
    aA = (a[2] - a[0]) * (a[3] - a[1])
    aB = (b[2] - b[0]) * (b[3] - b[1])
    return inter / max(float(aA + aB - inter), 1e-6)


def _track_faces(
    dets: list[list[dict]],
    min_track: int = 10,
    max_missed: int = 10,
    min_size: int = 1,
) -> list[dict]:
    """IoU-based greedy face tracker. Returns list of tracks with interpolated bboxes."""
    import copy
    pool = copy.deepcopy(dets)
    tracks: list[dict] = []
    while True:
        track: list[dict] = []
        for frame_faces in pool:
            for face in list(frame_faces):
                if not track:
                    track.append(face)
                    frame_faces.remove(face)
                elif face["frame"] - track[-1]["frame"] <= max_missed:
                    if _iou(face["bbox"], track[-1]["bbox"]) > 0.5:
                        track.append(face)
                        frame_faces.remove(face)
                        break
                else:
                    break
        if not track:
            break
        if len(track) <= min_track:
            continue
        frames_arr = np.array([f["frame"] for f in track])
        bboxes_arr = np.array([f["bbox"] for f in track])
        frames_i = np.arange(frames_arr[0], frames_arr[-1] + 1)
        bboxes_i = np.stack(
            [interp1d(frames_arr, bboxes_arr[:, j])(frames_i) for j in range(4)],
            axis=1,
        )
        w_mean = np.mean(bboxes_i[:, 2] - bboxes_i[:, 0])
        h_mean = np.mean(bboxes_i[:, 3] - bboxes_i[:, 1])
        if max(w_mean, h_mean) > min_size:
            tracks.append({"frame": frames_i, "bbox": bboxes_i})
    logger.debug("_track_faces: %d tracks", len(tracks))
    return tracks


# ── ASD scoring ───────────────────────────────────────────────────────────────

def _load_asd_model(dev: torch.device):
    if _VENDOR not in sys.path:
        sys.path.insert(0, _VENDOR)
    from model.Model import ASD_Model  # type: ignore
    from loss import lossAV  # type: ignore

    model = ASD_Model().to(dev)
    loss_fn = lossAV().to(dev)

    raw = torch.load(_WEIGHT, map_location=dev)
    model_sd = {k[len("model."):]: v for k, v in raw.items() if k.startswith("model.")}
    loss_sd  = {k[len("lossAV."):]: v for k, v in raw.items() if k.startswith("lossAV.")}
    model.load_state_dict(model_sd, strict=False)
    loss_fn.load_state_dict(loss_sd, strict=False)
    model.eval()
    loss_fn.eval()
    return model, loss_fn


_MODEL_FPS = 25  # TalkNet was trained at 25 fps — audio encoder halves T twice (100→25)


def _score_tracks(
    tracks: list[dict],
    frames: list[np.ndarray],
    audio_path: str,
    dev: torch.device,
    tmp_dir: str,
    crop_scale: float = 0.40,
) -> list[list[float]]:
    """Run TalkNet inference on each face track. Returns scores[track][frame].

    frames must already be subsampled to _MODEL_FPS (25 fps).
    """
    try:
        import python_speech_features  # type: ignore
        from scipy.io import wavfile
    except ImportError:
        raise RuntimeError("python_speech_features not installed — run: pip install python_speech_features")

    # Resample audio to 16 kHz mono WAV
    wav16 = os.path.join(tmp_dir, "audio_16k.wav")
    subprocess.run(
        ["ffmpeg", "-y", "-i", audio_path, "-ac", "1", "-ar", "16000", wav16],
        capture_output=True, check=True,
    )
    sr, audio_data = wavfile.read(wav16)

    model, loss_fn = _load_asd_model(dev)
    duration_set = [1, 1, 1, 2, 2, 2, 3, 3, 4, 5, 6]
    fps_int = _MODEL_FPS  # hardcoded — model assumes 25 fps video
    all_scores: list[list[float]] = []

    for track in tracks:
        # Crop face thumbnails (112×112 greyscale) for each frame in track
        crops: list[np.ndarray] = []
        for fidx, fi in enumerate(track["frame"]):
            fi = int(fi)
            if fi >= len(frames):
                continue
            b = track["bbox"][fidx]
            cx, cy = (b[0] + b[2]) / 2, (b[1] + b[3]) / 2
            bsize = max(b[2] - b[0], b[3] - b[1]) / 2
            cs = crop_scale
            bsi = int(bsize * (1 + 2 * cs))
            padded = np.pad(frames[fi], ((bsi, bsi), (bsi, bsi), (0, 0)), constant_values=110)
            my, mx = cy + bsi, cx + bsi
            face = padded[
                int(my - bsize): int(my + bsize * (1 + 2 * cs)),
                int(mx - bsize * (1 + cs)): int(mx + bsize * (1 + cs)),
            ]
            if face.size == 0:
                face = np.zeros((224, 224, 3), dtype=np.uint8)
            gray = cv2.cvtColor(cv2.resize(face, (224, 224)), cv2.COLOR_BGR2GRAY)
            crops.append(gray[56:168, 56:168])  # centre 112×112

        if not crops:
            all_scores.append([0.0] * len(track["frame"]))
            continue

        video_feat = np.array(crops, dtype=np.float32)  # (T, 112, 112)

        # Align audio segment (frames are at MODEL_FPS = 25)
        t0 = int(track["frame"][0]) / fps_int
        t1 = (int(track["frame"][-1]) + 1) / fps_int
        seg = audio_data[int(t0 * sr): int(t1 * sr)].astype(np.float32)
        if seg.size == 0:
            all_scores.append([0.0] * len(track["frame"]))
            continue
        audio_feat = python_speech_features.mfcc(
            seg, sr, numcep=13, winlen=0.025, winstep=0.010,
        )  # (N, 13)

        length = min(
            (audio_feat.shape[0] - audio_feat.shape[0] % 4) / 100.0,
            video_feat.shape[0] / fps_int,
        )
        audio_feat = audio_feat[: int(round(length * 100)), :]
        video_feat = video_feat[: int(round(length * fps_int)), :, :]

        track_scores: list[list[float]] = []
        for dur in duration_set:
            n_batches = max(1, int(math.ceil(length / dur)))
            scores: list[float] = []
            with torch.no_grad():
                for i in range(n_batches):
                    a_sl = audio_feat[i * dur * 100: (i + 1) * dur * 100, :]
                    v_sl = video_feat[i * dur * fps_int: (i + 1) * dur * fps_int, :, :]
                    # Skip empty or incomplete tail batches — incomplete slices produce
                    # mismatched temporal dims after the audio/visual encoders
                    if a_sl.shape[0] < dur * 100 or v_sl.shape[0] < dur * fps_int:
                        continue
                    iA = torch.FloatTensor(a_sl).unsqueeze(0).to(dev)
                    iV = torch.FloatTensor(v_sl).unsqueeze(0).to(dev)
                    eA = model.forward_audio_frontend(iA)
                    eV = model.forward_visual_frontend(iV)
                    out = model.forward_audio_visual_backend(eA, eV)
                    sc = loss_fn.forward(out, labels=None)
                    scores.extend([float(s) for s in sc])
            track_scores.append(scores)

        if not track_scores:
            all_scores.append([0.0] * len(track["frame"]))
            continue

        min_len = min(len(s) for s in track_scores)
        mean = np.round(np.mean([s[:min_len] for s in track_scores], axis=0), 1)
        all_scores.append(mean.tolist())

    return all_scores


# ── per-frame crop map ────────────────────────────────────────────────────────

def _build_crop_map(
    tracks: list[dict],
    scores: list[list[float]],
    n_frames: int,
    smooth_window: int = 30,
) -> list[tuple[float | None, float | None]]:
    """
    For each frame return (cx, cy) of the speaking face.
    None means no face detected — caller should use frame centre.
    """
    per_frame: list[list[dict]] = [[] for _ in range(n_frames)]
    for tidx, track in enumerate(tracks):
        track_sc = scores[tidx]
        for fidx, fi in enumerate(track["frame"]):
            fi = int(fi)
            if fi >= n_frames:
                continue
            b = track["bbox"][fidx]
            sc = float(track_sc[fidx]) if fidx < len(track_sc) else 0.0
            per_frame[fi].append({
                "score": sc,
                "cx": (b[0] + b[2]) / 2,
                "cy": (b[1] + b[3]) / 2,
            })

    raw_cx: list[float | None] = []
    raw_cy: list[float | None] = []
    last_cx: float | None = None
    last_cy: float | None = None

    for faces in per_frame:
        if faces:
            best = max(faces, key=lambda f: f["score"])
            last_cx, last_cy = best["cx"], best["cy"]
        raw_cx.append(last_cx)
        raw_cy.append(last_cy)

    # If no face at all, return all None
    if all(v is None for v in raw_cx):
        return [(None, None)] * n_frames

    # Fill leading Nones with first valid value
    first = next(i for i, v in enumerate(raw_cx) if v is not None)
    for i in range(first):
        raw_cx[i] = raw_cx[first]
        raw_cy[i] = raw_cy[first]

    # Median-filter to smooth crop movement (kernel must be odd)
    k = max(3, smooth_window | 1)
    cx_s = signal.medfilt(np.array(raw_cx, dtype=float), kernel_size=k)
    cy_s = signal.medfilt(np.array(raw_cy, dtype=float), kernel_size=k)
    return list(zip(cx_s.tolist(), cy_s.tolist()))


# ── frame rendering ───────────────────────────────────────────────────────────

def _render_crop(frame: np.ndarray, cx: float, cy: float, tw: int, th: int) -> np.ndarray:
    fh, fw = frame.shape[:2]
    crop_h = fh
    crop_w = int(crop_h * tw / th)
    if crop_w > fw:
        crop_w = fw
        crop_h = int(crop_w * th / tw)
    x1 = max(0, min(int(cx - crop_w / 2), fw - crop_w))
    y1 = max(0, min(int(cy - crop_h / 2), fh - crop_h))
    return cv2.resize(frame[y1: y1 + crop_h, x1: x1 + crop_w], (tw, th), interpolation=cv2.INTER_LINEAR)


def _render_resize(frame: np.ndarray, tw: int, th: int) -> np.ndarray:
    fh, fw = frame.shape[:2]
    scale = min(tw / fw, th / fh)
    iw, ih = int(fw * scale), int(fh * scale)
    inner = cv2.resize(frame, (iw, ih), interpolation=cv2.INTER_LINEAR)
    bg = cv2.GaussianBlur(cv2.resize(frame, (tw, th), interpolation=cv2.INTER_LINEAR), (99, 99), 0)
    x_off, y_off = (tw - iw) // 2, (th - ih) // 2
    bg[y_off: y_off + ih, x_off: x_off + iw] = inner
    return bg


# ── public API ────────────────────────────────────────────────────────────────

def smart_crop_clip(
    video_path: str,
    output_path: str,
    mode: str = "crop",
    smooth_window: int = 30,
    target_w: int = 1080,
    target_h: int = 1920,
    tmp_dir: str | None = None,
) -> str:
    """
    Detect the active speaker in video_path and write a 9:16 output_path.
    Falls back to centre-crop when no faces are detected.

    mode: "crop"   → zoom/crop to the speaking face
          "resize" → shrink full frame + blurred background pillarbox
    """
    dev = _device()
    logger.info("smart_crop_clip: device=%s mode=%s src=%s", dev, mode, video_path)

    own_tmp = tmp_dir is None
    if own_tmp:
        tmp_dir = tempfile.mkdtemp(prefix="smartcrop_")

    try:
        # 1. Read frames
        cap = cv2.VideoCapture(video_path)
        fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
        frames: list[np.ndarray] = []
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            frames.append(frame)
        cap.release()
        if not frames:
            raise RuntimeError(f"No frames read from {video_path}")
        fh, fw = frames[0].shape[:2]
        n = len(frames)
        logger.info("smart_crop_clip: %d frames %.1f fps %dx%d", n, fps, fw, fh)

        # 2. Subsample to MODEL_FPS (25) — TalkNet's audio encoder assumes 25 fps video
        if fps > _MODEL_FPS + 1.0:
            step = fps / _MODEL_FPS
            model_idx = [min(int(round(i * step)), n - 1) for i in range(int(n / step))]
            model_frames = [frames[j] for j in model_idx]
        else:
            step = 1.0
            model_idx = list(range(n))
            model_frames = frames
        model_n = len(model_frames)

        # 3. Detect → track → score on 25-fps frames
        dets = _detect_faces(model_frames, dev)
        tracks = _track_faces(dets)
        logger.info("smart_crop_clip: %d face tracks", len(tracks))

        if tracks:
            scores = _score_tracks(tracks, model_frames, video_path, dev, tmp_dir)
            model_crop_map = _build_crop_map(tracks, scores, model_n, smooth_window)
        else:
            model_crop_map = [(None, None)] * model_n

        # Map 25-fps crop map back to original fps for rendering
        crop_map = [
            model_crop_map[min(int(round(i / step)), model_n - 1)]
            for i in range(n)
        ]

        default_cx, default_cy = fw / 2.0, fh / 2.0

        # 3. Write silent 9:16 video
        silent = os.path.join(tmp_dir, "silent.mp4")
        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
        vout = cv2.VideoWriter(silent, fourcc, fps, (target_w, target_h))
        for i, frame in enumerate(frames):
            cx, cy = crop_map[i]
            if cx is None:
                cx, cy = default_cx, default_cy
            if mode == "resize":
                out_frame = _render_resize(frame, target_w, target_h)
            else:
                out_frame = _render_crop(frame, cx, cy, target_w, target_h)
            vout.write(out_frame)
        vout.release()

        # 4. Mux original audio
        subprocess.run(
            [
                "ffmpeg", "-y",
                "-i", silent,
                "-i", video_path,
                "-map", "0:v:0", "-map", "1:a:0",
                "-c:v", "libx264", "-crf", "23", "-preset", "fast",
                "-c:a", "aac", "-b:a", "192k",
                output_path,
            ],
            capture_output=True, check=True,
        )
        logger.info("smart_crop_clip: done → %s", output_path)
        return output_path

    finally:
        if own_tmp:
            shutil.rmtree(tmp_dir, ignore_errors=True)
