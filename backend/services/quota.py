import uuid
from datetime import date

from fastapi import Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from db import SessionLocal, get_db
from models import QuotaUsage, User
from security import get_current_user


def today_period() -> str:
    return date.today().isoformat()


def month_period() -> str:
    return date.today().strftime("%Y-%m")


async def get_or_create_quota(db: AsyncSession, user_id: uuid.UUID, period: str) -> QuotaUsage:
    quota = await db.get(QuotaUsage, (user_id, period))
    if quota is None:
        quota = QuotaUsage(user_id=user_id, period=period, count=0)
        db.add(quota)
        await db.flush()
    return quota


async def check_quota(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """FastAPI dependency enforcing free-tier limits. Admins bypass entirely."""
    if current_user.role == "admin":
        return  # No limits
    daily = await get_or_create_quota(db, current_user.id, today_period())
    monthly = await get_or_create_quota(db, current_user.id, month_period())
    if daily.count >= settings.FREE_DAILY_LIMIT:
        raise HTTPException(429, detail=f"Daily limit reached ({settings.FREE_DAILY_LIMIT}/day on free plan)")
    if monthly.count >= settings.FREE_MONTHLY_LIMIT:
        raise HTTPException(429, detail=f"Monthly limit reached ({settings.FREE_MONTHLY_LIMIT}/month on free plan)")


async def increment_quota(user_id: uuid.UUID) -> None:
    """Called after successful job creation."""
    async with SessionLocal() as db:
        daily = await get_or_create_quota(db, user_id, today_period())
        monthly = await get_or_create_quota(db, user_id, month_period())
        daily.count += 1
        monthly.count += 1
        await db.commit()


# --- Clip-job quota (separate, tighter counters; see audit.md A9) ------------
# Reuses the QuotaUsage table under a 'clip:' period namespace so clip counts
# never collide with reel counts on the (user_id, period) primary key.

def clip_today_period() -> str:
    return f"clip:{date.today().isoformat()}"


def clip_month_period() -> str:
    return f"clip:{date.today().strftime('%Y-%m')}"


async def check_clip_quota(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Dependency enforcing free-tier clip-job limits + an in-flight concurrency
    cap. Admins bypass counts but still respect a sane concurrency ceiling."""
    from models import ClipJob

    ACTIVE = ("QUEUED", "DOWNLOADING", "EXTRACTING_AUDIO", "TRANSCRIBING", "ANALYSING", "CLIPPING")
    plan = getattr(current_user, "plan", "free") or "free"
    premium = current_user.role == "admin" or plan == "premium"

    in_flight = await db.scalar(
        select(func.count())
        .select_from(ClipJob)
        .where(ClipJob.user_id == current_user.id, ClipJob.status.in_(ACTIVE))
    )
    cap = settings.PREMIUM_CLIP_CONCURRENT if premium else settings.FREE_CLIP_CONCURRENT
    if (in_flight or 0) >= cap:
        raise HTTPException(429, detail=f"Too many clip jobs running at once (max {cap}). Wait for one to finish.")

    if current_user.role == "admin":
        return  # no count limits for admins

    daily = await get_or_create_quota(db, current_user.id, clip_today_period())
    monthly = await get_or_create_quota(db, current_user.id, clip_month_period())
    if daily.count >= settings.FREE_CLIP_DAILY_LIMIT:
        raise HTTPException(429, detail=f"Daily clip limit reached ({settings.FREE_CLIP_DAILY_LIMIT}/day on free plan)")
    if monthly.count >= settings.FREE_CLIP_MONTHLY_LIMIT:
        raise HTTPException(429, detail=f"Monthly clip limit reached ({settings.FREE_CLIP_MONTHLY_LIMIT}/month on free plan)")


async def increment_clip_quota(user_id: uuid.UUID) -> None:
    async with SessionLocal() as db:
        daily = await get_or_create_quota(db, user_id, clip_today_period())
        monthly = await get_or_create_quota(db, user_id, clip_month_period())
        daily.count += 1
        monthly.count += 1
        await db.commit()


async def usage(user_id: uuid.UUID) -> dict:
    async with SessionLocal() as db:
        daily = await get_or_create_quota(db, user_id, today_period())
        monthly = await get_or_create_quota(db, user_id, month_period())
        return {
            "daily_used": daily.count,
            "daily_limit": settings.FREE_DAILY_LIMIT,
            "monthly_used": monthly.count,
            "monthly_limit": settings.FREE_MONTHLY_LIMIT,
        }
