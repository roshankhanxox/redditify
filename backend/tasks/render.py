import logging
import os
import shutil
import sys
import uuid
from datetime import datetime, timedelta, timezone

from celery import Celery

from config import settings

logger = logging.getLogger(__name__)

# Ensure the backend/ directory is importable regardless of how the
# worker process was launched (celery does not always put cwd on sys.path).
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

celery = Celery("reelbot", broker=settings.REDIS_URL, backend=settings.REDIS_URL)

# Beat schedule + worker-side task registration. Tasks live in tasks/maintenance;
# `include` makes the worker import them at startup so beat messages always
# find a registered consumer.
celery.conf.include = ["tasks.maintenance", "tasks.backgrounds", "tasks.clip"]

# Clip jobs are long (Whisper + LLM + N encodes) and would starve reel renders on
# a shared queue. Route them to a dedicated 'clips' queue consumed by its own
# worker (see run.sh); everything else stays on the default queue. (audit A10)
celery.conf.task_routes = {
    "tasks.clip.analyse_and_clip": {"queue": "clips"},
}
celery.conf.task_default_queue = "celery"

celery.conf.beat_schedule = {
    "reap-expired-reels": {"task": "tasks.maintenance.reap_expired_reels", "schedule": 60.0},
    "sweep-stale-uploads": {"task": "tasks.maintenance.sweep_stale_uploads", "schedule": 3600.0},
    "sweep-worker-tmp": {"task": "tasks.maintenance.sweep_worker_tmp", "schedule": 3600.0},
    "sweep-orphan-objects": {"task": "tasks.maintenance.sweep_orphan_objects", "schedule": 7 * 24 * 3600.0},
}

# Intermediates persisted under scratch/{job_id}/ so a transient failure can
# resume without re-burning paid TTS. The bucket lifecycle rule (24 h) is the
# backstop for anything that never reaches a terminal state here.
STAGE_ARTIFACTS = ("voice.mp3", "subs.ass", "title.png")


def _scratch_key(job_id: str, name: str) -> str:
    return f"scratch/{job_id}/{name}"


