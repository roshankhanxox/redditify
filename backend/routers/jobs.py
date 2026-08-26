import re
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
from services.tts import (
    VOICE_CATALOG,
    VALID_EXPRESSIVENESS,
    VALID_TTS_PROVIDERS,
    VALID_VOICE_PERSONALITIES,
)
from services.scenes import DEFAULT_SCENE_ID, get_scene
from services.fonts import get_font_path
from tasks.render import generate_reel

router = APIRouter(tags=["jobs"])

VALID_TITLE_STYLES = ("dark", "light", "minimal")
VALID_CATEGORIES = ("any", "minecraft", "subway_surfers", "satisfying", "other")
VALID_CAPTION_POSITIONS = ("lower", "center", "upper")
VALID_CAPTION_COLORS = ("white", "yellow", "brand")
VALID_TITLE_POSITIONS = ("top", "bottom")
VALID_TEMPLATES = ("story", "meme", "image")

# legacy ids still resolve: original two-voice spec ("male"/"female") plus
# every key retired across catalog rebuilds. Targets are always current keys.
_LEGACY_VOICES = {
    "male": "daniel",
    "female": "sarah",
    "neutral": "river",
    "anton": "antoni",
    "arnold": "eric",
    "chris": "roger",
    "josh": "adam",
    "emily": "lily",
    "rachel": "lily",
    "charlotte": "alice",
    "gigi": "jessica",
    "jessie": "jessica",
}


def _clamp_float(s: dict, key: str, default: float, lo: float, hi: float) -> float:
    try:
        return max(lo, min(hi, float(s.get(key, default))))
    except (TypeError, ValueError):
        return default


def _sanitize_layers(s: dict) -> dict:
    """characters[] / text_overlays[] for the meme template, read from the
    RAW client payload. Normalized center-anchored placement, whitelisted
    enums, hard caps. Anything failing validation is dropped (not defaulted)
    so hostile shapes never reach ffmpeg/PIL."""
    raw_chars = s.get("characters")
    characters = []
    if isinstance(raw_chars, list):
        for c in raw_chars[:3]:
            if not isinstance(c, dict):
                continue
            asset_id = str(c.get("asset_id") or "")
            try:
                uuid.UUID(asset_id)
            except ValueError:
                continue
            characters.append({
                "asset_id": asset_id,
                "x": _clamp_float(c, "x", 0.5, 0.0, 1.0),
                "y": _clamp_float(c, "y", 0.5, 0.0, 1.0),
                "scale": _clamp_float(c, "scale", 0.35, 0.05, 0.9),
                "flip": bool(c.get("flip")),
                "bob": bool(c.get("bob")),
                "rotation": _clamp_float(c, "rotation", 0.0, -180.0, 180.0),
            })


    raw_texts = s.get("text_overlays")
    texts = []
    if isinstance(raw_texts, list):
        color_re = re.compile(r"^#[0-9a-fA-F]{6}$")
        for t in raw_texts[:3]:
            if not isinstance(t, dict):
                continue
            text = str(t.get("text") or "").replace("\r\n", "\n")[:140]
            if not text.strip():
                continue
            font_id = str(t.get("font_id") or "")
            if get_font_path(font_id) is None:
                continue
            color = str(t.get("color") or "#ffffff")
            align = t.get("align") if t.get("align") in ("left", "center", "right") else "center"
            texts.append({
                "text": text,
                "font_id": font_id,
                "scale": _clamp_float(t, "scale", 0.28, 0.02, 0.98),
                "color": color.lower() if color_re.match(color) else "#ffffff",
                "align": align,
                "x": _clamp_float(t, "x", 0.5, 0.0, 1.0),
                "y": _clamp_float(t, "y", 0.35, 0.0, 1.0),
            })
    return {"characters": characters, "text_overlays": texts}


def _clamp_int(s: dict, key: str, default: int, lo: int, hi: int) -> int:
    try:
        return max(lo, min(hi, int(s.get(key, default))))
    except (TypeError, ValueError):
        return default


def _to_bool(value, default: bool) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        return value.strip().lower() == "true"
    return default


