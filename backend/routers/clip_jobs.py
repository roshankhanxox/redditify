"""REST API for the content engine clip pipeline.

POST   /clip-jobs                              Start analysis + clipping job
GET    /clip-jobs                              Paginated list for the current user
GET    /clip-jobs/{id}                         Full status + clips array
DELETE /clip-jobs/{id}                         Cancel + delete
GET    /clip-jobs/{id}/clips/{clip_id}/download  Download a finished clip
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from db import get_db
from models import Clip, ClipJob, User, UserBackground
from ratelimit import rate_limit
from security import get_current_user
from services.quota import check_clip_quota, increment_clip_quota
from services.storage import presign_get, resolve as storage_resolve, delete as storage_delete

router = APIRouter(tags=["clip-jobs"])

VALID_CLIP_TYPES = {"opinion_bomb", "story_peak", "value_drop", "pattern_interrupt", "quotable_moment", "emotional_peak"}


# ── serialisers ──────────────────────────────────────────────────────────────

def clip_to_dict(c: Clip, user_id: str, job_id: str) -> dict:
    thumb_key = f"users/{user_id}/clips/{job_id}/{c.index}_thumb.jpg"
    thumb_url = None
    if c.status == "done":
        if settings.STORAGE_BACKEND == "s3":
            thumb_url = presign_get(thumb_key, 300)
        else:
            from services.storage import stat as storage_stat
            if storage_stat(thumb_key):
                thumb_url = f"/clip-jobs/{job_id}/clips/{c.id}/thumbnail"

    return {
        "id": str(c.id),
        "index": c.index,
        "start_seconds": c.start_seconds,
        "end_seconds": c.end_seconds,
        "duration_seconds": c.duration_seconds,
        "hook": c.hook,
        "reason": c.reason,
        "engagement_score": c.engagement_score,
        "clip_type": c.clip_type,
        "status": c.status,
        "result_key": c.result_key,
        "thumbnail_url": thumb_url,
        "created_at": c.created_at.isoformat() if c.created_at else None,
    }


def job_to_dict(j: ClipJob, clips: list[Clip] | None = None) -> dict:
    uid = str(j.user_id)
    jid = str(j.id)
    return {
        "id": jid,
        "source_label": j.source_label,
        "status": j.status,
        "clip_count": j.clip_count,
        "error_message": j.error_message,
        "settings": j.settings,
        "clips": [clip_to_dict(c, uid, jid) for c in (clips or [])],
        "created_at": j.created_at.isoformat() if j.created_at else None,
        "updated_at": j.updated_at.isoformat() if j.updated_at else None,
    }


# ── helpers ──────────────────────────────────────────────────────────────────

async def _get_job_checked(job_id: uuid.UUID, user: User, db: AsyncSession) -> ClipJob:
    job = await db.get(ClipJob, job_id)
    if job is None:
        raise HTTPException(404, detail="Clip job not found")
    if job.user_id != user.id and user.role != "admin":
        raise HTTPException(403, detail="Not your clip job")
    return job


# ── routes ───────────────────────────────────────────────────────────────────

class ClipJobCreate(BaseModel):
    background_id: str = Field(description="ID of a ready UserBackground (video kind) to analyse")
    label: str = Field(default="", max_length=200)
    settings: dict = {}


def _sanitize_clip_settings(s: dict) -> dict:
    out: dict = {}
    try:
        out["num_clips"] = max(1, min(settings.MAX_CLIPS_PER_JOB, int(s.get("num_clips", 10))))
    except (TypeError, ValueError):
        out["num_clips"] = 10

    out["captions_enabled"] = bool(s.get("captions_enabled", True))

    try:
        out["caption_font_size"] = max(48, min(140, int(s.get("caption_font_size", 96))))
    except (TypeError, ValueError):
        out["caption_font_size"] = 96

    try:
        out["caption_outline"] = max(0, min(12, int(s.get("caption_outline", 6))))
    except (TypeError, ValueError):
        out["caption_outline"] = 6

    valid_colors = {"white", "yellow", "brand"}
    color = s.get("caption_color", "white")
    out["caption_color"] = color if color in valid_colors else "white"

    valid_positions = {"lower", "center", "upper"}
    pos = s.get("caption_position", "lower")
    out["caption_position"] = pos if pos in valid_positions else "lower"

    valid_animations = {"none", "karaoke"}
    anim = s.get("caption_animation", "none")
    out["caption_animation"] = anim if anim in valid_animations else "none"

    valid_highlights = {"white", "yellow", "brand"}
    hl = s.get("caption_highlight_color", "yellow")
    out["caption_highlight_color"] = hl if hl in valid_highlights else "yellow"

    return out


@router.post(
    "/clip-jobs",
    dependencies=[
        Depends(rate_limit("clip_create", limit=10, window_seconds=60)),
        Depends(check_clip_quota),
    ],
)
async def create_clip_job(
    body: ClipJobCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # Validate background ownership + readiness
    try:
        bg_id = uuid.UUID(body.background_id)
    except ValueError:
        raise HTTPException(422, detail="Invalid background_id")

    bg = await db.get(UserBackground, bg_id)
    if bg is None or bg.user_id != user.id:
        raise HTTPException(403, detail="Not your background")
    if bg.kind != "video":
        raise HTTPException(422, detail="Only video backgrounds can be analysed")
    if bg.status != "ready":
        raise HTTPException(422, detail="Background is not ready yet")
    if not bg.source_key:
        raise HTTPException(422, detail="Background has no source video")

    job_settings = _sanitize_clip_settings(body.settings)

    job = ClipJob(
        user_id=user.id,
        source_key=bg.source_key,
        source_label=body.label.strip() or bg.label or "Untitled",
        status="QUEUED",
        settings=job_settings,
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)

    from tasks.clip import analyse_and_clip
    analyse_and_clip.delay(str(job.id))
    await increment_clip_quota(user.id)

    return {"clip_job_id": str(job.id)}


@router.get("/clip-jobs")
async def list_clip_jobs(
    page: int = 1,
    per_page: int = 10,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    page = max(1, page)
    per_page = min(50, max(1, per_page))
    total = await db.scalar(
        select(func.count()).select_from(ClipJob).where(ClipJob.user_id == user.id)
    )
    rows = (
        await db.scalars(
            select(ClipJob)
            .where(ClipJob.user_id == user.id)
            .order_by(ClipJob.created_at.desc())
            .offset((page - 1) * per_page)
            .limit(per_page)
        )
    ).all()
    return {
        "items": [job_to_dict(j) for j in rows],
        "page": page,
        "per_page": per_page,
        "total": total,
    }


@router.get("/clip-jobs/{job_id}")
async def get_clip_job(
    job_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    job = await _get_job_checked(job_id, user, db)
    clips = (
        await db.scalars(
            select(Clip).where(Clip.job_id == job_id).order_by(Clip.index)
        )
    ).all()
    return job_to_dict(job, list(clips))


@router.delete("/clip-jobs/{job_id}")
async def delete_clip_job(
    job_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    job = await _get_job_checked(job_id, user, db)
    uid = str(job.user_id)
    jid = str(job.id)

    # Revoke in-flight task
    if job.status not in ("DONE", "FAILED"):
        from tasks.clip import analyse_and_clip
        analyse_and_clip.AsyncResult(jid).revoke(terminate=True)

    # Delete all clip files from storage
    clips = (await db.scalars(select(Clip).where(Clip.job_id == job_id))).all()
    for c in clips:
        if c.result_key:
            storage_delete(c.result_key)
        storage_delete(f"users/{uid}/clips/{jid}/{c.index}_thumb.jpg")

    await db.delete(job)
    await db.commit()
    return {"deleted": True}


@router.delete("/clip-jobs/{job_id}/clips/{clip_id}")
async def delete_clip(
    job_id: uuid.UUID,
    clip_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    job = await _get_job_checked(job_id, user, db)
    clip = await db.get(Clip, clip_id)
    if clip is None or clip.job_id != job_id:
        raise HTTPException(404, detail="Clip not found")

    uid = str(job.user_id)
    jid = str(job.id)

    if clip.result_key:
        storage_delete(clip.result_key)
    storage_delete(f"users/{uid}/clips/{jid}/{clip.index}_thumb.jpg")

    await db.delete(clip)
    # Decrement job clip_count
    job.clip_count = max(0, job.clip_count - 1)
    await db.commit()
    return {"deleted": True}


@router.get("/clip-jobs/{job_id}/clips/{clip_id}/download")
async def download_clip(
    job_id: uuid.UUID,
    clip_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    job = await _get_job_checked(job_id, user, db)
    clip = await db.get(Clip, clip_id)
    if clip is None or clip.job_id != job_id:
        raise HTTPException(404, detail="Clip not found")
    if clip.status != "done" or not clip.result_key:
        raise HTTPException(409, detail="Clip is not ready")

    if settings.STORAGE_BACKEND == "s3":
        url = presign_get(clip.result_key, settings.DOWNLOAD_SIGNED_TTL_SECONDS, filename=f"clip_{clip.index + 1}.mp4")
        return {"url": url, "expires_in": settings.DOWNLOAD_SIGNED_TTL_SECONDS}

    path = storage_resolve(clip.result_key)
    if path is None:
        raise HTTPException(410, detail="Clip file is gone")
    return FileResponse(path, media_type="video/mp4", filename=f"clip_{clip.index + 1}.mp4")


@router.get("/clip-jobs/{job_id}/clips/{clip_id}/thumbnail")
async def clip_thumbnail(
    job_id: uuid.UUID,
    clip_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    job = await _get_job_checked(job_id, user, db)
    clip = await db.get(Clip, clip_id)
    if clip is None or clip.job_id != job_id:
        raise HTTPException(404, detail="Clip not found")

    uid = str(job.user_id)
    jid = str(job.id)
    key = f"users/{uid}/clips/{jid}/{clip.index}_thumb.jpg"

    if settings.STORAGE_BACKEND == "s3":
        from fastapi.responses import RedirectResponse
        return RedirectResponse(presign_get(key, 300))

    path = storage_resolve(key)
    if path is None:
        raise HTTPException(404, detail="Thumbnail not found")
    return FileResponse(path, media_type="image/jpeg")
