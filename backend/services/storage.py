import os
import shutil

from config import settings


def _root() -> str:
    return os.path.normpath(os.path.join(os.path.dirname(__file__), "..", settings.LOCAL_STORAGE_PATH))


def upload(path: str, key: str) -> str:
    """Store a file under LOCAL_STORAGE_PATH/key. Returns the logical key stored in jobs.result_url."""
    dest = os.path.join(_root(), key)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    shutil.move(path, dest)
    return key


def resolve(key: str) -> str | None:
    """Map a logical key back to an absolute path, or None if missing."""
    path = os.path.normpath(os.path.join(_root(), key))
    if not path.startswith(_root()) or not os.path.exists(path):
        return None
    return path
