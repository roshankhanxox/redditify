import asyncio

from passlib.context import CryptContext
from sqlalchemy import select

from db import SessionLocal
from models import User

pwd = CryptContext(schemes=["bcrypt"])


async def seed():
    async with SessionLocal() as db:
        existing = await db.scalar(select(User).where(User.email == "admin@reelbot.local"))
        if not existing:
            user = User(
                email="admin@reelbot.local",
                password_hash=pwd.hash("admin1234"),
                role="admin",
                must_change_password=True,
            )
            db.add(user)
            await db.commit()
            print("Admin user created: admin@reelbot.local / admin1234")
        else:
            print("Admin user already exists")


if __name__ == "__main__":
    asyncio.run(seed())
