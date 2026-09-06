import math
import os
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from db import get_db
from models import User, UserBackground
from ratelimit import rate_limit
from security import get_current_user
from services import storage
from tasks.backgrounds import MAX_LOOP_DURATION_SECONDS, MIN_DURATION_SECONDS

router = APIRouter(tags=["backgrounds"])

ALLOWED_CONTENT_TYPES = {"video/mp4", "video/quicktime", "video/webm"}
PART_SIZE_BYTES = 32 * 1024 * 1024
MAX_PARTS = 10000


class BackgroundInit(BaseModel):
    label: str = Field(min_length=1, max_length=80)
    size_bytes: int = Field(gt=0)
    content_type: str


def _sanitize_label(label: str) -> str:
    clean = "".join(ch for ch in label.strip() if ch.isprintable())
    return " ".join(clean.split())[:80] or "My footage"


async def _get_own_background(bg_id: uuid.UUID, user: User, db: AsyncSession) -> UserBackground:
    """Ownership-checked row fetch. Foreign or missing ids are indistinguishable."""
    bg = await db.get(UserBackground, bg_id)
    if bg is None or bg.user_id != user.id:
        raise HTTPException(404, detail="Background not found")
    return bg


def _to_dict(bg: UserBackground) -> dict:
    # Object keys are deliberately excluded — they are internal storage paths.
    return {
        "id": str(bg.id),
        "kind": bg.kind,
        "label": bg.label,
        "status": bg.status,
        "duration_seconds": bg.duration_seconds,
        "file_size_bytes": bg.file_size_bytes,
        "resolution": bg.resolution,
        "error_message": bg.error_message,
        "created_at": bg.created_at.isoformat() if bg.created_at else None,
    }


