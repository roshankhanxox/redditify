import os
import shutil
import uuid

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from sqlalchemy import func, select

from db import get_db
from models import Asset
from security import get_current_user, require_admin
from services import assets as asset_service
from services.video import get_duration, get_resolution, transcode_vertical

router = APIRouter(tags=["assets"])

MIN_DURATION_SECONDS = 30.0
TARGET_RESOLUTION = (1080, 1920)


@router.get("/assets")
async def list_assets(_user=Depends(get_current_user)):
    items = await asset_service.all_assets()
    enabled = [a for a in items if a.enabled]
    categories = sorted({a.category for a in enabled})
    return {
        "categories": ["any", *categories],
        "clips": [
            {
                "id": str(a.id),
                "filename": a.filename,
                "category": a.category,
                "duration_seconds": a.duration_seconds,
                "file_size_bytes": a.file_size_bytes,
                "resolution": a.resolution,
                "enabled": a.enabled,
            }
            for a in items
        ],
    }


async def _store_upload(tmp_path: str) -> tuple[str, float, str]:
    """Validate probe data, transcode if needed, move into ASSETS_DIR.
    Returns (final_path, duration, resolution)."""
    duration = None
    resolution = None
    try:
        duration = get_duration(tmp_path)
    except ValueError:
        raise HTTPException(422, detail="File has no readable duration — not a valid video?")
    try:
        w, h = get_resolution(tmp_path)
        resolution = f"{w}x{h}"
    except ValueError:
        raise HTTPException(422, detail="File has no video stream")

    if duration < MIN_DURATION_SECONDS:
        raise HTTPException(422, detail=f"Clip too short: {duration:.1f}s (minimum {MIN_DURATION_SECONDS:.0f}s)")

    asset_dir = asset_service.clips_dir()
    os.makedirs(asset_dir, exist_ok=True)
    final_name = f"{uuid.uuid4().hex}.mp4"
    final_path = os.path.join(asset_dir, final_name)

    if (w, h) != TARGET_RESOLUTION:
        # Not exactly 1080x1920 → normalize (crop/scale) to vertical target
        transcode_vertical(tmp_path, final_path)
        resolution = f"{TARGET_RESOLUTION[0]}x{TARGET_RESOLUTION[1]}"
    else:
        shutil.move(tmp_path, final_path)

    return final_path, duration, resolution


@router.post("/admin/assets")
async def upload_asset(
    file: UploadFile,
    category: str = "other",
    _admin=Depends(require_admin),
):
    if category not in ("minecraft", "subway_surfers", "satisfying", "other"):
        raise HTTPException(422, detail="category must be one of: minecraft, subway_surfers, satisfying, other")

    tmp_dir = "/tmp/reelbot/uploads"
    os.makedirs(tmp_dir, exist_ok=True)
    tmp_path = os.path.join(tmp_dir, f"{uuid.uuid4().hex}_{file.filename}")
    try:
        size = 0
        with open(tmp_path, "wb") as f:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                f.write(chunk)
        if size == 0:
            raise HTTPException(422, detail="Empty file")

        final_path, duration, resolution = await _store_upload(tmp_path)

        asset = await asset_service.create_asset(
            filename=os.path.basename(final_path),
            category=category,
            duration_seconds=duration,
            file_size_bytes=size,
            resolution=resolution,
        )
        return {
            "id": str(asset.id),
            "filename": asset.filename,
            "category": asset.category,
            "duration_seconds": asset.duration_seconds,
            "file_size_bytes": asset.file_size_bytes,
            "resolution": asset.resolution,
            "enabled": asset.enabled,
        }
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)


@router.patch("/admin/assets/{asset_id}")
async def patch_asset(
    asset_id: uuid.UUID,
    enabled: bool | None = None,
    category: str | None = None,
    _admin=Depends(require_admin),
):
    if category is not None and category not in ("minecraft", "subway_surfers", "satisfying", "other"):
        raise HTTPException(422, detail="Invalid category")
    updates = {}
    if enabled is not None:
        updates["enabled"] = enabled
    if category is not None:
        updates["category"] = category
    if not updates:
        raise HTTPException(422, detail="Nothing to update")
    asset = await asset_service.update_asset(asset_id, **updates)
    if asset is None:
        raise HTTPException(404, detail="Asset not found")
    return {"id": str(asset.id), "enabled": asset.enabled, "category": asset.category}


@router.delete("/admin/assets/{asset_id}")
async def delete_asset(asset_id: uuid.UUID, _admin=Depends(require_admin)):
    ok = await asset_service.delete_asset(asset_id)
    if not ok:
        raise HTTPException(409, detail="Cannot delete the last enabled gameplay clip")
    return {"deleted": True}
