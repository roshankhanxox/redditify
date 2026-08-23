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


BASE_W, BASE_H = 1000, 340
PAD_X = 40
MAX_LINES = 4


def render(title: str, subreddit: str, style: str, output_path: str,
           scale_pct: int = 100, show_badge: bool = True) -> str:
    try:
        scale_pct = max(60, min(130, int(scale_pct)))
    except (TypeError, ValueError):
        scale_pct = 100
    s = scale_pct / 100

    W, H = int(BASE_W * s), int(BASE_H * s)
    bg_alpha = 0 if style == "minimal" else 200
    bg_color = (15, 15, 15, bg_alpha) if style == "dark" else (255, 255, 255, bg_alpha)
    text_color = "white" if style in ("dark", "minimal") else "#1a1a1a"

    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    if style != "minimal":
        bg = Image.new("RGBA", (W, H), bg_color)
        img = Image.alpha_composite(img, bg)

    draw = ImageDraw.Draw(img)

    badge_font = _font("Inter-Bold.ttf", int(30 * s))
    title_font = _font("Inter-SemiBold.ttf", int(44 * s))

    # Title text, word-wrapped; capped at MAX_LINES with an ellipsis instead of
    # overflowing the card at any scale.
    wrap_width = max(10, int(34 * s))
    lines = textwrap.wrap(title.strip(), width=wrap_width)
    if len(lines) > MAX_LINES:
        last = lines[MAX_LINES - 1].rstrip()
        while last and draw.textlength(last + "…", font=title_font) > W - 2 * PAD_X * s:
            last = last.rsplit(" ", 1)[0] if " " in last else ""
        lines = lines[:MAX_LINES]
        lines[MAX_LINES - 1] = (last + " …").strip() if last else "…"

    y = (82 if show_badge else 28) * s
    for line in lines:
        draw.text((int(PAD_X * s), int(y)), line, fill=text_color, font=title_font)
        y += 56 * s

    if show_badge and subreddit:
        # Subreddit label in Reddit orange, drawn after wrap so a badge-less
        # card keeps the title block at the top.
        draw.text((int(PAD_X * s), int(28 * s)), f"r/{subreddit}",
                  fill="#FF4500", font=badge_font)

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
