from fastapi import APIRouter, Depends

from security import get_current_user
from services.quota import usage

router = APIRouter(tags=["quota"])


@router.get("/quota/me")
async def my_quota(user=Depends(get_current_user)):
    stats = await usage(user.id)
    if user.role == "admin":
        stats["unlimited"] = True
    stats["plan"] = getattr(user, "plan", "free") or "free"
    return stats
