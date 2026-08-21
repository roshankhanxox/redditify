import asyncio

from passlib.context import CryptContext
from sqlalchemy import select

from db import SessionLocal
from models import User

pwd = CryptContext(schemes=["bcrypt"])


async def seed():
    async with SessionLocal() as db:
        # NOTE: spec originally said admin@reelbot.local, but pydantic's EmailStr
        # rejects reserved TLDs like .local — use any deliverable-looking domain.
        existing = await db.scalar(select(User).where(User.email == "admin@reelbot.dev"))
        if not existing:
            legacy = await db.scalar(select(User).where(User.email == "admin@reelbot.local"))
            if legacy:
                legacy.email = "admin@reelbot.dev"
                await db.commit()
                print("Admin user migrated: admin@reelbot.local -> admin@reelbot.dev")
                return
            user = User(
                email="admin@reelbot.dev",
                password_hash=pwd.hash("admin1234"),
                role="admin",
                must_change_password=True,
            )
            db.add(user)
            await db.commit()
            print("Admin user created: admin@reelbot.dev / admin1234")
        else:
            print("Admin user already exists")


if __name__ == "__main__":
    asyncio.run(seed())