def _cleanup_scratch(job_id: str):
    try:
        from services import storage

        for name in STAGE_ARTIFACTS:
            storage.delete(_scratch_key(job_id, name))
    except Exception:
        pass


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
            user_id = str(job.user_id)

        subreddit_label = cfg.get("subreddit_label") or "reelbot"
        captions_on = bool(cfg.get("captions_enabled", True))
        title_on = bool(cfg.get("title_enabled", True))
        template = cfg.get("template", "story")

        # Resume fast-path: on a retry, restore whatever artifacts survived in
        # scratch and skip those stages. Anything missing regenerates normally.
        voice_path = os.path.join(tmp, "voice.mp3")
        if storage.download(_scratch_key(job_id, "voice.mp3"), voice_path) is None:
            set_status("GENERATING_VOICEOVER")
            text = preprocess_text(
                raw_story,
                context_label=subreddit_label if template == "story" else "",
                title=title if template == "story" else "",
                max_words=cfg.get("max_words", 1200),
            )
            audio_path = tts.generate_voiceover(
                text,
                cfg.get("voice", "male"),
                voice_path,
                provider=cfg.get("tts_provider", "auto"),
                speed=cfg.get("speed", 1.1),
                expressiveness=cfg.get("expressiveness", "expressive"),
                personality=cfg.get("voice_personality", "none"),
            )
            storage.upload(audio_path, _scratch_key(job_id, "voice.mp3"), keep_local=True)

        srt_path = os.path.join(tmp, "subs.ass")
        caption_pngs: list[dict] | None = None
        if captions_on and storage.download(_scratch_key(job_id, "subs.ass"), srt_path) is None:
            style = whisper_service.caption_style_from_settings(cfg)
            chunk_size = max(1, min(3, int(cfg.get("caption_words", 2))))

            static_text = str(cfg.get("caption_text") or "").strip()
            if cfg.get("caption_mode") == "static" and static_text:
                # Static mode: user-authored text rendered as transparent PNGs
                # (Pillow + Twemoji) — real color emojis, no libass — and the
                # Whisper stage is skipped entirely.
                from services import caption_png

                duration = video.get_duration(voice_path)
                cap_y = float(cfg.get("caption_y", 0.65))
                spec = {
                    "fontsize": round(
                        int(cfg.get("caption_font_size", 96))
                        * int(cfg.get("caption_scale", 100)) / 100
                    ),
                    "color": str(cfg.get("caption_color", "white")),
                    "outline": int(cfg.get("caption_outline", 6)),
                }
                if cfg.get("caption_layout") == "block":
                    spans = [{"text": static_text, "start": 0.0, "end": duration}]
                else:
                    MAX_CAPTION_PNGS = 30
                    spans = whisper_service.even_chunks(static_text, duration, chunk_size)
                    if len(spans) > MAX_CAPTION_PNGS:
                        logger.warning(
                            "static captions: %d chunks exceed cap, truncating",
                            len(spans),
                        )
                        spans = spans[:MAX_CAPTION_PNGS]
                caption_pngs = []
                for i, sp in enumerate(spans):
                    info = caption_png.render_caption_png(
                        sp["text"], os.path.join(tmp, f"cap-{i}.png"), **spec,
                    )
                    storage.upload(
                        info["path"], _scratch_key(job_id, f"cap-{i}.png"), keep_local=True,
                    )
                    caption_pngs.append({
                        **info, "y": cap_y, "start": sp["start"], "end": sp["end"],
                    })
            else:
                set_status("TRANSCRIBING")
                words = whisper_service.transcribe(voice_path)
                chunks = whisper_service.words_to_chunks(words, chunk_size=chunk_size)

                if chunks:
                    whisper_service.chunks_to_ass(chunks, srt_path, style=style)
                    storage.upload(srt_path, _scratch_key(job_id, "subs.ass"), keep_local=True)

        card_path = os.path.join(tmp, "title.png")
        if title_on and storage.download(_scratch_key(job_id, "title.png"), card_path) is None:
            set_status("RENDERING_TITLE_CARD")
            title_card.render(
                title, subreddit_label,
                cfg.get("title_style", "dark"),
                card_path,
                scale_pct=cfg.get("title_scale", 100),
                show_badge=bool(cfg.get("title_badge", True)),
            )
            storage.upload(card_path, _scratch_key(job_id, "title.png"), keep_local=True)

        if template in ("meme", "image"):
            # Meme composite: procedural/animated scene background instead of
            # gameplay. Pitch is applied AFTER transcription so the word-synced
            # subtitles above still match the unshifted audio timeline.
            from services import scenes as scenes_service
            from services.text_overlay import render_text_overlay

            scene = (
                scenes_service.get_scene(cfg.get("scene_id")) or scenes_service.SCENES[0]
                if template == "meme"
                else None
            )
            if scene is None:
                # Image reel: the user's uploaded photo is the background.
                from models import UserBackground

                bg_id = str(cfg.get("background_id") or "")
                if not bg_id:
                    raise RuntimeError("image template requires background_id")
                with SyncSessionLocal() as db:
                    row = db.get(UserBackground, uuid.UUID(bg_id))
                    if row is None or str(row.user_id) != user_id or row.status != "ready":
                        raise RuntimeError(f"uploaded photo not ready: {bg_id}")
                    clip_key = row.clip_key
                if not clip_key:
                    raise RuntimeError(f"uploaded photo has no processed file: {bg_id}")
                scene = {
                    "id": f"user-{bg_id[:8]}",
                    "kind": "user_image",
                    "params": {"key": clip_key},
                }

            pitch = float(cfg.get("tts_pitch") or 0)
            voice_for_render = voice_path
            if abs(pitch) >= 0.01:
                set_status("PICKING_GAMEPLAY")  # closest existing stage label
                voice_for_render = tts.apply_pitch(
                    voice_path, os.path.join(tmp, "voice-pitched.mp3"), pitch
                )

            set_status("COMPOSITING_VIDEO")

            # Character assets: ownership was validated at job creation; here we
            # only resolve storage paths (resolve() cache-downloads on S3).
            from models import UserBackground

            characters = []
            char_specs = cfg.get("characters", [])
            if char_specs:
                with SyncSessionLocal() as db:
                    rows = {
                        str(r.id): r.clip_key
                        for r in db.query(UserBackground)
                        .filter(
                            UserBackground.id.in_([uuid.UUID(c["asset_id"]) for c in char_specs]),
                            UserBackground.user_id == job.user_id,
                            UserBackground.kind == "character",
                            UserBackground.status == "ready",
                        )
                        .all()
                    }
                for c in char_specs:
                    key = rows.get(c["asset_id"])
                    if not key:
                        continue
                    path = storage.resolve(key)
                    if path:
                        characters.append({**c, "path": path})

            text_pngs = [
                {**t, "path": render_text_overlay(t, os.path.join(tmp, f"text-{i}.png"))}
                for i, t in enumerate(cfg.get("text_overlays", []))
            ]

            output_path = video.render_meme_video(
                scene,
                voice_for_render,
                os.path.join(tmp, "output.mp4"),
                subs=srt_path if (captions_on and caption_pngs is None) else None,
                tmp_dir=tmp,
                characters=characters,
                text_pngs=text_pngs,
                scene_animated=bool(cfg.get("scene_animated", True)),
                caption_pngs=caption_pngs,
            )
        else:
            set_status("PICKING_GAMEPLAY")
            clip_path = assets.pick_clip_for_job_sync(user_id, cfg)

            set_status("COMPOSITING_VIDEO")
            output_path = video.render_video(
                clip_path,
                voice_path,
                os.path.join(tmp, "output.mp4"),
                card=card_path if title_on else None,
                subs=srt_path if captions_on else None,
                card_pos=cfg.get("title_position", "top"),
            )
        duration = video.get_duration(output_path)

        set_status("UPLOADING")
        result_key = storage.upload(output_path, f"users/{user_id}/reels/{job_id}.mp4")

        # Poster frame + low-res hover-preview rendition. Best-effort by
        # design: neither may fail an otherwise finished reel.
        try:
            thumb_local = os.path.join(tmp, "thumb.jpg")
            video.extract_thumbnail(
                output_path, thumb_local, at_seconds=min(1.0, duration * 0.25)
            )
            storage.upload(thumb_local, f"users/{user_id}/thumbs/{job_id}.jpg")
        except Exception as exc:
            print(f"[render] thumbnail extraction failed for {job_id}: {exc}")
        try:
            preview_local = os.path.join(tmp, "preview.mp4")
            video.render_preview(output_path, preview_local)
            storage.upload(preview_local, f"users/{user_id}/previews/{job_id}.mp4")
        except Exception as exc:
            print(f"[render] preview rendition failed for {job_id}: {exc}")

        # Retention clock starts when the file is durably stored. The server
        # owns the clock; clients only ever receive the timestamp.
        expires_at = None
        if (cfg.get("retention") or "ephemeral") == "ephemeral":
            expires_at = datetime.now(timezone.utc) + timedelta(minutes=settings.RETENTION_TTL_MINUTES)

        set_status("DONE", result_url=result_key, duration_seconds=duration, result_expires_at=expires_at)

        # Terminal success: intermediates served their purpose.
        _cleanup_scratch(job_id)

    except Exception as exc:
        # Auto-retry (max_retries=2, 30s delay) only fires for transient network
        # errors — re-running the whole pipeline after a permanent failure would
        # burn TTS quota for nothing. Scratch artifacts are intentionally kept
        # on the retry path; they are only cleared on terminal success/failure.
        transient = isinstance(exc, (ConnectionError, TimeoutError))
        set_status("FAILED", error_message=str(exc)[:2000])
        if transient and self.request.retries < (self.max_retries or 0):
            raise self.retry(exc=exc)
        _cleanup_scratch(job_id)
        raise
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
