import os

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql+asyncpg://reelbot:reelbot@localhost:5432/reelbot"
    REDIS_URL: str = "redis://localhost:6379/0"
    SECRET_KEY: str = "replace_with_64_char_random_string"
    ELEVENLABS_API_KEY: str = ""
    REDDIT_CLIENT_ID: str = ""
    REDDIT_CLIENT_SECRET: str = ""
    STORAGE_BACKEND: str = "local"
    LOCAL_STORAGE_PATH: str = "./outputs"
    ASSETS_DIR: str = "./assets/gameplay"
    FREE_DAILY_LIMIT: int = 3
    FREE_MONTHLY_LIMIT: int = 30
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7

    class Config:
        env_file = os.path.join(os.path.dirname(__file__), ".env")


settings = Settings()
