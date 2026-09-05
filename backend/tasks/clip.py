"""Celery task: analyse_and_clip

Pipeline stages:
  DOWNLOADING       → download source video from MinIO
  EXTRACTING_AUDIO  → FFmpeg strip video track
  TRANSCRIBING      → Whisper word-level timestamps
  ANALYSING         → LLM selects 10 best clip windows
  CLIPPING          → extract + transcode + captions + upload per clip
  DONE / FAILED
"""

import logging
import os
import shutil
import sys
import uuid

from tasks.render import celery  # reuse the shared Celery instance

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

logger = logging.getLogger(__name__)


def _set_status(job_id: str, status: str, **kwargs):
    from models import ClipJob
    from sync_db import SyncSessionLocal

    with SyncSessionLocal() as db:
        job = db.get(ClipJob, uuid.UUID(job_id))
        if job is None:
            return
        job.status = status
        for k, v in kwargs.items():
            setattr(job, k, v)
        db.commit()


@celery.task(bind=True, max_retries=2, default_retry_delay=30, name="tasks.clip.analyse_and_clip")
def analyse_and_clip(self, clip_job_id: str):
    tmp = os.path.join("/tmp/reelbot-clips", clip_job_id)
    os.makedirs(tmp, exist_ok=True)

    try:
        from models import Clip, ClipJob
        from services import storage, video, whisper_service
        from services.clip_analyser import analyse
        from sync_db import SyncSessionLocal

        # Load job
        with SyncSessionLocal() as db:
            job = db.get(ClipJob, uuid.UUID(clip_job_id))
            if job is None:
                logger.error("ClipJob %s not found", clip_job_id)
                return
            source_key = job.source_key
            user_id = str(job.user_id)
            cfg = job.settings or {}
            num_clips = int(cfg.get("num_clips", 10))

        # 1. Download source video
        _set_status(clip_job_id, "DOWNLOADING")
        video_path = os.path.join(tmp, "source.mp4")
        if storage.download(source_key, video_path) is None:
            raise RuntimeError(f"Source video not found in storage: {source_key}")

        video_duration = video.get_duration(video_path)

        # 2. Extract audio
        _set_status(clip_job_id, "EXTRACTING_AUDIO")
        audio_path = os.path.join(tmp, "audio.mp3")
        video.run_ffmpeg([
            "-i", video_path,
            "-vn", "-acodec", "libmp3lame", "-q:a", "2",
            audio_path,
        ])

        # 3. Transcribe
        _set_status(clip_job_id, "TRANSCRIBING")
        words = whisper_service.transcribe(audio_path)
        if not words:
            raise RuntimeError("Whisper returned empty transcript — is there audio in the video?")

        # 4. LLM analysis
        _set_status(clip_job_id, "ANALYSING")
        clip_windows = analyse(words, video_duration, num_clips=num_clips)
        if not clip_windows:
            raise RuntimeError("LLM returned no valid clip windows")

        logger.info("ClipJob %s: %d clip windows selected", clip_job_id, len(clip_windows))

        # 5. Create Clip rows (pending) so the frontend can poll progress
        with SyncSessionLocal() as db:
            for i, w in enumerate(clip_windows):
                clip = Clip(
                    job_id=uuid.UUID(clip_job_id),
                    index=i,
                    start_seconds=w.start,
                    end_seconds=w.end,
                    hook=w.hook,
                    reason=w.reason,
                    engagement_score=w.engagement_score,
                    clip_type=w.clip_type,
                    status="pending",
                )
                db.add(clip)
            db.commit()

        # 6. Extract + transcode + caption each clip
        _set_status(clip_job_id, "CLIPPING")

        captions_on = bool(cfg.get("captions_enabled", True))
        caption_style_cfg = {
            "caption_font_size": cfg.get("caption_font_size", 96),
            "caption_outline": cfg.get("caption_outline", 6),
            "caption_color": cfg.get("caption_color", "white"),
            "caption_position": cfg.get("caption_position", "lower"),
        }

        completed = 0
        for i, w in enumerate(clip_windows):
            clip_tmp = os.path.join(tmp, f"clip_{i}")
            os.makedirs(clip_tmp, exist_ok=True)

            with SyncSessionLocal() as db:
                clip_row = db.scalars(
                    __import__("sqlalchemy", fromlist=["select"]).select(Clip)
                    .where(Clip.job_id == uuid.UUID(clip_job_id), Clip.index == i)
                ).first()
                clip_id = str(clip_row.id) if clip_row else None

            try:
                duration = w.end - w.start

                # Extract raw segment (original aspect, original audio)
                raw_path = os.path.join(clip_tmp, "raw.mp4")
                video.extract_clip(video_path, raw_path, w.start, duration)

                # Transcode to 9:16 vertical (no audio — keep separate)
                vertical_path = os.path.join(clip_tmp, "vertical.mp4")
                video.transcode_vertical(raw_path, vertical_path)

                # Extract audio from the raw clip for caption sync
                clip_audio_path = os.path.join(clip_tmp, "clip_audio.mp3")
                video.run_ffmpeg([
                    "-i", raw_path,
                    "-vn", "-acodec", "libmp3lame", "-q:a", "2",
                    clip_audio_path,
                ])

                # Captions: slice Whisper words to this clip's time window
                subs_path = None
                if captions_on:
                    clip_words = [
                        {**word, "start": word["start"] - w.start, "end": word["end"] - w.start}
                        for word in words
                        if word.get("start", 0.0) >= w.start and word.get("end", 0.0) <= w.end
                    ]
                    if clip_words:
                        style = whisper_service.caption_style_from_settings(caption_style_cfg)
                        chunks = whisper_service.words_to_chunks(clip_words, chunk_size=2)
                        if chunks:
                            subs_path = os.path.join(clip_tmp, "subs.ass")
                            whisper_service.chunks_to_ass(chunks, subs_path, style=style)

                # Composite: vertical video + original audio + captions
                output_path = os.path.join(clip_tmp, "output.mp4")
                _render_clip_composite(vertical_path, clip_audio_path, output_path, subs_path)

                # Upload
                result_key = f"users/{user_id}/clips/{clip_job_id}/{i}.mp4"
                storage.upload(output_path, result_key)
                clip_duration = video.get_duration(
                    storage.resolve(result_key) or output_path
                )

                # Thumbnail
                try:
                    thumb_path = os.path.join(clip_tmp, "thumb.jpg")
                    video.extract_thumbnail(raw_path, thumb_path, at_seconds=min(1.0, duration * 0.1))
                    storage.upload(thumb_path, f"users/{user_id}/clips/{clip_job_id}/{i}_thumb.jpg")
                except Exception as exc:
                    logger.warning("Clip %d thumbnail failed: %s", i, exc)

                # Mark clip done
                if clip_id:
                    with SyncSessionLocal() as db:
                        cr = db.get(Clip, uuid.UUID(clip_id))
                        if cr:
                            cr.status = "done"
                            cr.result_key = result_key
                            cr.duration_seconds = clip_duration
                            db.commit()

                completed += 1
                _set_status(clip_job_id, "CLIPPING", clip_count=completed)
                logger.info("ClipJob %s: clip %d/%d done", clip_job_id, i + 1, len(clip_windows))

            except Exception as exc:
                logger.error("ClipJob %s: clip %d failed: %s", clip_job_id, i, exc)
                if clip_id:
                    with SyncSessionLocal() as db:
                        cr = db.get(Clip, uuid.UUID(clip_id))
                        if cr:
                            cr.status = "failed"
                            db.commit()
            finally:
                shutil.rmtree(clip_tmp, ignore_errors=True)

        if completed == 0:
            raise RuntimeError("All clips failed to render")

        _set_status(clip_job_id, "DONE", clip_count=completed)
        logger.info("ClipJob %s: done (%d/%d clips)", clip_job_id, completed, len(clip_windows))

    except Exception as exc:
        transient = isinstance(exc, (ConnectionError, TimeoutError))
        _set_status(clip_job_id, "FAILED", error_message=str(exc)[:2000])
        if transient and self.request.retries < (self.max_retries or 0):
            raise self.retry(exc=exc)
        raise
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def _render_clip_composite(vertical_path: str, audio_path: str, output_path: str, subs_path: str | None) -> str:
    """Composite the 9:16 vertical video with the original audio and optional ASS captions."""
    from services.video import run_ffmpeg, get_duration

    duration = get_duration(audio_path)

    inputs = [
        "-stream_loop", "-1", "-t", f"{duration + 0.1:.3f}", "-i", vertical_path,
        "-i", audio_path,
    ]

    if subs_path:
        sub_escaped = subs_path.replace("\\", "/").replace(":", "\\:")
        filter_str = f"[0:v]scale=1080:1920,setsar=1[bg];[bg]subtitles='{sub_escaped}'[vout]"
    else:
        filter_str = "[0:v]scale=1080:1920,setsar=1[vout]"

    run_ffmpeg([
        *inputs,
        "-filter_complex", filter_str,
        "-map", "[vout]",
        "-map", "1:a",
        "-t", f"{duration + 0.1:.3f}",
        "-c:v", "libx264", "-crf", "18", "-preset", "fast",
        "-c:a", "aac", "-b:a", "192k",
        "-r", "30",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        output_path,
    ])
    return output_path