@router.get("/backgrounds")
async def list_backgrounds(
    kind: str | None = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    q = select(UserBackground).where(UserBackground.user_id == user.id)
    if kind in ("video", "image", "character"):
        q = q.where(UserBackground.kind == kind)
    rows = (
        await db.scalars(q.order_by(UserBackground.created_at.desc()))
    ).all()
    plan = getattr(user, "plan", "free") or "free"
    premium = user.role == "admin" or plan == "premium"
    return {
        "items": [_to_dict(bg) for bg in rows],
        "max_backgrounds": (
            settings.PREMIUM_MAX_BACKGROUNDS if premium else settings.FREE_MAX_BACKGROUNDS
        ),
    }


@router.get("/backgrounds/{bg_id}")
async def get_background(
    bg_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    bg = await _get_own_background(bg_id, user, db)
    return _to_dict(bg)


@router.post(
    "/backgrounds/init",
    dependencies=[Depends(rate_limit("upload_init", limit=20, window_seconds=3600))],
)
async def init_background(
    body: BackgroundInit,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not storage.is_s3():
        raise HTTPException(
            503,
            detail="Background uploads need object storage — set STORAGE_BACKEND=s3",
        )
    content_type = body.content_type.split(";")[0].strip().lower()
    if content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(422, detail="content_type must be video/mp4, video/quicktime or video/webm")

    max_bytes = settings.MAX_BACKGROUND_UPLOAD_MB * 1024 * 1024
    if body.size_bytes > max_bytes:
        raise HTTPException(422, detail=f"File too large (max {settings.MAX_BACKGROUND_UPLOAD_MB} MB)")

    plan = getattr(user, "plan", "free") or "free"
    premium = user.role == "admin" or plan == "premium"
    cap = settings.PREMIUM_MAX_BACKGROUNDS if premium else settings.FREE_MAX_BACKGROUNDS
    ready_count = await db.scalar(
        select(func.count())
        .select_from(UserBackground)
        .where(UserBackground.user_id == user.id, UserBackground.status == "ready")
    )
    if (ready_count or 0) >= cap:
        raise HTTPException(409, detail=f"Background limit reached ({cap}) — delete one first")

    bg_id = uuid.uuid4()
    base_dir = f"users/{user.id}/backgrounds/{bg_id}"
    bg = UserBackground(
        id=bg_id,
        user_id=user.id,
        status="pending",
        label=_sanitize_label(body.label),
        source_key=f"{base_dir}/source.mp4",
    )
    upload_id = storage.create_multipart(bg.source_key, content_type)
    bg.upload_id = upload_id
    db.add(bg)
    await db.commit()
    await db.refresh(bg)

    part_count = min(MAX_PARTS, max(1, math.ceil(body.size_bytes / PART_SIZE_BYTES)))
    parts = [
        {
            "part_number": n + 1,
            "url": storage.presign_part(
                bg.source_key, upload_id, n + 1, settings.UPLOAD_PART_SIGNED_TTL_SECONDS
            ),
        }
        for n in range(part_count)
    ]
    return {
        "id": str(bg.id),
        "kind": bg.kind,
        "label": bg.label,
        "status": bg.status,
        "part_size": PART_SIZE_BYTES,
        "parts": parts,
    }


@router.post("/backgrounds/{bg_id}/complete")
async def complete_background(
    bg_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    bg = await _get_own_background(bg_id, user, db)
    if bg.status != "pending" or not bg.upload_id:
        raise HTTPException(409, detail="Upload is not pending completion")

    # Server-side ListParts — the client never gets to claim what it uploaded.
    parts = storage.list_parts(bg.source_key, bg.upload_id)
    if not parts:
        storage.abort_multipart(bg.source_key, bg.upload_id)
        bg.upload_id = None
        bg.status = "failed"
        bg.error_message = "No data was uploaded"
        await db.commit()
        raise HTTPException(422, detail="No data was uploaded")

    storage.complete_multipart(bg.source_key, bg.upload_id, parts)
    meta = storage.stat(bg.source_key) or {}
    if (meta.get("size_bytes") or 0) == 0:
        storage.delete(bg.source_key)
        bg.upload_id = None
        bg.status = "failed"
        bg.error_message = "Uploaded object is empty"
        await db.commit()
        raise HTTPException(422, detail="Uploaded object is empty")

    bg.upload_id = None
    bg.file_size_bytes = meta.get("size_bytes")
    bg.status = "processing"
    await db.commit()

    from tasks.backgrounds import process_background

    process_background.delay(str(bg.id))
    return {"id": str(bg.id), "status": bg.status}


@router.get("/backgrounds/{bg_id}/preview-url")
async def preview_url(
    bg_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    bg = await _get_own_background(bg_id, user, db)
    if bg.status != "ready" or not bg.preview_key:
        raise HTTPException(409, detail="Preview is not available yet")
    url = storage.presign_get(bg.preview_key, settings.PREVIEW_SIGNED_TTL_SECONDS)
    return {"url": url, "expires_in": settings.PREVIEW_SIGNED_TTL_SECONDS}


@router.delete("/backgrounds/{bg_id}")
async def delete_background(
    bg_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    bg = await _get_own_background(bg_id, user, db)
    if bg.upload_id and bg.status == "pending":
        storage.abort_multipart(bg.source_key, bg.upload_id)
    for key in (bg.source_key, bg.clip_key, bg.preview_key):
        if key:
            storage.delete(key)
    await db.delete(bg)
    await db.commit()
    return {"deleted": True}

# ------------------------------------------------------------------ images

ALLOWED_IMAGE_TYPES = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp"}
MAX_IMAGE_UPLOAD_MB = 15


class ImageInit(BaseModel):
    label: str = Field(default="", max_length=80)
    size_bytes: int = Field(gt=0)
    content_type: str
    kind: str = Field(default="image")  # image | character


@router.post(
    "/backgrounds/image-init",
    dependencies=[Depends(rate_limit("upload_init", limit=20, window_seconds=3600))],
)
async def init_image(
    body: ImageInit,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Single-PUT flow for PNG/JPEG/WebP uploads (memes' characters/images).
    Presigned PUT — bytes never pass through the API."""
    content_type = body.content_type.split(";")[0].strip().lower()
    ext = ALLOWED_IMAGE_TYPES.get(content_type)
    if ext is None:
        raise HTTPException(422, detail="content_type must be PNG, JPEG or WebP")
    if body.size_bytes > MAX_IMAGE_UPLOAD_MB * 1024 * 1024:
        raise HTTPException(422, detail=f"File too large (max {MAX_IMAGE_UPLOAD_MB} MB)")
    if body.kind not in ("image", "character"):
        raise HTTPException(422, detail="kind must be image or character")

    bg_id = uuid.uuid4()
    base_dir = f"users/{user.id}/assets/{bg_id}"
    bg = UserBackground(
        id=bg_id,
        user_id=user.id,
        status="pending",
        kind=body.kind,
        label=_sanitize_label(body.label),
        source_key=f"{base_dir}/source{ext}",
    )
    db.add(bg)
    await db.commit()
    url = storage.presign_put(bg.source_key, 900, content_type)
    return {"id": str(bg_id), "url": url}


@router.post("/backgrounds/{bg_id}/image-complete")
async def complete_image(
    bg_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Validate decode, downscale to <=2048px preserving alpha, re-encode WebP,
    mark ready. Sync on purpose — a few hundred ms, no worker round-trip."""
    import asyncio

    return await asyncio.to_thread(_complete_image_sync, bg_id, user.id)


def _complete_image_sync(bg_id: uuid.UUID, user_id: uuid.UUID) -> dict:
    """Runs in a worker thread with its OWN sync session — never touch the
    request's AsyncSession off the event loop."""
    from PIL import Image

    from sync_db import SyncSessionLocal

    with SyncSessionLocal() as db:
        bg = db.get(UserBackground, bg_id)
        if bg is None or bg.user_id != user_id:
            raise HTTPException(403, detail="Not your upload")
        if bg.status != "pending":
            raise HTTPException(409, detail="Upload already finalized")
        src = storage.resolve(bg.source_key)
        if src is None:
            raise HTTPException(404, detail="Upload not found — PUT did not complete")

        import tempfile

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
            out = os.path.join(tempfile.mkdtemp(dir=tempfile.gettempdir()), "asset.webp")
            im.save(out, "WEBP", lossless=has_alpha, quality=90)

        storage.upload(out, clip_key)
        final_path = storage.resolve(clip_key)
        with Image.open(final_path) as final_im:
            bg.clip_key = clip_key
            bg.resolution = f"{final_im.width}x{final_im.height}"
        bg.status = "ready"
        bg.file_size_bytes = os.path.getsize(final_path)
        payload = _to_dict(bg)  # read while attached — commit expires attrs
        db.commit()
        return payload
