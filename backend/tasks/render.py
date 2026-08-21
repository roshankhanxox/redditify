import asyncio
import os
import shutil
import sys
import uuid

from celery import Celery

from config import settings

# Ensure the backend/ directory is importable regardless of how the
# worker process was launched (celery does not always put cwd on sys.path).
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

celery = Celery("reelbot", broker=settings.REDIS_URL, backend=settings.REDIS_URL)


@celery.task(bind=True, max_retries=2, default_retry_delay=30)
def generate_reel(self, job_id: str):
    tmp = os.path.join("/tmp/reelbot", job_id)
    os.makedirs(tmp, exist_ok=True)

    def set_status(status: str, **kwargs):
        from models import Job
        from sync_db import SyncSessionLocal

        with SyncSessionLocal() as db:
            job = db.get(Job, uuid.UUID(job_id))
            if job is None:
                return
            job.status = status
            for k, v in kwargs.items():
                setattr(job, k, v)
            db.commit()

    try:
        from services import assets, storage, title_card, tts, video, whisper_service
        from services.text import preprocess_text
        from models import Job
        from sync_db import SyncSessionLocal

        with SyncSessionLocal() as db:
            job = db.get(Job, uuid.UUID(job_id))
            title = job.post_title
            raw_story = job.post_body
            cfg = job.settings or {}

        subreddit_label = cfg.get("subreddit_label") or "reelbot"

        set_status("GENERATING_VOICEOVER")
        text = preprocess_text(raw_story, subreddit_label, title, max_words=cfg.get("max_words", 1200))
        audio_path = tts.generate_voiceover(
            text, cfg.get("voice", "male"), os.path.join(tmp, "voice.mp3")
        )

        set_status("TRANSCRIBING")
        words = whisper_service.transcribe(audio_path)
        chunks = whisper_service.words_to_chunks(words)
        srt_path = whisper_service.chunks_to_srt(chunks, os.path.join(tmp, "subs.srt"))

        set_status("RENDERING_TITLE_CARD")
        card_path = title_card.render(
            title, subreddit_label,
            cfg.get("title_style", "dark"),
            os.path.join(tmp, "title.png"),
        )

        set_status("PICKING_GAMEPLAY")
        clip_path = asyncio.run(assets.pick_clip(cfg.get("gameplay_category", "any")))

        set_status("COMPOSITING_VIDEO")
        output_path = video.render_video(clip_path, audio_path, card_path, srt_path, os.path.join(tmp, "output.mp4"))
        duration = video.get_duration(output_path)

        set_status("UPLOADING")
        result_key = storage.upload(output_path, f"reels/{job_id}.mp4")

        set_status("DONE", result_url=result_key, duration_seconds=duration)

    except Exception as exc:
        # Auto-retry (max_retries=2, 30s delay) only fires for transient network
        # errors — re-running the whole pipeline after a permanent failure would
        # burn TTS quota for nothing.
        transient = isinstance(exc, (ConnectionError, TimeoutError))
        set_status("FAILED", error_message=str(exc)[:2000])
        if transient and self.request.retries < (self.max_retries or 0):
            raise self.retry(exc=exc)
        raise
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
