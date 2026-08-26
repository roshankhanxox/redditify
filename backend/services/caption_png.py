"""Static-caption renderer: text → transparent PNG with REAL color emojis.

libass burns captions through ffmpeg's subtitles filter, where pictographs
come out as tofu boxes (no dependable color-emoji font). Static captions
don't need libass at all — they're a fixed blob on a fixed schedule — so we
pre-render them here (Pillow + pilmoji/Twemoji) and composite them as
overlays, exactly like character/text layers. Emojis become inline Twemoji
images; offline failures degrade gracefully to plain glyphs.
"""

import os
import re

from PIL import Image, ImageDraw, ImageFont

from services.fonts import get_font_path

MAX_W = 980          # px inside the 1080 frame
MAX_H = 1100         # vertical budget for the whole block
LINE_BOX = 1.25      # line height multiplier
PAD = 24

CAPTION_COLOR_HEX = {"white": "#FFFFFF", "yellow": "#FFE500", "brand": "#FF452A"}

_EMOJI_RE = re.compile(
    "[\U0001F000-\U0001FAFF\U00002600-\u27BF\U0001F1E6-\U0001F1FF\u2B00-\u2BFF]+"
)


def _load_font(font_id: str | None, size: int) -> ImageFont.FreeTypeFont:
    path = get_font_path(font_id) if font_id else None
    if path:
        return ImageFont.truetype(path, size)
    return ImageFont.load_default(size)


def _wrap(words: list[str], fontsize: int) -> list[str]:
    """Greedy wrap at the estimated chars-per-line budget."""
    cpl = max(6, int(MAX_W / (fontsize * 0.55)))
    lines, cur = [], ""
    for w in words:
        cand = f"{cur} {w}".strip()
        if len(cand) <= cpl or not cur:
            cur = cand
        else:
            lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def _draw_line(line: str, font, fill, stroke, canvas_w: int) -> Image.Image:
    """Render one line tightly cropped, emojis included."""
    tmp = Image.new("RGBA", (canvas_w, int(font.size * LINE_BOX * 2)), (0, 0, 0, 0))
    drawn = False
    try:
        from pilmoji import Pilmoji

        with Pilmoji(tmp) as p:
            p.text(
                (PAD, PAD), line, font=font, fill=fill,
                stroke_width=stroke, stroke_fill=(0, 0, 0, 255),
            )
        drawn = True
    except Exception:
        drawn = False
    if not drawn:
        d = ImageDraw.Draw(tmp)
        d.text(
            (PAD, PAD), line, font=font, fill=fill,
            stroke_width=stroke, stroke_fill=(0, 0, 0, 255),
        )
    bbox = tmp.getbbox()
    return tmp.crop(bbox) if bbox else tmp.crop((0, 0, 1, 1))


def render_caption_png(
    text: str,
    out_path: str,
    fontsize: int = 96,
    color: str = "white",
    outline: int = 6,
    font_id: str = "anton",
) -> dict:
    """Whole text as one fitted multi-line transparent PNG.
    Uses a REGISTERED font (default anton) so the editor's @font-face
    preview can mirror the exact same typeface. Returns
    {'path', 'width', 'height'} in 1080x1920-frame pixels."""
    words = text.split()
    if not words:
        raise ValueError("empty caption text")

    fs = max(28, min(140, int(fontsize)))
    while fs > 24:
        lines = _wrap(words, fs)
        if len(lines) * fs * LINE_BOX <= MAX_H:
            break
        fs -= 2
    else:
        lines = _wrap(words, 24)

    fill = tuple(int(CAPTION_COLOR_HEX.get(color, "#FFFFFF")[i : i + 2], 16) for i in (1, 3, 5)) + (255,)
    font = _load_font(font_id, fs)
    stroke = max(0, min(12, int(outline)))

    canvas_w = MAX_W + PAD * 4
    line_imgs = [_draw_line(l, font, fill, stroke, canvas_w) for l in lines]
    w = min(MAX_W + PAD * 2, max(im.width for im in line_imgs) + PAD * 2)
    h = sum(im.height for im in line_imgs) + PAD * 2
    img = Image.new("RGBA", (max(w, 1), max(h, 1)), (0, 0, 0, 0))
    y = PAD // 2
    for im in line_imgs:
        img.paste(im, ((img.width - im.width) // 2, y), im)
        y += im.height

    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    img.save(out_path, "PNG")
    return {"path": out_path, "width": img.width, "height": img.height}
