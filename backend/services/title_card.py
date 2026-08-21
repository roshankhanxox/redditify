import os
import subprocess
import textwrap

from PIL import Image, ImageDraw, ImageFont

FONT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "fonts"))


def _font(name: str, size: int) -> ImageFont.FreeTypeFont:
    try:
        return ImageFont.truetype(os.path.join(FONT_DIR, name), size)
    except Exception:
        return ImageFont.load_default()


def render(title: str, subreddit: str, style: str, output_path: str) -> str:
    W, H = 1000, 340
    bg_alpha = 0 if style == "minimal" else 200
    bg_color = (15, 15, 15, bg_alpha) if style == "dark" else (255, 255, 255, bg_alpha)
    text_color = "white" if style in ("dark", "minimal") else "#1a1a1a"

    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    if style != "minimal":
        bg = Image.new("RGBA", (W, H), bg_color)
        img = Image.alpha_composite(img, bg)

    draw = ImageDraw.Draw(img)

    # Subreddit label in Reddit orange
    badge_font = _font("Inter-Bold.ttf", 30)
    draw.text((40, 28), f"r/{subreddit}", fill="#FF4500", font=badge_font)

    # Title text, word-wrapped
    title_font = _font("Inter-SemiBold.ttf", 44)
    lines = textwrap.wrap(title, width=34)[:4]
    y = 82
    for line in lines:
        draw.text((40, y), line, fill=text_color, font=title_font)
        y += 56

    img.save(output_path, "PNG")
    return output_path


def probe_clip(path: str) -> dict:
    """Return duration and resolution of a video file."""
    def ffprobe(entries: str) -> str:
        result = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", entries,
             "-of", "default=noprint_wrappers=1:nokey=1", path],
            capture_output=True, text=True,
        )
        return result.stdout.strip()

    try:
        duration = float(ffprobe("format=duration"))
    except ValueError:
        duration = None
    res_raw = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=width,height", "-of", "csv=s=x:p=0", path],
        capture_output=True, text=True,
    ).stdout.strip()
    return {"duration_seconds": duration, "resolution": res_raw or None}
