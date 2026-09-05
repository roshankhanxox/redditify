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
    # Clip jobs are far more expensive than reels (Whisper + LLM + N encodes);
    # they get their own, tighter counters and an in-flight concurrency cap.
    FREE_CLIP_DAILY_LIMIT: int = 2
    FREE_CLIP_MONTHLY_LIMIT: int = 15
    FREE_CLIP_CONCURRENT: int = 1
    PREMIUM_CLIP_CONCURRENT: int = 3
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


_PLACEHOLDER_SECRET = "replace_with_64_char_random_string"


def _validate(s: "Settings") -> None:
    """Fail fast on insecure config. A signing key that is the shipped
    placeholder — or too short to be safe — lets anyone forge admin JWTs, so we
    refuse to boot rather than sign tokens with a publicly known secret."""
    if s.SECRET_KEY == _PLACEHOLDER_SECRET or len(s.SECRET_KEY) < 32:
        raise RuntimeError(
            "SECRET_KEY is unset, the shipped placeholder, or shorter than 32 "
            "chars. Generate one with `python -c \"import secrets; "
            "print(secrets.token_urlsafe(48))\"` and set it in backend/.env."
        )


settings = Settings()
_validate(settings)
