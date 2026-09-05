import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db import get_db
from models import User
from ratelimit import rate_limit
from security import create_access_token, get_current_user, hash_password, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])


class RegisterBody(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)


class LoginBody(BaseModel):
    email: EmailStr
    password: str


class ChangePasswordBody(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8)


@router.post(
    "/register",
    status_code=201,
    dependencies=[Depends(rate_limit("register", limit=3, window_seconds=3600))],
)
async def register(body: RegisterBody, db: AsyncSession = Depends(get_db)):
    existing = await db.scalar(select(User).where(User.email == body.email))
    if existing:
        raise HTTPException(409, detail="Email already registered")
    user = User(email=str(body.email), password_hash=hash_password(body.password), role="free")
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return {"id": str(user.id), "email": user.email}


@router.post(
    "/login",
    dependencies=[Depends(rate_limit("login", limit=10, window_seconds=60))],
)
async def login(body: LoginBody, db: AsyncSession = Depends(get_db)):
    user = await db.scalar(select(User).where(User.email == body.email))
    if user is None or not verify_password(body.password, user.password_hash):
        raise HTTPException(401, detail="Invalid email or password")
    token = create_access_token(user)
    return {
        "token": token,
        "user": {
            "id": str(user.id),
            "email": user.email,
            "role": user.role,
            "must_change_password": user.must_change_password,
        },
    }


@router.post("/change-password")
async def change_password(
    body: ChangePasswordBody,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(403, detail="Current password is incorrect")
    user.password_hash = hash_password(body.new_password)
    user.must_change_password = False
    await db.commit()
    return {"ok": True}


@router.get("/me")
async def me(user: User = Depends(get_current_user)):
    return {
        "id": str(user.id),
        "email": user.email,
        "role": user.role,
        "must_change_password": user.must_change_password,
    }
