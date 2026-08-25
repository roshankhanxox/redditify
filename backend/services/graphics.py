"""Procedural background art for meme-template scenes.

All renderers are deterministic (seeded RNG where randomness is needed) so a
scene's picker thumbnail and its final render come from the *same* code path
— WYSIWYG by construction. Static renders go through a tiny-canvas + bicubic
upscale trick: gradients are smooth at any scale and it is ~400x faster than
per-pixel Python loops at 1080x1920.
"""

import random
from typing import TypedDict

from PIL import Image, ImageDraw


class GradientParams(TypedDict, total=False):
    stops: list[str]  # hex colors, first -> last
    direction: str  # vertical | diagonal | radial


class AnimatedGradientParams(TypedDict):
    colors: list[str]  # hex colors passed to ffmpeg's gradients filter
    speed: float


def _hex_to_rgb(h: str) -> tuple[int, int, int]:
    h = h.lstrip("#")
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def _lerp(a: tuple[int, int, int], b: tuple[int, int, int], t: float) -> tuple[int, ...]:
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def render_gradient(
    stops: list[str],
    out_path: str,
    size: tuple[int, int] = (1080, 1920),
    direction: str = "vertical",
) -> str:
    """Multi-stop linear/radial gradient PNG. Deterministic."""
    if len(stops) < 2:
        raise ValueError("need >= 2 stops")
    w, h = 64, 114  # tiny canvas; upscaled below
    img = Image.new("RGB", (w, h))
    px = img.load()
    rgbs = [_hex_to_rgb(s) for s in stops]
    segments = len(rgbs) - 1

    cx, cy = w / 2, h / 2
    max_dist = ((cx**2 + cy**2) ** 0.5) or 1.0

    for y in range(h):
        for x in range(w):
            if direction == "radial":
                t = (((x - cx) ** 2 + (y - cy) ** 2) ** 0.5) / max_dist
            elif direction == "diagonal":
                t = (x / w + y / h) / 2
            else:
                t = y / h
            pos = min(t * segments, segments - 1e-6)
            i = int(pos)
            px[x, y] = _lerp(rgbs[i], rgbs[i + 1], pos - i)

    img = img.resize(size, Image.BICUBIC)
    img.save(out_path, "PNG")
    return out_path


def render_starry(
    out_path: str,
    size: tuple[int, int] = (1080, 1920),
    seed: int = 7,
) -> str:
    """Night-sky scene: navy-to-black vertical wash, seeded stars, thin moon."""
    rng = random.Random(seed)
    base = Image.new("RGB", (64, 114))
    px = base.load()
    top, bottom = _hex_to_rgb("#0b1026"), _hex_to_rgb("#000000")
    for y in range(base.height):
        c = _lerp(top, bottom, y / base.height)
        for x in range(base.width):
            px[x, y] = c
    img = base.resize(size, Image.BICUBIC).convert("RGB")

    draw = ImageDraw.Draw(img)
    for _ in range(160):
        x = rng.randrange(0, size[0])
        y = int(rng.triangular(0, size[1], 0) * 0.85)  # denser toward the top
        r = rng.choice((1, 1, 1, 2, 2, 3))
        alpha = rng.randint(120, 255)
        draw.ellipse(
            (x - r, y - r, x + r, y + r),
            fill=(min(alpha, 255), min(alpha, 255), 255),
        )

    # Moon: pale disc upper-right with an offset bite to suggest a crescent
    mx, my, mr = int(size[0] * 0.78), int(size[1] * 0.14), int(size[0] * 0.075)
    draw.ellipse((mx - mr, my - mr, mx + mr, my + mr), fill=(235, 233, 210))
    draw.ellipse(
        (mx - mr * 0.75, my - mr * 1.05, mx + mr * 0.95, my + mr * 0.65),
        fill=tuple(_lerp(top, bottom, 0.18)),
    )

    img.save(out_path, "PNG")
    return out_path


def render_animated_frame(
    colors: list[str],
    out_path: str,
    size: tuple[int, int] = (270, 480),
) -> str:
    """Representative still for animated-gradient scenes (picker thumbnails).
    The final render animates through these colors via ffmpeg's gradients
    filter; the thumbnail shows the palette blended end-to-end."""
    return render_gradient(colors, out_path, size=size, direction="diagonal")
