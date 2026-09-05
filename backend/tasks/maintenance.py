"""Periodic storage maintenance (plan.md phases 3-4). Consumed via beat."""
import os
import shutil
import sys
import tempfile
import time
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, update

# Ensure the backend/ directory is importable regardless of how the
# worker process was launched (celery does not always put cwd on sys.path).
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from config import settings  # noqa: E402
from tasks.render import celery  # noqa: E402  (single shared Celery app/worker)

REAP_BATCH = 100


@celery.task
def reap_expired_reels():
    """Delete expired ephemeral reel objects; keep history rows.

    Scheduled every 60 s. SKIP LOCKED makes concurrent workers safe: a row
    locked by one reaper is skipped by the others. S3 errors abort the whole
    batch transaction so nothing is marked expired without its object gone.
    """
    from models import Job
    from services import storage
    from sync_db import SyncSessionLocal

    now = datetime.now(timezone.utc)
    reaped = 0
    with SyncSessionLocal() as db:
        rows = db.execute(
            select(Job.id, Job.result_url, Job.user_id)
            .where(
                Job.status == "DONE",
                Job.retention == "ephemeral",
                Job.result_url.isnot(None),
                Job.result_expires_at <= now,
            )
            .limit(REAP_BATCH)
            .with_for_update(skip_locked=True)
        ).all()
        for job_id, key, user_id in rows:
            storage.delete(key)
            storage.delete(f"users/{user_id}/thumbs/{job_id}.jpg")
            storage.delete(f"users/{user_id}/previews/{job_id}.mp4")
        # Flush deletes first; if storage.delete raised we never reach here.
        db.execute(
            update(Job)
            .where(Job.id.in_([row[0] for row in rows]))
            .values(result_url=None, result_expired_at=datetime.now(timezone.utc))
        )
        db.commit()
        reaped = len(rows)
    if reaped:
        print(f"[reaper] deleted {reaped} expired reel(s)")
    return reaped


@celery.task
def sweep_stale_uploads():
    """Phase 4 sweeper (hourly): fail background uploads stuck in pending /
    processing beyond 48 h and drop their partial objects."""
    from models import UserBackground
    from services import storage
    from sync_db import SyncSessionLocal

    cutoff = datetime.now(timezone.utc) - timedelta(hours=48)
    cleaned = 0
    with SyncSessionLocal() as db:
        rows = db.scalars(
            select(UserBackground).where(
                UserBackground.status.in_(["pending", "processing"]),
                UserBackground.created_at <= cutoff,
            )
        ).all()
        for bg in rows:
            if bg.upload_id:
                storage.abort_multipart(bg.source_key, bg.upload_id)
            base_dir = bg.source_key.rsplit("/", 1)[0]
            for key in (bg.source_key, f"{base_dir}/clip.mp4", f"{base_dir}/preview.mp4"):
                storage.delete(key)
            bg.upload_id = None
            bg.status = "failed"
            bg.error_message = "Upload abandoned — timed out"
            cleaned += 1
        db.commit()
    if cleaned:
        print(f"[sweeper] cleaned {cleaned} stale upload(s)")
    return cleaned


@celery.task
def sweep_worker_tmp():
    """Delete local crash residue in /tmp/reelbot older than 12 h."""
    root = os.path.join(tempfile.gettempdir(), "reelbot")
    if not os.path.isdir(root):
        return 0
    cutoff = time.time() - 12 * 3600
    removed = 0
    for entry in os.listdir(root):
        path = os.path.join(root, entry)
        try:
            if os.path.getmtime(path) < cutoff:
                shutil.rmtree(path, ignore_errors=True)
                removed += 1
        except OSError:
            pass
    if removed:
        print(f"[tmp-sweep] removed {removed} stale temp dir(s)")
    return removed


@celery.task
def sweep_orphan_objects():
    """Weekly audit: every reel/thumb/preview AND clip object under users/* must
    map to a live DB row. True orphans are deleted loudly. Covers both the reel
    pipeline (jobs) and the content-engine clip pipeline (clips)."""
    from models import Clip, ClipJob, Job
    from services import storage
    from sync_db import SyncSessionLocal

    if not storage.is_s3():
        return 0
    keys = set()
    paginator = storage._s3().get_paginator("list_objects_v2")  # internal client use
    for page in paginator.paginate(Bucket=settings.S3_BUCKET, Prefix="users/"):
        for obj in page.get("Contents", []):
            k = obj["Key"]
            if "/reels/" in k or "/thumbs/" in k or "/previews/" in k or "/clips/" in k:
                keys.add(k)
    if not keys:
        return 0
    from sqlalchemy import select as sa_select

    with SyncSessionLocal() as db:
        job_rows = db.execute(
            sa_select(Job.user_id, Job.id).where(Job.result_url.isnot(None))
        ).all()
        # Clip objects live under users/{uid}/clips/{clip_job_id}/{index}{.mp4,_thumb.jpg}.
        # Join clips to their owning ClipJob to recover the user id.
        clip_rows = db.execute(
            sa_select(ClipJob.user_id, Clip.job_id, Clip.index).join(
                ClipJob, ClipJob.id == Clip.job_id
            )
        ).all()

    live = {f"users/{user_id}/reels/{job_id}.mp4" for user_id, job_id in job_rows}
    live |= {f"users/{user_id}/thumbs/{job_id}.jpg" for user_id, job_id in job_rows}
    live |= {f"users/{user_id}/previews/{job_id}.mp4" for user_id, job_id in job_rows}
    for user_id, clip_job_id, index in clip_rows:
        live.add(f"users/{user_id}/clips/{clip_job_id}/{index}.mp4")
        live.add(f"users/{user_id}/clips/{clip_job_id}/{index}_thumb.jpg")

    orphans = sorted(keys - live)
    for key in orphans:
        print(f"[orphan-sweep] deleting unreferenced object: {key}")
        storage.delete(key)
    return len(orphans)
