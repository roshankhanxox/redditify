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
