import uuid

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from db import get_db
from models import Job
from security import get_current_user
from services.quota import usage

router = APIRouter(tags=["stats"])


@router.get("/stats/me")
async def my_stats(
    user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Aggregates for the dashboard home strip."""
    row = await db.execute(
        select(func.count(Job.id), func.coalesce(func.sum(Job.duration_seconds), 0.0))
        .where(Job.user_id == user.id, Job.status == "DONE")
    )
    total_reels, total_seconds = row.one()
    quota = await usage(user.id)
    unlimited = user.role == "admin"
    return {
        "total_reels": int(total_reels or 0),
        "total_seconds": round(float(total_seconds or 0.0), 1),
        **quota,
        "unlimited": unlimited,
        "plan": getattr(user, "plan", "free") or "free",
    }
