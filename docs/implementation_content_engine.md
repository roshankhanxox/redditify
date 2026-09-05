# Content Engine — Implementation Reference

## What We're Building

A full video clipping pipeline on top of the existing ReelBot infrastructure.
Users upload a long-form video → it gets transcribed → an LLM analyses the transcript
and picks the 10 most engaging moments → each moment is clipped, cropped to 9:16,
captioned with Whisper timestamps, and stored in MinIO. No TTS involved — clips use
the original video's audio.

## Architecture

```
User uploads video (existing MinIO multipart flow via user_backgrounds)
         ↓
POST /clip-jobs  →  Celery: analyse_and_clip(clip_job_id)
         ↓
[DOWNLOADING]   Download source video from MinIO to /tmp/reelbot-clips/{id}/
[EXTRACTING_AUDIO] FFmpeg -vn -acodec mp3
[TRANSCRIBING]  Whisper → full word-level timestamps (same service as reel pipeline)
[ANALYSING]     Format transcript → LLM call → parse 10 clip windows
[CLIPPING]      For each of 10 clips (sequential):
                  - FFmpeg extract segment (-ss start -t duration)
                  - transcode_vertical() → 9:16 auto-crop
                  - sub-window Whisper timestamps → ASS captions → burn in
                  - Upload → users/{user_id}/clips/{clip_job_id}/{index}.mp4
                  - Update Clip row status=done
[DONE]
```

## LLM Provider

Configurable via `LLM_PROVIDER` env var. Three backends, same interface:
- `anthropic` — claude-sonnet-4-6 (default)
- `openai` — gpt-4o
- `groq` — llama-3.3-70b-versatile (OpenAI-compatible, just different base_url + key)

Groq uses the `openai` SDK with `base_url=https://api.groq.com/openai/v1` and `GROQ_API_KEY`.

## Transcript Chunking Strategy

For videos up to ~1 hour: send full transcript in one LLM call (~15K tokens max, well
within 200K context). For longer videos: overlapping 8-minute windows with 2-minute
overlap to prevent clips from being cut at chunk boundaries. Final results deduplicated
and ranked by engagement_score.

## Key Files

| File | Purpose |
|------|---------|
| `backend/models.py` | ClipJob + Clip ORM models |
| `backend/config.py` | LLM provider config |
| `backend/services/llm.py` | Provider interface + 3 backends |
| `backend/services/clip_analyser.py` | System prompt + LLM call + timestamp validation |
| `backend/services/video.py` | extract_clip() addition |
| `backend/tasks/clip.py` | Celery task: analyse_and_clip |
| `backend/routers/clip_jobs.py` | REST API for clip jobs |
| `backend/alembic/versions/` | Migration for clip_jobs + clips tables |
| `frontend/app/(app)/dashboard/clips/` | Clips list page |
| `frontend/app/(app)/dashboard/clips/[jobId]/` | Clip job detail + gallery |

## DB Schema

```sql
TABLE clip_jobs {
  id: uuid PK
  user_id: uuid FK → users.id CASCADE
  source_key: text          -- MinIO key of original uploaded video
  source_label: text        -- user-friendly name
  status: text              -- QUEUED|DOWNLOADING|TRANSCRIBING|ANALYSING|CLIPPING|DONE|FAILED
  settings: jsonb           -- captions_enabled, caption_color, caption_outline, etc.
  error_message: text
  clip_count: int default 0 -- how many clips completed so far
  created_at: timestamptz
  updated_at: timestamptz
}

TABLE clips {
  id: uuid PK
  job_id: uuid FK → clip_jobs.id CASCADE
  index: int                -- 0-based position in ranked list
  start_seconds: float
  end_seconds: float
  hook: text                -- punchy one-liner (the clip's scroll-stopper)
  reason: text              -- 2-sentence LLM rationale
  engagement_score: int     -- 1-10
  clip_type: text           -- opinion_bomb|story_peak|value_drop|pattern_interrupt|quotable_moment|emotional_peak
  result_key: text          -- MinIO key of final .mp4
  status: text              -- pending|done|failed
  duration_seconds: float
  created_at: timestamptz
}
```

## API Endpoints

```
POST   /clip-jobs                              Start analysis job
GET    /clip-jobs                              List (paginated)
GET    /clip-jobs/{id}                         Status + clips array
DELETE /clip-jobs/{id}                         Cancel/delete
GET    /clip-jobs/{id}/clips/{clip_id}/download  Presigned URL or FileResponse
```

## Engagement Analyser Prompt Design

The LLM is instructed to think like a top short-form creator, not a summarizer.
It scans for 6 clip types and understands what kills performance.
Returns strictly validated JSON — timestamps are cross-checked against actual Whisper
word boundaries before any FFmpeg call.

## UI Design Direction

Production-grade, not bootstrapped. Dark theme consistent with existing shell.
Clips grid: card per clip with engagement score badge, clip type chip, hook text,
waveform-style duration indicator, inline play, download. Status transitions animated.
Upload flow reuses the existing multipart background uploader.
