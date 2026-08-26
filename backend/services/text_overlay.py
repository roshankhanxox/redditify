"""Text-overlay renderer for the meme layer editor.

Renders a text spec to a transparent PNG sized to the 1080-wide frame
coordinate system. The browser preview uses the SAME TTFs (served from
/fonts/{id}/file), and this renderer width-fits instead of auto-wrapping —
so what you drag is what composites.
"""

import os
import tempfile

from PIL import Image, ImageDraw, ImageFont

from services.fonts import get_font_path

MAX_WIDTH = 1000  # px inside the 1080 frame; leaves breathing room


def _hex_to_rgba(color: str, alpha: int = 255) -> tuple[int, int, int, int]:
    h = color.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), alpha


def _fit_font(text: str, font_id: str, size_px: int, max_w: int = MAX_WIDTH) -> ImageFont.FreeTypeFont:
    """Load the registered font, shrinking until one line fits max_w.
    Explicit \n breaks are honored; there is no automatic wrapping."""
    path = get_font_path(font_id)
    size = max(12, int(size_px))
    while True:
        font = (
            ImageFont.truetype(path, size)
            if path
            else ImageFont.load_default()
        )
        if not text.strip() or size <= 12:
            return font
        widest = max(
            font.getbbox(line)[2] - font.getbbox(line)[0]
            for line in text.split("\n") or [text]
        )
        if widest <= max_w:
            return font
        size = int(size * max_w / widest)


def render_text_overlay(spec: dict, out_path: str | None = None) -> str:
    """spec: {text, font_id, scale|size, color, align} → transparent PNG path.

    scale is the editor's calibration: font px @1080w = scale * 240, matching
    the browser preview's calc(scale * 22.2cqw), and the canvas is capped so
    nothing overflows the frame. Deterministic for identical specs."""
    text = str(spec.get("text", "")).replace("\r\n", "\n").strip("\n")
    font_id = spec.get("font_id", "anton")
    if "size" in spec:
        size = max(24, min(260, int(spec["size"])))
        max_w = MAX_WIDTH
    else:
        # Editor calibration: rendered px @1080w frame = scale * 240
        # (browser preview: calc(scale * 22.2cqw) — same function).
        scale = min(0.98, max(0.02, float(spec.get("scale", 0.28))))
        size = max(24, min(260, round(scale * 240)))
        max_w = max(120, min(MAX_WIDTH, round(scale * 1080)))
    color = _hex_to_rgba(spec.get("color", "#ffffff"))
    align = spec.get("align", "center")

    font = _fit_font(text or " ", font_id, size, max_w)
    lines = text.split("\n") or [" "]
    line_heights = []
    widths = []
    for line in lines:
        bbox = font.getbbox(line or " ")
        widths.append(bbox[2] - bbox[0])
        line_heights.append(bbox[3] - bbox[1] + int(size * 0.32))

    pad = int(size * 0.18)
    w = max(widths) + pad * 2
    h = sum(line_heights) + pad * 2
    img = Image.new("RGBA", (max(1, w), max(1, h)), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    y = pad
    for line, lw, lh in zip(lines, widths, line_heights):
        x = pad
        if align == "right":
            x = w - pad - lw
        elif align == "center":
            x = (w - lw) // 2
        draw.text((x, y), line, fill=color, font=font)
        y += lh

    if out_path is None:
        out_path = os.path.join(tempfile.mkdtemp(dir="/tmp/reelbot"), "text.png")
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    img.save(out_path, "PNG")
    return out_path
