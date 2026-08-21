import uuid

from sqlalchemy import select

ACTIVE_STATUSES = (
    "QUEUED",
    "FETCHING_POST",
    "GENERATING_VOICEOVER",
    "TRANSCRIBING",
    "RENDERING_TITLE_CARD",
    "PICKING_GAMEPLAY",
    "COMPOSITING_VIDEO",
    "UPLOADING",
)


async def find_active_job(user_id: uuid.UUID, post_id: str):
    """Return an existing in-flight job for the same user+post, for duplicate detection."""
    from db import SessionLocal
    from models import Job

    async with SessionLocal() as db:
        return await db.scalar(
            select(Job).where(
                Job.user_id == user_id,
                Job.post_id == post_id,
                Job.status.in_(ACTIVE_STATUSES),
            )
        )
