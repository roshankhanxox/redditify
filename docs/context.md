# Session Context — Smart Crop Implementation

## Branch
`feature/smart-crop`

## What's done
- `backend/vendor/lrasd/` — LR-ASD cloned from Junhua-Liao/LR-ASD, `__init__.py` added
- `backend/services/smart_crop.py` — fully written (device-agnostic: CUDA > MPS > CPU)
  - `_ensure_s3fd()` — downloads S3FD weights via gdown if missing
  - `_detect_faces()` — S3FD face detection per frame
  - `_iou()` / `_track_faces()` — IoU tracker with scipy interp1d interpolation
  - `_load_asd_model()` — loads ASD_Model + lossAV from `weight/pretrain_AVA.model`
  - `_score_tracks()` — TalkNet inference with durationSet=[1,1,1,2,2,2,3,3,4,5,6]
  - `_build_crop_map()` — median-filter smoothed crop coordinates
  - `_render_crop()` / `_render_resize()` — 9:16 frame output
  - `smart_crop_clip(video_path, output_path, mode, smooth_window, target_w, target_h, tmp_dir)` — main API

## What still needs to be done (in order)

### 1. `backend/services/video.py` — add two helpers after `render_clip` (line 230)

```python
def trim_clip(src: str, dst: str, start: float, duration: float) -> str:
    """Seek + trim without transcode — preserves original resolution."""
    run_ffmpeg([
        "-ss", f"{max(0.0, start):.3f}",
        "-i", src,
        "-t", f"{duration:.3f}",
        "-map", "0:v:0", "-map", "0:a:0?",
        "-c", "copy",
        dst,
    ])
    return dst


def burn_subs(video_path: str, subs_path: str) -> str:
    """Burn subs_path into video_path in-place (overwrites)."""
    import shutil, tempfile
    tmp = tempfile.mktemp(suffix=".mp4")
    sub_esc = subs_path.replace("\\", "/").replace(":", "\\:")
    run_ffmpeg([
        "-i", video_path,
        "-vf", f"subtitles='{sub_esc}'",
        "-map", "0:v:0", "-map", "0:a:0?",
        "-c:v", "libx264", "-crf", "18", "-preset", "veryfast",
        "-c:a", "aac", "-b:a", "192k",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        tmp,
    ])
    shutil.move(tmp, video_path)
    return video_path
```

### 2. `backend/tasks/clip.py` — wire smart crop into the clipping loop

After `caption_animation` / `caption_highlight` are extracted (around line 126), add:
```python
smart_crop_on   = bool(cfg.get("smart_crop_enabled", False))
smart_crop_mode = cfg.get("smart_crop_mode", "crop")
```

Replace the single-pass render block (currently line 173-174):
```python
output_path = os.path.join(clip_tmp, "output.mp4")
video.render_clip(video_path, output_path, w.start, duration, subs=subs_path)
```
With:
```python
output_path = os.path.join(clip_tmp, "output.mp4")
if smart_crop_on:
    from services import smart_crop
    raw_path = os.path.join(clip_tmp, "raw.mp4")
    video.trim_clip(video_path, raw_path, w.start, duration)
    smart_crop.smart_crop_clip(raw_path, output_path, mode=smart_crop_mode, tmp_dir=clip_tmp)
    if subs_path:
        video.burn_subs(output_path, subs_path)
else:
    video.render_clip(video_path, output_path, w.start, duration, subs=subs_path)
```

### 3. `backend/routers/clip_jobs.py` — add to `_sanitize_clip_settings` (after line 129)

```python
out["smart_crop_enabled"] = bool(s.get("smart_crop_enabled", False))
valid_crop_modes = {"crop", "resize"}
crop_mode = s.get("smart_crop_mode", "crop")
out["smart_crop_mode"] = crop_mode if crop_mode in valid_crop_modes else "crop"
```

### 4. `frontend/components/clips/new-clip-job-dialog.tsx` — add smart crop toggle

Add state:
```tsx
const [smartCropEnabled, setSmartCropEnabled] = useState(false);
```

Add to the settings POST payload (in `handleStart`):
```tsx
smart_crop_enabled: smartCropEnabled,
smart_crop_mode: "crop",
```

Add UI card after the captions card (around line 261):
```tsx
{/* Smart crop toggle */}
<div className="rounded-lg border border-border/60">
  <div className="flex items-center justify-between px-3 py-2.5">
    <div>
      <p className="text-sm font-medium">Smart crop</p>
      <p className="text-xs text-muted-foreground">
        Face-track the speaker and auto-frame to 9:16
      </p>
    </div>
    <button
      type="button"
      onClick={() => setSmartCropEnabled((v) => !v)}
      className={cn(
        "relative h-5 w-9 rounded-full transition-colors",
        smartCropEnabled ? "bg-primary" : "bg-muted",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
          smartCropEnabled ? "translate-x-4" : "translate-x-0.5",
        )}
      />
    </button>
  </div>
</div>
```

### 5. `backend/requirements.txt` — add dependencies

```
opencv-python-headless==4.10.*
scipy==1.14.*
python_speech_features==0.6
gdown==5.2.*
```

## Key notes
- NEVER add `Co-Authored-By: Claude` to any git commit (user constraint)
- S3FD weight path: `backend/vendor/lrasd/model/faceDetector/s3fd/sfd_face.pth` (downloaded on first use via gdown ID `1KafnHz7ccT-3IyddBsL5yi2xGtxAKypt`)
- ASD weights: `backend/vendor/lrasd/weight/pretrain_AVA.model` (already in repo)
- `lossAV.forward(out, labels=None)` returns per-timestep scores (no label needed at inference)
- `trim_clip` uses `-c copy` (no transcode) — smart_crop then re-encodes to 9:16
- `burn_subs` overwrites the output file in-place after smart_crop produces the cropped video
