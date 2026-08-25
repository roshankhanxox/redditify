import os
import subprocess


def run_ffmpeg(args: list[str]) -> None:
    """Run FFmpeg. Raises RuntimeError with full stderr on failure."""
    cmd = ["ffmpeg", "-y"] + args
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"FFmpeg failed (exit {result.returncode}):\n{result.stderr}")


def get_duration(path: str) -> float:
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", path],
        capture_output=True, text=True,
    )
    return float(result.stdout.strip())


def get_resolution(path: str) -> tuple[int, int]:
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=width,height",
         "-of", "csv=s=x:p=0", path],
        capture_output=True, text=True,
    )
    w, h = result.stdout.strip().split("x")
    return int(w), int(h)


def transcode_vertical(src: str, dst: str) -> str:
    """Transcode any input to a 1080x1920 H.264 clip suitable as gameplay background."""
    run_ffmpeg([
        "-i", src,
        "-vf", "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1",
        "-c:v", "libx264", "-crf", "20", "-preset", "fast",
        "-an",
        dst,
    ])
    return dst


def render_preview(src: str, dst: str) -> str:
    """Low-quality 360x640 silent preview for cheap in-app playback."""
    run_ffmpeg([
        "-i", src,
        "-vf", "scale=360:640:force_original_aspect_ratio=increase,crop=360:640,setsar=1",
        "-c:v", "libx264", "-crf", "32", "-preset", "veryfast",
        "-an", "-movflags", "+faststart",
        dst,
    ])
    return dst


def scene_input_args(scene: dict, duration: float, tmp_dir: str) -> list[str]:
    """FFmpeg input args producing a 1080x1920 background stream for a scene.
    Static/generated scenes render to a PNG looped for the clip duration;
    animated gradients come straight from ffmpeg's native gradients source."""
    kind, p = scene["kind"], scene["params"]
    if kind == "animated_gradient":
        colors = "".join(
            f":c{i}=0x{c.lstrip('#')}" for i, c in enumerate(p["colors"][:8])
        )
        src = (
            f"gradients=s=1080x1920:r=30:nb_colors={len(p['colors'][:8])}"
            f":speed={p.get('speed', 0.03)}{colors}"
        )
        return ["-f", "lavfi", "-t", f"{duration + 0.5:.3f}", "-i", src]
    from services.scenes import render_scene_still

    out_png = os.path.join(tmp_dir, f"scene-{scene['id']}.png")
    render_scene_still(scene, out_png, size=(1080, 1920))
    return ["-loop", "1", "-t", f"{duration + 0.5:.3f}", "-i", out_png]


