"""Character cutout assets for the meme layer editor.

A thin, editor-shaped REST surface over user_backgrounds(kind='character').
Bytes go browser → presigned PUT → object storage; the API only validates,
normalizes (<=2048px, alpha preserved) and registers.
"""

import os
import tempfile
import uuid

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse, RedirectResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from db import get_db
from models import User
from models import UserBackground
from security import get_current_user
from services.storage import (
    delete as storage_delete,
    is_s3,
    presign_put,
    resolve,
)

router = APIRouter(tags=["characters"])

ALLOWED_IMAGE_TYPES = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp"}
MAX_IMAGE_UPLOAD_MB = 15


class CharacterInit(BaseModel):
    label: str = Field(default="", max_length=80)
    size_bytes: int = Field(gt=0)
    content_type: str
    bg_removed: bool = False


def _to_dict(bg: UserBackground) -> dict:
    width = height = None
    if bg.resolution and "x" in bg.resolution:
        try:
            width, height = (int(v) for v in bg.resolution.split("x", 1))
        except ValueError:
            pass
    return {
        "id": str(bg.id),
        "label": bg.label,
        "status": bg.status,
        "width": width,
        "height": height,
        "file_size_bytes": bg.file_size_bytes,
        "bg_removed": bool(bg.bg_removed),
        "error_message": bg.error_message,
        "created_at": bg.created_at.isoformat() if bg.created_at else None,
    }


@router.get("/characters")
async def list_characters(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    rows = (
        await db.scalars(
            select(UserBackground)
            .where(UserBackground.user_id == user.id, UserBackground.kind == "character")
            .order_by(UserBackground.created_at.desc())
        )
    ).all()
    return {"items": [_to_dict(r) for r in rows]}


@router.post("/characters/init")
async def init_character(
    body: CharacterInit,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    content_type = body.content_type.split(";")[0].strip().lower()
    ext = ALLOWED_IMAGE_TYPES.get(content_type)
    if ext is None:
        raise HTTPException(422, detail="content_type must be PNG, JPEG or WebP")
    if body.size_bytes > MAX_IMAGE_UPLOAD_MB * 1024 * 1024:
        raise HTTPException(422, detail=f"File too large (max {MAX_IMAGE_UPLOAD_MB} MB)")

    asset_id = uuid.uuid4()
    base_dir = f"users/{user.id}/assets/{asset_id}"
    bg = UserBackground(
        id=asset_id,
        user_id=user.id,
        status="pending",
        kind="character",
        bg_removed=body.bg_removed,
        label=body.label.strip() or "character",
        source_key=f"{base_dir}/source{ext}",
    )
    db.add(bg)
    await db.commit()
    return {"asset_id": str(asset_id), "url": presign_put(bg.source_key, 900, content_type)}


def _process_sync(bg_id: uuid.UUID, user_id: uuid.UUID) -> dict:
    """Runs in a worker thread: opens its OWN sync session — the request's
    AsyncSession must never be touched off the event loop."""
    from PIL import Image

    from sync_db import SyncSessionLocal
    from services.storage import upload as storage_upload

    with SyncSessionLocal() as db:
        bg = db.get(UserBackground, bg_id)
        if bg is None or bg.user_id != user_id:
            raise HTTPException(403, detail="Not your upload")
        if bg.status != "pending":
            raise HTTPException(409, detail="Upload already finalized")
        src = resolve(bg.source_key)
        if src is None:
            raise HTTPException(404, detail="Upload not found — PUT did not complete")

        with Image.open(src) as im:
            im.load()
            if getattr(im, "is_animated", False):
                raise HTTPException(422, detail="Animated images are not supported")
            has_alpha = im.mode in ("RGBA", "LA") or "transparency" in im.info
            im = im.convert("RGBA" if has_alpha else "RGB")
            if max(im.size) > 2048:
                im.thumbnail((2048, 2048), Image.LANCZOS)

            base_dir = bg.source_key.rsplit("/", 1)[0]
            clip_key = f"{base_dir}/asset.webp"
            out_dir = tempfile.mkdtemp(dir=tempfile.gettempdir())
            out = os.path.join(out_dir, "asset.webp")
            im.save(out, "WEBP", lossless=has_alpha, quality=90)

        storage_upload(out, clip_key)
        final_path = resolve(clip_key)
        with Image.open(final_path) as fim:
            bg.clip_key = clip_key
            bg.resolution = f"{fim.width}x{fim.height}"
        bg.file_size_bytes = os.path.getsize(final_path)
        bg.status = "ready"
        payload = _to_dict(bg)  # read while still attached — commit expires attrs
        db.commit()
        return payload


@router.post("/characters/{asset_id}/complete")
async def complete_character(
    asset_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    import asyncio

    return await asyncio.to_thread(_process_sync, asset_id, user.id)


@router.get("/characters/{asset_id}/file")
async def character_file(
    asset_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Inline image bytes for <img> previews in the editor."""
    from models import UserBackground as UB

    bg = await db.get(UB, asset_id)
    if bg is None or bg.user_id != user.id or bg.kind != "character":
        raise HTTPException(403, detail="Not your asset")
    if bg.status != "ready" or not bg.clip_key:
        raise HTTPException(409, detail="Asset not ready")
    key = bg.clip_key
    if is_s3():
        from services.storage import presign_get

        return RedirectResponse(presign_get(key, 900))
    path = resolve(key)
    if path is None:
        raise HTTPException(404, detail="Asset file missing")
    media = "image/webp" if key.endswith(".webp") else "image/png"
    return FileResponse(path, media_type=media)


@router.delete("/characters/{asset_id}")
async def delete_character(
    asset_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    bg = await db.get(UserBackground, asset_id)
    if bg is None or bg.user_id != user.id or bg.kind != "character":
        raise HTTPException(403, detail="Not your asset")
    base_dir = bg.source_key.rsplit("/", 1)[0]
    for key in (bg.source_key, f"{base_dir}/asset.webp"):
        if key:
            storage_delete(key)
    await db.delete(bg)
    await db.commit()
    return {"deleted": True}


