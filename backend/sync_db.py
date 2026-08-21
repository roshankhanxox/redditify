from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from config import settings

# Celery workers run synchronous task code, so they use a sync engine
# (psycopg2) derived from the same DATABASE_URL the async API uses.
_sync_url = settings.DATABASE_URL.replace("+asyncpg", "+psycopg2")
engine = create_engine(_sync_url)
SyncSessionLocal = sessionmaker(bind=engine)
