import os
import random
import uuid

from sqlalchemy import select

from config import settings
from db import SessionLocal
from models import Asset


def clips_dir() -> str:
    return os.path.normpath(os.path.join(os.path.dirname(__file__), "..", settings.ASSETS_DIR))


def clip_path(filename: str) -> str:
    return os.path.join(clips_dir(), filename)


async def all_assets() -> list[Asset]:
    async with SessionLocal() as db:
        return list((await db.scalars(select(Asset))).all())


async def get_asset(asset_id) -> Asset | None:
    async with SessionLocal() as db:
        return await db.get(Asset, asset_id)


async def create_asset(filename: str, category: str, duration_seconds: float | None,
                       file_size_bytes: int | None, resolution: str | None) -> Asset:
    async with SessionLocal() as db:
        asset = Asset(
            filename=filename,
            category=category,
            duration_seconds=duration_seconds,
            file_size_bytes=file_size_bytes,
            resolution=resolution,
            enabled=True,
        )
        db.add(asset)
        await db.commit()
        await db.refresh(asset)
        return asset


async def update_asset(asset_id, **kwargs) -> Asset | None:
    async with SessionLocal() as db:
        asset = await db.get(Asset, asset_id)
        if asset is None:
            return None
        for k, v in kwargs.items():
            setattr(asset, k, v)
        await db.commit()
        await db.refresh(asset)
        return asset


async def delete_asset(asset_id) -> bool:
    """Delete record. Returns False if it's the last enabled clip."""
    async with SessionLocal() as db:
        asset = await db.get(Asset, asset_id)
        if asset is None:
            return True
        if asset.enabled:
            others = await db.scalar(
                select(Asset.id).where(Asset.enabled == True, Asset.id != asset_id).limit(1)  # noqa: E712
            )
            if others is None:
                return False
        path = clip_path(asset.filename)
        if os.path.exists(path):
            os.remove(path)
        await db.delete(asset)
        await db.commit()
        return True


async def pick_clip(category: str = "any") -> str:
    """Pick a random enabled clip, optionally filtered by category. Returns full path."""
    query = select(Asset).where(Asset.enabled == True)  # noqa: E712
    if category != "any":
        query = query.where(Asset.category == category)
    async with SessionLocal() as db:
        assets = list((await db.scalars(query)).all())
    if not assets:
        raise RuntimeError(f"No enabled gameplay clips for category '{category}'")
    chosen = random.choice(assets)
    path = clip_path(chosen.filename)
    if not os.path.exists(path):
        raise RuntimeError(f"Clip file missing on disk: {chosen.filename}")
    return path
