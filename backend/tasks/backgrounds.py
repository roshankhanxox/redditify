import os
import shutil
import sys
import tempfile
import uuid

# Ensure the backend/ directory is importable regardless of how the
# worker process was launched (celery does not always put cwd on sys.path).
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tasks.render import celery  # noqa: E402  (single shared Celery app/worker)


MIN_DURATION_SECONDS = 30.0
MAX_DURATION_SECONDS = 600.0


@celery.task(bind=True, max_retries=1, default_retry_delay=30)
def process_background(self, background_id: str):
    """Probe + normalize a user-uploaded background after multipart completion.

    Validates with ffprobe (never trusting client metadata), transcodes to a
    normalized 1080x1920 clip plus a low-quality preview, and uploads both.
    Any validation failure deletes every object and marks the row failed —
    the owner sees error_message; nobody else ever does.
    """
    tmp = os.path.join(tempfile.gettempdir(), "reelbot-bg", background_id)
    os.makedirs(tmp, exist_ok=True)

    def set_status(status: str | None = None, **kwargs):
        from models import UserBackground
        from sync_db import SyncSessionLocal

        with SyncSessionLocal() as db:
            bg = db.get(UserBackground, uuid.UUID(background_id))
            if bg is None:
                return
            if status:
                bg.status = status
            for k, v in kwargs.items():
                setattr(bg, k, v)
            db.commit()

    try:
        from models import UserBackground
        from services import storage, video
        from sync_db import SyncSessionLocal

        with SyncSessionLocal() as db:
            bg = db.get(UserBackground, uuid.UUID(background_id))
            if bg is None or bg.status != "pending":
                return
            source_key = bg.source_key
            base_dir = source_key.rsplit("/", 1)[0]
            clip_key = f"{base_dir}/clip.mp4"
            preview_key = f"{base_dir}/preview.mp4"

        set_status("processing")

        src = storage.resolve(source_key)
        if src is None:
            raise RuntimeError("Uploaded file missing from storage")

        duration = video.get_duration(src)
        video.get_resolution(src)  # raises ValueError when there is no video stream
        if duration < MIN_DURATION_SECONDS:
            raise ValueError(f"Clip too short: {duration:.1f}s (minimum {MIN_DURATION_SECONDS:.0f}s)")
        if duration > MAX_DURATION_SECONDS:
            raise ValueError(f"Clip too long: {duration:.1f}s (maximum {MAX_DURATION_SECONDS:.0f}s)")

        clip_local = video.transcode_vertical(src, os.path.join(tmp, "clip.mp4"))
        preview_local = video.render_preview(src, os.path.join(tmp, "preview.mp4"))

        storage.upload(clip_local, clip_key)
        storage.upload(preview_local, preview_key)

        meta = storage.stat(source_key) or {}
        set_status(
            "ready",
            clip_key=clip_key,
            preview_key=preview_key,
            duration_seconds=round(duration, 2),
            file_size_bytes=meta.get("size_bytes"),
            resolution="1080x1920",
            error_message=None,
        )

    except Exception as exc:
        transient = isinstance(exc, (ConnectionError, TimeoutError))
        # Best-effort cleanup of partial outputs so failed rows leave no objects.
        try:
            from models import UserBackground
            from services import storage
            from sync_db import SyncSessionLocal

            with SyncSessionLocal() as db:
                bg = db.get(UserBackground, uuid.UUID(background_id))
                base_dir = bg.source_key.rsplit("/", 1)[0] if bg else None
            if base_dir:
                storage.delete(f"{base_dir}/clip.mp4")
                storage.delete(f"{base_dir}/preview.mp4")
        except Exception:
            pass
        set_status("failed", error_message=str(exc)[:500])
        if transient and self.request.retries < (self.max_retries or 0):
            raise self.retry(exc=exc)
        raise
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