class JobCreate(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    story: str = Field(min_length=1)
    subreddit: str | None = Field(default=None, max_length=50)
    settings: dict = {}


def _sanitize_settings(s: dict) -> dict:
    out = {}
    voice = s.get("voice")
    voice = _LEGACY_VOICES.get(voice, voice)
    out["voice"] = voice if voice in VOICE_CATALOG else "daniel"
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
    expressiveness = s.get("expressiveness")
    out["expressiveness"] = expressiveness if expressiveness in VALID_EXPRESSIVENESS else "expressive"
    personality = s.get("voice_personality")
    out["voice_personality"] = personality if personality in VALID_VOICE_PERSONALITIES else "none"

    # Template dispatch — scene/pitch only meaningful for the meme template.
    out["template"] = s.get("template") if s.get("template") in VALID_TEMPLATES else "story"
    if out["template"] == "meme":
        out["scene_id"] = get_scene(s.get("scene_id"))["id"] if get_scene(s.get("scene_id")) else DEFAULT_SCENE_ID
        try:
            out["tts_pitch"] = max(-12, min(12, int(float(s.get("tts_pitch", 0)))))
        except (TypeError, ValueError):
            out["tts_pitch"] = 0
        # Gradient scenes may be pinned to a single blended frame. New reels
        # default static; jobs stored before this knob keep animated (True).
        out["scene_animated"] = _to_bool(s.get("scene_animated"), False)
    else:
        out["scene_id"] = ""
        out["tts_pitch"] = 0

    # Render customizations — enums are whitelisted and ints clamped here so
    # nothing but known-safe values can ever reach libass/PIL/ffmpeg.
    out["captions_enabled"] = _to_bool(s.get("captions_enabled"), True)
    mode = s.get("caption_mode")
    out["caption_mode"] = mode if mode in ("synced", "static") else "synced"
    layout = s.get("caption_layout")
    out["caption_layout"] = layout if layout in ("chunks", "block") else "chunks"
    out["caption_text"] = str(s.get("caption_text") or "").strip()[:600]
    out["caption_font_size"] = _clamp_int(s, "caption_font_size", 96, 48, 140)
    position = s.get("caption_position")
    out["caption_position"] = position if position in VALID_CAPTION_POSITIONS else "lower"
    # Free-drag caption placement; defaults to the position preset's height.
    out["caption_y"] = _clamp_float(
        s,
        "caption_y",
        {"lower": 0.65, "center": 0.55, "upper": 0.38}.get(out["caption_position"], 0.65),
        0.05,
        0.95,
    )
    color = s.get("caption_color")
    out["caption_color"] = color if color in VALID_CAPTION_COLORS else "white"
    out["caption_outline"] = _clamp_int(s, "caption_outline", 6, 0, 12)
    out["caption_words"] = _clamp_int(s, "caption_words", 2, 1, 3)

    out["title_enabled"] = _to_bool(s.get("title_enabled"), True)
    title_pos = s.get("title_position")
    out["title_position"] = title_pos if title_pos in VALID_TITLE_POSITIONS else "top"
    out["title_scale"] = _clamp_int(s, "title_scale", 100, 60, 130)
    out["title_badge"] = _to_bool(s.get("title_badge"), True)

    try:
        out["max_words"] = max(50, min(2000, int(s.get("max_words", 1200))))
    except (TypeError, ValueError):
        out["max_words"] = 1200

    if out["template"] == "meme":
        out.update(_sanitize_layers(s))
    else:
        out["characters"] = []
        out["text_overlays"] = []
    return out


def thumbnail_key_for(job: Job) -> str:
    return f"users/{job.user_id}/thumbs/{job.id}.jpg"


def preview_key_for(job: Job) -> str:
    return f"users/{job.user_id}/previews/{job.id}.mp4"


def _media_urls(j: Job) -> tuple[str | None, str | None]:
    """(thumbnail_url, preview_url) for a finished job. Thumbnails exist only
    for reels rendered after V2 Phase 2; clients fall back gracefully."""
    if j.status != "DONE" or not j.result_url:
        return None, None
    if settings.STORAGE_BACKEND == "s3":
        return (
            presign_get(thumbnail_key_for(j), 300),
            presign_get(preview_key_for(j), 300),
        )
    return f"/jobs/{j.id}/thumbnail", f"/jobs/{j.id}/preview"


def job_to_dict(j: Job) -> dict:
    thumb_url, preview_url = _media_urls(j)
    return {
        "id": str(j.id),
        "title": j.post_title,
        "story_excerpt": (j.post_body or "")[:120],
        "status": j.status,
        "settings": j.settings,
        "retention": getattr(j, "retention", None) or "ephemeral",
        "result_url": j.result_url,
        "thumbnail_url": thumb_url,
        "preview_url": preview_url,
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

    char_ids = [c["asset_id"] for c in job_settings.get("characters", [])]
    if char_ids:
        rows = (
            await db.scalars(
                select(UserBackground).where(UserBackground.id.in_(
                    [uuid.UUID(i) for i in char_ids]
                ))
            )
        ).all()
        owned = {
            str(r.id)
            for r in rows
            if r.user_id == user.id and r.kind == "character" and r.status == "ready"
        }
        if not set(char_ids).issubset(owned):
            raise HTTPException(403, detail="Unknown character asset")

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
    """Detail payload — includes the full story (regenerate-from-settings
    prefill); the list endpoint keeps excerpt-only bodies."""
    job = await _get_job_checked(job_id, user, db)
    return job_to_dict(job) | {"story": job.post_body}


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
        storage_delete(thumbnail_key_for(job))
        storage_delete(preview_key_for(job))
    await db.delete(job)
    await db.commit()
    return {"deleted": True}


@router.get("/jobs/{job_id}/thumbnail")
async def job_thumbnail(
    job_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Poster frame (local mode). Ownership-checked; S3 mode 302s to a
    short-lived presigned GET instead of proxying bytes through the API."""
    job = await _get_job_checked(job_id, user, db)
    if job.status != "DONE" or not job.result_url:
        raise HTTPException(409, detail="Job has no thumbnail")
    key = thumbnail_key_for(job)
    if settings.STORAGE_BACKEND == "s3":
        from fastapi.responses import RedirectResponse

        return RedirectResponse(presign_get(key, 300))
    from services.storage import resolve

    path = resolve(key)
    if path is None:
        raise HTTPException(404, detail="Thumbnail not found")
    return FileResponse(path, media_type="image/jpeg")


def _generate_preview_sync(job: Job) -> str | None:
    """Backfill the 360x640 preview rendition from the stored result MP4.
    Used for reels rendered before previews existed; blocking by nature, so
    callers must run it off the event loop. Returns a servable local path.
    Only ever deletes files it created itself — never the source reel."""
    import os
    import tempfile

    from services.storage import (
        delete as storage_delete,
        download as storage_download,
        resolve,
        upload as storage_upload,
    )
    from services.video import render_preview

    work = os.path.join(tempfile.gettempdir(), "reelbot-backfill")
    os.makedirs(work, exist_ok=True)
    fetched_src: str | None = None  # temp copy we own (S3 mode only)
    dst = os.path.join(work, f"{job.id}-preview.mp4")
    try:
        if settings.STORAGE_BACKEND == "s3":
            fetched_src = os.path.join(work, f"{job.id}.mp4")
            if storage_download(job.result_url, fetched_src) is None:
                return None
            source = fetched_src
        else:
            source = resolve(job.result_url)
            if source is None:
                return None
        render_preview(source, dst)
        storage_upload(dst, preview_key_for(job))
        return resolve(preview_key_for(job))
    except Exception as exc:  # noqa: BLE001 — preview must never 500 a page
        print(f"[preview-backfill] failed for {job.id}: {exc}")
        try:
            storage_delete(preview_key_for(job))
        except Exception:
            pass
        return None
    finally:
        for p in filter(None, (fetched_src, dst)):
            try:
                os.remove(p)
            except OSError:
                pass


@router.get("/jobs/{job_id}/preview")
async def job_preview(
    job_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """360x640 silent hover-preview rendition. Missing renditions for older
    reels are generated lazily from the stored result on first request."""
    from starlette.concurrency import run_in_threadpool

    job = await _get_job_checked(job_id, user, db)
    if job.status != "DONE" or not job.result_url:
        raise HTTPException(409, detail="Job has no preview")
    key = preview_key_for(job)
    if settings.STORAGE_BACKEND == "s3":
        from fastapi.responses import RedirectResponse
        from services.storage import stat as storage_stat

        if storage_stat(key) is None:
            await run_in_threadpool(_generate_preview_sync, job)
            if storage_stat(key) is None:
                raise HTTPException(404, detail="Preview not found")
        return RedirectResponse(presign_get(key, 300))

    from services.storage import resolve

    path = resolve(key)
    if path is None:
        path = await run_in_threadpool(_generate_preview_sync, job)
    if path is None:
        raise HTTPException(404, detail="Preview not found")
    return FileResponse(path, media_type="video/mp4")


@router.get("/jobs/{job_id}/download")
async def download_job(
    job_id: uuid.UUID,
    inline: bool = False,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Final MP4. inline=true streams/renders in-place for the detail-sheet
    player (no attachment disposition; S3 mode 302s to a disposition-free
    presigned URL); the default forces a download with a safe filename."""
    job = await _get_job_checked(job_id, user, db)
    if job.status != "DONE" or not job.result_url:
        raise HTTPException(409, detail="Job has no downloadable result")
    safe_title = "".join(c for c in job.post_title[:40] if c.isalnum() or c in (" ", "-")).strip() or "reel"
    if settings.STORAGE_BACKEND == "s3":
        filename = None if inline else f"{safe_title}.mp4"
        url = presign_get(job.result_url, settings.DOWNLOAD_SIGNED_TTL_SECONDS, filename=filename)
        if inline:
            from fastapi.responses import RedirectResponse

            return RedirectResponse(url)
        return {"url": url, "expires_in": settings.DOWNLOAD_SIGNED_TTL_SECONDS}
    path = resolve(job.result_url)
    if path is None:
        raise HTTPException(410, detail="Result file is gone")
    if inline:
        return FileResponse(path, media_type="video/mp4")
    return FileResponse(path, media_type="video/mp4", filename=f"{safe_title}.mp4")
