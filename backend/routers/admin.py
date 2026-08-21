import uuid
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from db import get_db
from models import Asset, Job, QuotaUsage, User
from security import require_admin
from services.quota import month_period, today_period

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_admin)])


class UserPatch(BaseModel):
    role: str | None = None
    reset_quota: bool = False


@router.get("/users")
async def list_users(page: int = 1, per_page: int = 10, db: AsyncSession = Depends(get_db)):
    page = max(1, page)
    per_page = min(50, max(1, per_page))
    total = await db.scalar(select(func.count()).select_from(User))
    rows = (
        await db.scalars(
            select(User).order_by(User.created_at.desc()).offset((page - 1) * per_page).limit(per_page)
        )
    ).all()
    items = []
    for u in rows:
        daily = await db.get(QuotaUsage, (u.id, today_period()))
        monthly = await db.get(QuotaUsage, (u.id, month_period()))
        items.append({
            "id": str(u.id),
            "email": u.email,
            "role": u.role,
            "must_change_password": u.must_change_password,
            "created_at": u.created_at.isoformat(),
            "quota": {
                "daily_used": daily.count if daily else 0,
                "monthly_used": monthly.count if monthly else 0,
                "daily_limit": settings.FREE_DAILY_LIMIT,
                "monthly_limit": settings.FREE_MONTHLY_LIMIT,
            },
        })
    return {"items": items, "page": page, "per_page": per_page, "total": total}


@router.patch("/users/{user_id}")
async def patch_user(user_id: uuid.UUID, body: UserPatch, db: AsyncSession = Depends(get_db)):
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(404, detail="User not found")
    if body.role is not None:
        if body.role not in ("free", "admin"):
            raise HTTPException(422, detail="role must be 'free' or 'admin'")
        user.role = body.role
    if body.reset_quota:
        await db.execute(
            QuotaUsage.__table__.delete().where(
                QuotaUsage.user_id == user_id,
                QuotaUsage.period.in_([today_period(), month_period()]),
            )
        )
    await db.commit()
    return {"id": str(user.id), "role": user.role, "quota_reset": body.reset_quota}


@router.get("/jobs")
async def list_all_jobs(page: int = 1, per_page: int = 10, db: AsyncSession = Depends(get_db)):
    page = max(1, page)
    per_page = min(50, max(1, per_page))
    total = await db.scalar(select(func.count()).select_from(Job))
    rows = (
        await db.scalars(
            select(Job).order_by(Job.created_at.desc()).offset((page - 1) * per_page).limit(per_page)
        )
    ).all()
    items = []
    for j in rows:
        owner = await db.get(User, j.user_id)
        d = {
            "id": str(j.id),
            "user_id": str(j.user_id),
            "user_email": owner.email if owner else None,
            "post_id": j.post_id,
            "post_title": j.post_title,
            "status": j.status,
            "duration_seconds": j.duration_seconds,
            "error_message": j.error_message,
            "created_at": j.created_at.isoformat() if j.created_at else None,
        }
        items.append(d)
    return {"items": items, "page": page, "per_page": per_page, "total": total}


@router.get("/stats")
async def stats(db: AsyncSession = Depends(get_db)):
    total_jobs = await db.scalar(select(func.count()).select_from(Job))
    jobs_today = await db.scalar(
        select(func.count()).select_from(Job).where(func.date(Job.created_at) == date.today())
    )
    total_users = await db.scalar(select(func.count()).select_from(User))
    storage_bytes = await db.scalar(select(func.coalesce(func.sum(Asset.file_size_bytes), 0)))
    return {
        "total_jobs": total_jobs,
        "jobs_today": jobs_today,
        "total_users": total_users,
        "storage_bytes": int(storage_bytes),
    }
