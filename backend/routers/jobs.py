import uuid

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from db import get_db
from models import Job, User, UserBackground
from security import get_current_user
from services.jobs import find_active_job
from services.quota import check_quota, increment_quota
from services.storage import presign_get, resolve
from services.tts import VOICE_CATALOG, VALID_TTS_PROVIDERS
from tasks.render import generate_reel

router = APIRouter(tags=["jobs"])

VALID_TITLE_STYLES = ("dark", "light", "minimal")
VALID_CATEGORIES = ("any", "minecraft", "subway_surfers", "satisfying", "other")

# legacy ids from the original two-voice spec still resolve
_LEGACY_VOICES = {"male": "male", "female": "female", "neutral": "rachel"}


class JobCreate(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    story: str = Field(min_length=1)
    subreddit: str | None = Field(default=None, max_length=50)
    settings: dict = {}


def _sanitize_settings(s: dict) -> dict:
    out = {}
    voice = s.get("voice")
    voice = _LEGACY_VOICES.get(voice, voice)
    out["voice"] = voice if voice in VOICE_CATALOG else "male"
    provider = s.get("tts_provider")
    out["tts_provider"] = provider if provider in VALID_TTS_PROVIDERS else "auto"
    try:
        out["speed"] = max(0.8, min(1.5, float(s.get("speed", 1.1))))
    except (TypeError, ValueError):
        out["speed"] = 1.1
    out["title_style"] = s.get("title_style") if s.get("title_style") in VALID_TITLE_STYLES else "dark"
    out["gameplay_category"] = s.get("gameplay_category") if s.get("gameplay_category") in VALID_CATEGORIES else "any"
    source = s.get("gameplay_source")
    out["gameplay_source"] = source if source in ("library", "user") else "library"
    if out["gameplay_source"] == "user":
        out["background_id"] = str(s.get("background_id") or "")
    retention = s.get("retention")
    out["retention"] = retention if retention in ("ephemeral", "retain") else "ephemeral"
    try:
        out["max_words"] = max(50, min(2000, int(s.get("max_words", 1200))))
    except (TypeError, ValueError):
        out["max_words"] = 1200
    return out


def job_to_dict(j: Job) -> dict:
    return {
        "id": str(j.id),
        "title": j.post_title,
        "story_excerpt": (j.post_body or "")[:120],
        "status": j.status,
        "settings": j.settings,
        "retention": getattr(j, "retention", None) or "ephemeral",
        "result_url": j.result_url,
        "result_expires_at": j.result_expires_at.isoformat() if j.result_expires_at else None,
        "error_message": j.error_message,
        "duration_seconds": j.duration_seconds,
        "created_at": j.created_at.isoformat() if j.created_at else None,
        "updated_at": j.updated_at.isoformat() if j.updated_at else None,
    }


@router.post("/jobs", dependencies=[Depends(check_quota)])
async def create_job(
    body: JobCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    existing = await find_active_job(user.id, body.title.strip())
    if existing:
        return {"job_id": str(existing.id), "duplicate": True}

    job_settings = _sanitize_settings(body.settings)
    if job_settings.get("gameplay_source") == "user":
        # Ownership + readiness are validated here AND re-checked in the worker.
        try:
            bg_id = uuid.UUID(job_settings.get("background_id") or "")
        except ValueError:
            raise HTTPException(422, detail="Invalid background id")
        bg = await db.get(UserBackground, bg_id)
        if bg is None or bg.user_id != user.id:
            raise HTTPException(403, detail="Not your background")
        if bg.status != "ready":
            raise HTTPException(422, detail="Background is not ready")

    retention = job_settings.pop("retention", "ephemeral")
    if retention == "retain":
        plan = getattr(user, "plan", "free") or "free"
        if not (user.role == "admin" or plan == "premium"):
            raise HTTPException(403, detail="Retain requires a premium plan")

    job = Job(
        user_id=user.id,
        post_title=body.title.strip(),
        post_body=body.story.strip(),
        status="QUEUED",
        retention=retention,
        settings=job_settings | {"subreddit_label": body.subreddit or ""},
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)

    generate_reel.delay(str(job.id))
    await increment_quota(user.id)

    return {"job_id": str(job.id), "duplicate": False}


async def _get_job_checked(job_id: uuid.UUID, user: User, db: AsyncSession) -> Job:
    job = await db.get(Job, job_id)
    if job is None:
        raise HTTPException(404, detail="Job not found")
    if job.user_id != user.id and user.role != "admin":
        raise HTTPException(403, detail="Not your job")
    return job


@router.get("/jobs")
async def list_jobs(
    page: int = 1,
    per_page: int = 10,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    page = max(1, page)
    per_page = min(50, max(1, per_page))
    total = await db.scalar(select(func.count()).select_from(Job).where(Job.user_id == user.id))
    rows = (
        await db.scalars(
            select(Job).where(Job.user_id == user.id)
            .order_by(Job.created_at.desc())
            .offset((page - 1) * per_page).limit(per_page)
        )
    ).all()
    return {"items": [job_to_dict(j) for j in rows], "page": page, "per_page": per_page, "total": total}


@router.get("/jobs/{job_id}")
async def get_job(
    job_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    job = await _get_job_checked(job_id, user, db)
    return job_to_dict(job)


@router.delete("/jobs/{job_id}")
async def delete_job(
    job_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    job = await _get_job_checked(job_id, user, db)
    if job.status not in ("DONE", "FAILED"):
        # Cancel in-flight work; the worker's set_status() no-ops on missing rows.
        generate_reel.AsyncResult(str(job_id)).revoke(terminate=True)
    if job.result_url:
        from services.storage import delete as storage_delete
        storage_delete(job.result_url)
    await db.delete(job)
    await db.commit()
    return {"deleted": True}


@router.get("/jobs/{job_id}/download")
async def download_job(
    job_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    job = await _get_job_checked(job_id, user, db)
    if job.status != "DONE" or not job.result_url:
        raise HTTPException(409, detail="Job has no downloadable result")
    safe_title = "".join(c for c in job.post_title[:40] if c.isalnum() or c in (" ", "-")).strip() or "reel"
    if settings.STORAGE_BACKEND == "s3":
        # Presigned URL minted only after the ownership check above; forces
        # attachment disposition so nothing renders inline or sniffs content types.
        url = presign_get(
            job.result_url,
            settings.DOWNLOAD_SIGNED_TTL_SECONDS,
            filename=f"{safe_title}.mp4",
        )
        return {"url": url, "expires_in": settings.DOWNLOAD_SIGNED_TTL_SECONDS}
    path = resolve(job.result_url)
    if path is None:
        raise HTTPException(410, detail="Result file is gone")
    return FileResponse(path, media_type="video/mp4", filename=f"{safe_title}.mp4")
