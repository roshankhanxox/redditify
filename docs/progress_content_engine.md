# Content Engine — Progress Log

## Branch: `feature/content-engine`

---

## Checklist

### Backend
- [ ] Config: LLM provider keys + model names
- [ ] Models: ClipJob + Clip ORM
- [ ] Alembic migration: clip_jobs + clips tables
- [ ] services/llm.py: Anthropic / OpenAI / Groq provider interface
- [ ] services/clip_analyser.py: engagement system prompt + LLM call + validation
- [ ] services/video.py: extract_clip() function
- [ ] tasks/clip.py: analyse_and_clip Celery task
- [ ] routers/clip_jobs.py: REST API
- [ ] main.py: register router

### Frontend
- [ ] /dashboard/clips: clip jobs list page (production-grade UI)
- [ ] /dashboard/clips/[jobId]: clip gallery + status poller
- [ ] Nav: add Clips link to app shell
- [ ] types.ts: ClipJob + Clip types

---

## Commits

| Commit | Description |
|--------|-------------|
| — | — |

---

## Session Notes

- Source video upload reuses existing `user_backgrounds` multipart flow — no new upload infra needed
- No TTS anywhere in this pipeline — clips use original video audio
- ElevenLabs budget untouched
- Groq added as third LLM provider (OpenAI-compatible SDK, different base_url)
- Transcript chunking: full transcript for ≤1hr videos; overlapping 8min windows for longer
- FFmpeg clip extraction uses re-encode (not stream copy) for clean keyframes at cut points
