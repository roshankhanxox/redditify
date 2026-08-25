"""Display-font registry for meme text overlays.

The registry is file-driven: every .ttf in backend/fonts/display is a font.
The SAME files serve both renderers (Pillow, in the worker) and the browser
preview (via /fonts/{id}/file), which is what makes the editor WYSIWYG —
identical metrics on both sides. Width-fit auto-shrink replaces auto-wrap so
line-break drift between engines can't happen.
"""

import os
import re

FONTS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "fonts", "display")

_SAFE_ID = re.compile(r"^[a-z0-9-]+$")


def _scan() -> dict[str, str]:
    """{font_id: absolute path}. font_id = lowercase stem minus generic
    suffixes like -regular/-variable, so 'Anton-Regular.ttf' → 'anton'."""
    fonts: dict[str, str] = {}
    if not os.path.isdir(FONTS_DIR):
        return fonts
    for name in sorted(os.listdir(FONTS_DIR)):
        if not name.lower().endswith((".ttf", ".otf")):
            continue
        fid = os.path.splitext(name)[0].lower()
        for suffix in ("-regular", "-variable"):
            if fid.endswith(suffix):
                fid = fid[: -len(suffix)]
        if _SAFE_ID.match(fid) and fid not in fonts:
            fonts[fid] = os.path.join(FONTS_DIR, name)
    return fonts


def list_fonts() -> list[dict]:
    return [{"id": fid, "label": _label(fid)} for fid in _scan()]


def get_font_path(font_id: str) -> str | None:
    """Whitelisted lookup — arbitrary strings can never become paths."""
    if not isinstance(font_id, str) or not _SAFE_ID.match(font_id):
        return None
    return _scan().get(font_id)


def _label(fid: str) -> str:
    return fid.replace("-", " ").title()
