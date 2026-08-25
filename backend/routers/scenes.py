import os

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse

from security import get_current_user
from services import scenes as scenes_service

router = APIRouter(tags=["scenes"])

_PREVIEW_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "outputs",
    "scenes",
    "previews",
)


@router.get("/scenes")
async def list_scenes(user=Depends(get_current_user)):
    """Scene catalog for the picker. Previews come from /scenes/{id}/preview."""
    return [
        {"id": s["id"], "label": s["label"], "kind": s["kind"]}
        for s in scenes_service.SCENES
    ]


@router.get("/scenes/{scene_id}/preview")
async def scene_preview(scene_id: str, user=Depends(get_current_user)):
    """Truthful picker thumbnail: rendered by the same code path as the final
    background, generated once and cached on disk (270x480 PNG)."""
    scene = scenes_service.get_scene(scene_id)
    if scene is None:
        raise HTTPException(404, detail="Unknown scene")

    out = os.path.join(_PREVIEW_DIR, f"{scene['id']}.png")
    if not os.path.exists(out):
        os.makedirs(_PREVIEW_DIR, exist_ok=True)
        scenes_service.render_scene_still(scene, out, size=(270, 480))
    return FileResponse(out, media_type="image/png")