def render_meme_video(
    scene: dict,
    audio_path: str,
    output_path: str,
    subs: str | None = None,
    tmp_dir: str = "/tmp/reelbot",
    characters: list[dict] | None = None,
    text_pngs: list[dict] | None = None,
) -> str:
    """Meme-template composite. Layer order (z-law): scene → characters →
    text overlays → word-synced captions last. Placement is normalized
    center-anchored {x, y}; character scale is a fraction of frame width."""
    duration = get_duration(audio_path)

    inputs = scene_input_args(scene, duration, tmp_dir)
    # The voiceover becomes the input directly after the scene's single -i.
    audio_idx = inputs.count("-i")
    inputs += ["-i", audio_path]

    # Layer order (z-law): scene -> characters -> text overlays -> captions.
    chain_parts = ["[0:v]scale=1080:1920,setsar=1[bg]"]
    current = "[bg]"
    next_idx = audio_idx + 1

    for i, ch in enumerate(characters or []):
        w = max(32, int(1080 * ch["scale"]))
        x, y = ch["x"], ch["y"]
        transforms = f"scale={w}:-1"
        if ch.get("flip"):
            transforms += ",hflip"
        bob = "+sin(t*2)*20" if ch.get("bob") else ""
        label = f"char{i}"
        out_label = f"co{i}"
        chain_parts.append(f"[{next_idx}:v]{transforms}[{label}]")
        chain_parts.append(
            f"{current}[{label}]overlay=x='W*{x}-w/2':y='H*{y}-h/2{bob}'[{out_label}]"
        )
        current = f"[{out_label}]"
        inputs += ["-i", ch["path"]]
        next_idx += 1

    for i, tp in enumerate(text_pngs or []):
        x, y = tp["x"], tp["y"]
        # Text PNGs are pre-rendered at frame scale — overlay directly.
        chain_parts.append(f"{current}overlay=x='W*{x}-w/2':y='H*{y}-h/2'[tl{i}]")
        current = f"[tl{i}]"
        inputs += ["-i", tp["path"]]
        next_idx += 1

    if subs:
        sub_path = subs.replace("\\", "/").replace(":", "\\:")
        chain_parts.append(f"{current}subtitles='{sub_path}'[vout]")
        final = "[vout]"
    else:
        final = current
        # A trailing split needs a named endpoint when layers exist.
        if len(chain_parts) > 1:
            chain_parts[-1] = chain_parts[-1].rsplit("[", 1)[0] + final

    filter_complex = ";".join(chain_parts)

    run_ffmpeg([
        *inputs,
        "-filter_complex", filter_complex,
        "-map", final,
        "-map", f"{audio_idx}:a",
        "-t", f"{duration + 0.5:.3f}",
        "-c:v", "libx264", "-crf", "18", "-preset", "fast",
        "-c:a", "aac", "-b:a", "192k",
        "-r", "30",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        output_path,
    ])
    return output_path


def extract_thumbnail(src: str, dst: str, at_seconds: float = 1.0) -> str:
    """Poster frame for dashboard cards: 270x480 JPG grabbed near at_seconds."""
    run_ffmpeg([
        "-ss", f"{max(0.0, at_seconds):.3f}", "-i", src,
        "-frames:v", "1",
        "-vf", "scale=270:480",
        "-q:v", "5",
        dst,
    ])
    return dst


def render_video(
    gameplay_clip: str,
    audio_path: str,
    output_path: str,
    card: str | None = None,
    subs: str | None = None,
    card_pos: str = "top",
) -> str:
    """Composite the vertical reel: gameplay + voiceover, with an optional
    title-card overlay and/or burned-in ASS captions.

    card=None skips the overlay entirely; subs=None skips the subtitle burn.
    card_pos places the card 'top' (y=80) or 'bottom' (y=H-h-120).
    """
    duration = get_duration(audio_path)

    inputs = [
        "-stream_loop", "-1", "-t", str(duration + 0.5), "-i", gameplay_clip,
        "-i", audio_path,
    ]
    if card:
        inputs += ["-i", card]

    # Styling lives entirely inside the .ass subtitle file (PlayRes 1080x1920).
    # No force_style here — it would override the ASS styles. With no layers at
    # all the scaled stream is mapped directly as [vout].
    filters = [f"[0:v]scale=1080:1920,setsar=1{'[bg]' if (card or subs) else '[vout]'}"]

    current = "[bg]"
    if card:
        y = "H-h-120" if card_pos == "bottom" else "80"
        enable = f":enable='between(t,0,{duration:.3f})'"
        label = "[layered]" if subs else "[vout]"
        filters.append(f"[bg][2:v]overlay=(W-w)/2:{y}{enable}{label}")
        current = "[layered]"
    if subs:
        sub_path = subs.replace("\\", "/").replace(":", "\\:")
        filters.append(f"{current}subtitles='{sub_path}'[vout]")

    run_ffmpeg([
        *inputs,
        "-filter_complex", ";".join(filters),
        "-map", "[vout]",
        "-map", "1:a",
        "-t", str(duration + 0.5),
        "-c:v", "libx264", "-crf", "18", "-preset", "fast",
        "-c:a", "aac", "-b:a", "192k",
        "-r", "60",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        output_path,
    ])
    return output_path
