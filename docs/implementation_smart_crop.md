# Implementation Plan — Smart Crop (Active Speaker Detection)

## Goal

When generating clips, automatically detect which face in the video is speaking
and dynamically crop to that face, filling the 9:16 frame. The result looks like
a professional podcast editor manually tracked the speaker — the camera
"follows" whoever is talking without ever showing letterboxing.

## How it works (pipeline overview)

```
source clip segment (MP4)
  → extract frames + audio  (FFmpeg)
  → face detection per frame (LR-ASD / S3FD)
  → track faces across frames (same person, consecutive frames)
  → speaking score per face per frame (LR-ASD TalkNet)
  → smooth scores over 30-frame window (Gaussian blur)
  → per-frame: pick highest-score face → crop center + dimensions
  → write output frames (cv2 VideoWriter, 9:16)
  → mux audio back (FFmpeg)
  → burn ASS captions (existing FFmpeg step, unchanged)
```

## Library choice: LR-ASD

**Junhua-Liao/LR-ASD** (https://github.com/Junhua-Liao/LR-ASD) is a PyTorch
model that takes a video segment and returns, per frame, a list of face tracks
with speaking probability scores. It combines:
- S3FD face detector (already downloaded on first run)
- TalkNet audio-visual correlation model
- Track association across frames

**Why LR-ASD over alternatives:**
- pyannote.audio gives speaker segments but no face coordinates
- MediaPipe FaceDetector gives faces but no speech signal
- LR-ASD gives both in one pass, trained end-to-end

**Tradeoff:** Not a pip package. Must be vendored or installed from git.
Requires PyTorch (~CPU 1–3× real-time on M-series Mac, fast enough for background tasks).

## Vendoring LR-ASD

```
backend/
  vendor/
    lrasd/          ← clone of Junhua-Liao/LR-ASD, stripped of demos
      __init__.py
      model/        ← TalkNet model files
      utils/        ← S3FD detector, track utilities
      pretrain/     ← model weights (downloaded on first run, ~60 MB)
```

`requirements.txt` additions:
```
opencv-python-headless>=4.9
scipy>=1.12        # for gaussian_filter1d score smoothing
```

PyTorch is already present via `openai-whisper`.

## New service: `services/smart_crop.py`

```python
def smart_crop_clip(
    video_path: str,
    audio_path: str,
    output_path: str,
    mode: str = "crop",          # "crop" | "resize"
    smooth_window: int = 30,     # frames for score smoothing
    target_w: int = 1080,
    target_h: int = 1920,
) -> str:
    """
    Reads video_path + audio_path, runs LR-ASD, writes a 9:16 output_path.
    Returns output_path.
    
    mode="crop"   → zoom to speaking face (face fills frame, no black/blur)
    mode="resize" → shrink full frame to fit 9:16 with a blurred bg copy
    """
```

Internal steps:
1. `cv2.VideoCapture(video_path)` — read frames into a list
2. Call `lrasd.inference(frames, audio_path)` → `tracks: list[Track]`
   - Each `Track` has `.faces[frame_idx]` = `(x, y, w, h)` and `.scores[frame_idx]`
3. Smooth scores: `scipy.ndimage.gaussian_filter1d(scores, sigma=smooth_window/6)`
4. For each frame: find the track with the highest score → call `_crop_frame` or `_resize_frame`
5. Write frames with `cv2.VideoWriter(..., fourcc=mp4v, fps=fps, size=(1080, 1920))`
6. Mux audio: `ffmpeg -i silent_video -i audio_path -c:v copy -c:a aac output`

### Crop frame (`mode="crop"`)

```
face_cx = x + w/2
face_cy = y + h/2
crop_h = frame_h                        # use full height (portrait)
crop_w = int(crop_h * 9 / 16)
# clamp so crop stays within frame
cx = clamp(face_cx, crop_w/2, frame_w - crop_w/2)
cy = clamp(face_cy, crop_h/2, frame_h - crop_h/2)
crop = frame[cy-crop_h/2:cy+crop_h/2, cx-crop_w/2:cx+crop_w/2]
output = cv2.resize(crop, (1080, 1920))
```

If no face detected in this frame, hold the last known crop center.

### Resize frame (`mode="resize"`)

```
# Fit full frame inside 9:16 with pillarbox
scale = min(target_w / frame_w, target_h / frame_h)
inner = cv2.resize(frame, (int(frame_w*scale), int(frame_h*scale)))
# Blurred background: scale+crop original to fill 9:16
bg = cv2.resize(frame, (target_w, target_h))
bg = cv2.GaussianBlur(bg, (99, 99), 0)
# Composite inner on top of blurred bg
output = bg.copy()
y_off = (target_h - inner.shape[0]) // 2
x_off = (target_w - inner.shape[1]) // 2
output[y_off:y_off+inner.shape[0], x_off:x_off+inner.shape[1]] = inner
```

## Integration point: `tasks/clip.py`

Smart crop is an **opt-in post-processing step** that replaces the `video.render_clip` call when `cfg.get("smart_crop_enabled")` is true.

```python
# In the per-clip loop, instead of:
video.render_clip(video_path, output_path, w.start, duration, subs=subs_path)

# With smart crop:
if cfg.get("smart_crop_enabled"):
    raw_path = os.path.join(clip_tmp, "raw.mp4")
    audio_clip_path = os.path.join(clip_tmp, "audio.mp3")
    video.trim_clip(video_path, raw_path, w.start, duration)  # new helper: seek+trim, no crop
    video.extract_audio_segment(video_path, audio_clip_path, w.start, duration)
    smart_crop.smart_crop_clip(raw_path, audio_clip_path, output_path,
                               mode=cfg.get("smart_crop_mode", "crop"))
    # then burn captions on top (unchanged FFmpeg step)
    if subs_path:
        video.burn_subs(output_path, subs_path)
else:
    video.render_clip(video_path, output_path, w.start, duration, subs=subs_path)
```

New helpers needed in `services/video.py`:
- `trim_clip(src, dst, start, duration)` — seek+trim, no crop, preserve original aspect ratio
- `burn_subs(video_path, subs_path)` — in-place subtitle burn (replaces output)

## Settings / schema changes

New fields in `_sanitize_clip_settings` (`routers/clip_jobs.py`):
```python
out["smart_crop_enabled"] = bool(s.get("smart_crop_enabled", False))
valid_modes = {"crop", "resize"}
mode = s.get("smart_crop_mode", "crop")
out["smart_crop_mode"] = mode if mode in valid_modes else "crop"
```

Frontend (`frontend/lib/types.ts`): No `RenderSettings` changes needed — smart crop only applies to clip jobs. Add to a new `ClipJobSettings` type or extend the existing `settings: Record<string, unknown>` in `ClipJob`.

## Frontend UI (`components/clips/new-clip-job-dialog.tsx`)

After the existing Captions toggle, add:

```tsx
{/* Smart crop toggle — only shown when captions are a secondary concern */}
<div className="rounded-lg border px-3 py-2.5">
  <div className="flex items-center justify-between">
    <div>
      <p className="text-sm font-medium">Smart crop</p>
      <p className="text-xs text-muted-foreground">
        Auto-follow the active speaker's face
      </p>
    </div>
    <Toggle checked={smartCropEnabled} onChange={setSmartCropEnabled} />
  </div>
  {smartCropEnabled && (
    <Segmented
      value={smartCropMode}
      onChange={setSmartCropMode}
      options={[
        { value: "crop", label: "Crop to face" },
        { value: "resize", label: "Blur background" },
      ]}
    />
  )}
</div>
```

Pass `smart_crop_enabled` and `smart_crop_mode` in the `settings` payload.

## Dependencies + install changes

`backend/requirements.txt`:
```diff
+opencv-python-headless>=4.9
+scipy>=1.12
```

`backend/vendor/lrasd/` — clone stripped of `demo/`, `data/`, `docs/`:
```bash
git clone --depth 1 https://github.com/Junhua-Liao/LR-ASD backend/vendor/lrasd
```

Add to `sys.path` in `services/smart_crop.py`:
```python
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "vendor"))
from lrasd import ...
```

## Rollout checkpoints

1. **Vendor LR-ASD + smoke test** — clone, write a standalone script that runs
   inference on a 10-second test video and prints track counts. Confirm it works on
   the dev machine.
2. **`services/smart_crop.py`** — implement `smart_crop_clip` (crop mode only).
   Unit-test the frame math with synthetic frames (no model).
3. **`services/video.py` helpers** — `trim_clip` and `burn_subs`.
4. **`tasks/clip.py` branching** — wire opt-in path; integration test with a real clip.
5. **Resize mode** — add blurred-background fallback; test with a clip that has no face.
6. **Settings sanitizer** — `routers/clip_jobs.py`.
7. **Frontend toggle** — `new-clip-job-dialog.tsx`.
8. **Visual QA** — run a full clip job with smart crop on; check no jitter, correct
   face tracking, smooth crop movement. Adjust smooth_window if needed.

## Edge cases & risks

- **No face detected**: hold last known crop center. If no face in the entire clip,
  fall back to center-crop (same as current `render_clip`).
- **Multiple speakers**: pick the highest-score face each frame. If scores are equal
  (no one clearly speaking), hold the previous crop center.
- **Jitter**: the 30-frame Gaussian smooth prevents rapid crop jumps. If still
  noticeable, increase `smooth_window` or add a max-speed constraint per frame.
- **Fast cuts / scene changes**: track scores reset on scene change. The hold-last
  strategy handles short gaps; long gaps (>1s with no face) fall back to center.
- **Performance**: LR-ASD at 25fps × 45s ≈ 1125 frames per clip, ~45–90s CPU time
  on M-series. For 10 clips that's 8–15 min total. Acceptable as background task;
  consider a `SMART_CROP_ENABLED` config flag to disable on low-resource servers.
- **Model weights**: S3FD + TalkNet weights downloaded on first run (~60 MB). Cache
  under `~/.cache/lrasd/`. Add to `.gitignore`.

## Out of scope (future)

- Per-clip smart crop quality score (did it track correctly?)
- Manual face-region override in the UI
- Smooth pan/zoom (Ken Burns style) between speakers
- GPU inference via MPS (would cut time by ~5×)
