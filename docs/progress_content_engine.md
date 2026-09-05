# Content Engine — Progress Log

## Branch: `feature/content-engine`

---

## Checklist

### Backend
- [x] Config: LLM provider keys + model names
- [x] Models: ClipJob + Clip ORM
- [x] Alembic migration: clip_jobs + clips tables
- [x] services/llm.py: Anthropic / OpenAI / Groq provider interface
- [x] services/clip_analyser.py: engagement system prompt + LLM call + validation
- [x] services/video.py: extract_clip() function
- [x] tasks/clip.py: analyse_and_clip Celery task
- [x] routers/clip_jobs.py: REST API (incl. per-clip DELETE)
- [x] main.py: register router

### Frontend
- [x] /dashboard/clips: clip jobs list page (production-grade UI)
- [x] /dashboard/clips/[jobId]: clip gallery + status poller + timed dismiss
- [x] Nav: Clip Engine link added to app shell
- [x] types.ts: ClipJob + Clip types
- [x] api.ts: downloadClip helper
- [x] NewClipJobDialog: pick from library or upload new video

---

## Commits

| Commit | Description |
|--------|-------------|
| ef84879 | feat(content-engine): backend pipeline — LLM analyser, clip task, API routes, DB models |
| e2ba5cb | feat(content-engine): frontend — clip engine pages, clip gallery, timed dismiss, nav |

---

## Session Notes

- Source video upload reuses existing `user_backgrounds` multipart flow — no new upload infra needed
- No TTS anywhere in this pipeline — clips use original video audio
- ElevenLabs budget untouched
- Groq added as third LLM provider (OpenAI-compatible SDK, different base_url)
- Transcript chunking: full transcript for ≤1hr videos; overlapping 8min windows for longer
- FFmpeg clip extraction uses re-encode (not stream copy) for clean keyframes at cut points
