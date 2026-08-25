"""Curated scene registry for the meme template.

A scene is a background recipe: either a static procedural render (gradients,
starry sky) or an animated palette driven by ffmpeg's native `gradients`
source. Picker thumbnails and final renders share the exact same code paths,
so previews never drift from what renders.
"""

from services.graphics import (
    render_animated_frame,
    render_gradient,
    render_starry,
)

SCENES: list[dict] = [
    {
        "id": "rainbow",
        "label": "Rainbow Drift",
        "kind": "animated_gradient",
        "params": {
            "colors": ["#ff0080", "#ff8c00", "#ffee00", "#00c853", "#2979ff", "#aa00ff"],
            "speed": 0.03,
        },
    },
    {
        "id": "sunset",
        "label": "Sunset",
        "kind": "gradient",
        "params": {
            "stops": ["#35142e", "#a32c4f", "#ff6b4a", "#ffc76b"],
            "direction": "diagonal",
        },
    },
    {
        "id": "ocean",
        "label": "Ocean",
        "kind": "gradient",
        "params": {
            "stops": ["#013a63", "#006494", "#00a6fb", "#b3eaff"],
            "direction": "vertical",
        },
    },
    {
        "id": "candy",
        "label": "Candy Pastel",
        "kind": "gradient",
        "params": {
            "stops": ["#ffd3e0", "#ffe9c9", "#d4f0f0", "#e8d9ff"],
            "direction": "vertical",
        },
    },
    {
        "id": "midnight",
        "label": "Starry Night",
        "kind": "starry",
        "params": {"seed": 7},
    },
    {
        "id": "forest",
        "label": "Mint Forest",
        "kind": "gradient",
        "params": {
            "stops": ["#0b3d2e", "#14746f", "#3ddad7", "#d7fff1"],
            "direction": "diagonal",
        },
    },
]

DEFAULT_SCENE_ID = "rainbow"

_SCENE_IDS = {s["id"] for s in SCENES}


def get_scene(scene_id: str | None) -> dict | None:
    """Registry lookup — unknown ids resolve to None (callers fall back)."""
    if not scene_id:
        return None
    return next((s for s in SCENES if s["id"] == scene_id), None)


def is_valid_scene(scene_id: str | None) -> bool:
    return scene_id in _SCENE_IDS


def render_scene_still(
    scene: dict,
    out_path: str,
    size: tuple[int, int] = (1080, 1920),
) -> str:
    """Dispatch a scene recipe to its procedural renderer."""
    kind, p = scene["kind"], scene["params"]
    if kind == "gradient":
        return render_gradient(
            p["stops"], out_path, size=size, direction=p.get("direction", "vertical")
        )
    if kind == "starry":
        return render_starry(out_path, size=size, seed=p.get("seed", 7))
    if kind == "animated_gradient":
        # Representative blended still — the video itself animates via lavfi.
        return render_animated_frame(p["colors"], out_path, size=size)
    raise ValueError(f"unknown scene kind: {kind}")
