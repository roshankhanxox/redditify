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

    # S3 object storage (STORAGE_BACKEND='s3'); S3_ENDPOINT_URL targets MinIO in dev.
    S3_ENDPOINT_URL: str = ""
    S3_REGION: str = "us-east-1"
    S3_BUCKET: str = "reelbot-dev"
    AWS_ACCESS_KEY_ID: str = ""
    AWS_SECRET_ACCESS_KEY: str = ""

    # Retention + garbage collection
    RETENTION_TTL_MINUTES: int = 15
    SCRATCH_TTL_HOURS: int = 24
    MAX_BACKGROUND_UPLOAD_MB: int = 500

    # Presigned URL lifetimes (seconds)
    PREVIEW_SIGNED_TTL_SECONDS: int = 900
    DOWNLOAD_SIGNED_TTL_SECONDS: int = 600
    UPLOAD_PART_SIGNED_TTL_SECONDS: int = 3600

    # Per-user background footage caps
    FREE_MAX_BACKGROUNDS: int = 3
    PREMIUM_MAX_BACKGROUNDS: int = 25
    FREE_DAILY_LIMIT: int = 3
    FREE_MONTHLY_LIMIT: int = 30
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7

    # LLM provider for clip analysis (anthropic | openai | groq)
    LLM_PROVIDER: str = "anthropic"
    ANTHROPIC_API_KEY: str = ""
    OPENAI_API_KEY: str = ""
    GROQ_API_KEY: str = ""
    LLM_MODEL_ANTHROPIC: str = "claude-sonnet-4-6"
    LLM_MODEL_OPENAI: str = "gpt-4o"
    LLM_MODEL_GROQ: str = "llama-3.3-70b-versatile"
    MAX_CLIPS_PER_JOB: int = 10

    class Config:
        env_file = os.path.join(os.path.dirname(__file__), ".env")


settings = Settings()
