"""Re-render a failed clip job from the CLIPPING step.

Skips DOWNLOADING (re-downloads), TRANSCRIBING, and ANALYSING — uses the
existing Clip rows already in the DB (from a previous run where the LLM
succeeded but rendering crashed).

Usage:
    cd backend
    python scripts/rerender_clip_job.py <clip_job_id>
"""

import logging
import os
import shutil
import sys
import uuid

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
logger = logging.getLogger(__name__)


def main(clip_job_id: str):
    from models import Clip, ClipJob
    from services import storage, video, whisper_service
    from sync_db import SyncSessionLocal

    tmp = os.path.join("/tmp/reelbot-clips-rerender", clip_job_id)
    os.makedirs(tmp, exist_ok=True)

    try:
        with SyncSessionLocal() as db:
            job = db.get(ClipJob, uuid.UUID(clip_job_id))
            if job is None:
                logger.error("ClipJob %s not found", clip_job_id)
                return
            source_key = job.source_key
            user_id = str(job.user_id)
            cfg = job.settings or {}

            clips = (
                db.query(Clip)
                .filter(Clip.job_id == uuid.UUID(clip_job_id))
                .order_by(Clip.index)
                .all()
            )
            if not clips:
                logger.error("No Clip rows found for job %s — was the LLM step skipped?", clip_job_id)
                return

            clip_data = [
                {
                    "id": str(c.id),
                    "index": c.index,
                    "start": c.start_seconds,
                    "end": c.end_seconds,
                }
                for c in clips
            ]

        logger.info("Found %d clip rows. Re-downloading source video...", len(clip_data))

        video_path = os.path.join(tmp, "source.mp4")
        if storage.download(source_key, video_path) is None:
            logger.error("Source video not found in storage: %s", source_key)
            return

        logger.info("Re-transcribing for captions (Whisper, local — no cost)...")
        audio_path = os.path.join(tmp, "audio.mp3")
        video.run_ffmpeg(["-i", video_path, "-vn", "-acodec", "libmp3lame", "-q:a", "2", audio_path])

        captions_on = bool(cfg.get("captions_enabled", True))
        words = whisper_service.transcribe(audio_path) if captions_on else []

        caption_style_cfg = {
            "caption_font_size": cfg.get("caption_font_size", 96),
            "caption_outline": cfg.get("caption_outline", 6),
            "caption_color": cfg.get("caption_color", "white"),
            "caption_position": cfg.get("caption_position", "lower"),
        }
        caption_animation = cfg.get("caption_animation", "none")
        caption_highlight = cfg.get("caption_highlight_color", "yellow")
        smart_crop_on = bool(cfg.get("smart_crop_enabled", False))
        smart_crop_mode = cfg.get("smart_crop_mode", "crop")

        completed = 0
        for c in clip_data:
            clip_tmp = os.path.join(tmp, f"clip_{c['index']}")
            os.makedirs(clip_tmp, exist_ok=True)
            start, end, clip_id = c["start"], c["end"], c["id"]
            duration = end - start

            try:
                subs_path = None
                if captions_on and words:
                    clip_words = [
                        {**w, "start": max(0.0, w["start"] - start), "end": min(duration, w["end"] - start)}
                        for w in words
                        if not (w.get("end", 0) <= start or w.get("start", 0) >= end)
                    ]
                    if clip_words:
                        style = whisper_service.caption_style_from_settings(caption_style_cfg)
                        subs_path = os.path.join(clip_tmp, "subs.ass")
                        if caption_animation == "karaoke":
                            result = whisper_service.words_to_karaoke_ass(
                                clip_words, subs_path, style=style, chunk_size=3,
                                highlight=caption_highlight,
                            )
                            if not result:
                                subs_path = None
                        else:
                            chunks = whisper_service.words_to_chunks(clip_words, chunk_size=2)
                            if chunks:
                                whisper_service.chunks_to_ass(chunks, subs_path, style=style)
                            else:
                                subs_path = None

                output_path = os.path.join(clip_tmp, "output.mp4")
                if smart_crop_on:
                    from services import smart_crop
                    raw_path = os.path.join(clip_tmp, "raw.mp4")
                    video.trim_clip(video_path, raw_path, start, duration)
                    smart_crop.smart_crop_clip(raw_path, output_path, mode=smart_crop_mode, tmp_dir=clip_tmp)
                    if subs_path:
                        video.burn_subs(output_path, subs_path)
                else:
                    video.render_clip(video_path, output_path, start, duration, subs=subs_path)

                result_key = f"users/{user_id}/clips/{clip_job_id}/{c['index']}.mp4"
                storage.upload(output_path, result_key, keep_local=True)
                clip_duration = video.get_duration(output_path)

                try:
                    thumb_path = os.path.join(clip_tmp, "thumb.jpg")
                    video.extract_thumbnail(video_path, thumb_path, at_seconds=start + min(1.0, duration * 0.1))
                    storage.upload(thumb_path, f"users/{user_id}/clips/{clip_job_id}/{c['index']}_thumb.jpg")
                except Exception as exc:
                    logger.warning("Clip %d thumbnail failed: %s", c["index"], exc)

                with SyncSessionLocal() as db:
                    cr = db.get(Clip, uuid.UUID(clip_id))
                    if cr:
                        cr.status = "done"
                        cr.result_key = result_key
                        cr.duration_seconds = clip_duration
                        db.commit()

                completed += 1
                logger.info("Clip %d/%d done", c["index"] + 1, len(clip_data))

            except Exception as exc:
                logger.error("Clip %d failed: %s", c["index"], exc)
                with SyncSessionLocal() as db:
                    cr = db.get(Clip, uuid.UUID(clip_id))
                    if cr:
                        cr.status = "failed"
                        db.commit()
            finally:
                shutil.rmtree(clip_tmp, ignore_errors=True)

        with SyncSessionLocal() as db:
            job = db.get(ClipJob, uuid.UUID(clip_job_id))
            if job:
                job.status = "DONE" if completed > 0 else "FAILED"
                job.clip_count = completed
                db.commit()

        logger.info("Done: %d/%d clips rendered", completed, len(clip_data))

    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python scripts/rerender_clip_job.py <clip_job_id>")
        sys.exit(1)
    main(sys.argv[1])
