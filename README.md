# ReelBot

Turn any content into short-form vertical video (9:16, 1080×1920) ready for YouTube Shorts, TikTok, and Instagram Reels. Two modes: generate reels from text stories end-to-end, or feed it a long-form video and let the AI find, clip, and crop the best moments automatically.

> **Note:** the original spec used the Reddit API. Reddit now gates API access behind an approval process, so ReelBot lets users **paste any post/story text directly** — same pipeline, zero Reddit API keys required.

## Modes

### Reel Studio
Generate short-form videos from scratch — paste a story, pick a voice and background, get a fully-produced reel with synced captions.

| Template | Status | Recipe |
|---|---|---|
| **Story Reel** | ✅ live | Text → voiceover → Whisper-synced captions → gameplay loop → title card |
| **Meme Studio** | ✅ live | Gradient scene + cutout characters + typed captions with real color emojis |

### Clip Engine
Upload a long-form video (podcast, interview, lecture). The AI transcribes it, reads the full transcript, identifies the best Q&A moments and stories, and clips them out as standalone short-form videos.

| Feature | Status |
|---|---|
| AI moment detection (GPT-4o) | ✅ live |
| Word-level Whisper transcription | ✅ live |
| Karaoke captions (word-by-word highlight) | ✅ live |
| Smart crop — face-track speaker to 9:16 | ✅ live |
| Clip preview, download, dismiss | ✅ live |

## Features

**Reel Studio**
- Paste-a-story editor with title, subreddit label, and word count
- 20+ voices — regional accents (US, UK, Irish, Kenyan, Nigerian, South African, Indian Hinglish) plus personality presets (Friendly / Hype / Calm / Serious)
- Voice engine: **Auto** (ElevenLabs → free fallback), **ElevenLabs** premium, or **Local TTS**
- Word-synced subtitles via Whisper (local model, no cloud calls)
- Static captions: type your own text, auto-wrapped and auto-fitted with real color emojis (Twemoji composited PNG overlays)
- Draggable caption placement — free `caption_y`, not just 3 presets
- Layer editor: drag / 8-handle resize / rotation knobs, inline styled text, WYSIWYG full-screen preview
- Character cutouts: upload with in-browser background removal, up to 3 per reel
- Pillow-rendered title cards (dark / light / minimal)
- Gameplay backgrounds auto-loop to voiceover length; auto-transcoded to 1080×1920

**Clip Engine**
- Upload any MP4 — podcast, interview, YouTube download, lecture recording
- GPT-4o reads the full transcript and identifies Q&A exchanges and self-contained stories
- Clips span the full video (spread enforced across thirds of the video)
- Clip durations are natural (40–120s typical) — no hard ceiling, ends when the moment is complete
- **Karaoke captions**: word-by-word highlight with scale pop, no transition flash, auto font-size scaling so long words never overflow the frame
- **Smart crop**: LR-ASD (TalkNet + S3FD) detects the active speaker per-frame and dynamically crops to 9:16 portrait following the speaker's face
- Per-clip engagement score, hook text, and clip type badge
- One-click download; dismiss with 5-second undo

**Platform**
- Job queue (Celery + Redis) with live status tracking
- Quota system: 3/day, 30/month for free users; admins unlimited
- Admin panel: stats, user management, clip uploads, all-jobs view
- S3/MinIO storage with presigned downloads, user-uploaded footage, reel retention, and automatic garbage collection

## Architecture

```mermaid
flowchart LR
    U[User] --> FE[Next.js :3000]
    FE -- "session JWT via /api/proxy/*" --> BE[FastAPI :8000]
    BE -- "enqueue" --> RD[(Redis)]
    RD --> WK[Celery Worker — general]
    RD --> CW[Celery Worker — clips]
    WK --> FF[FFmpeg]
    WK --> WH[Whisper local]
    WK --> TTS[ElevenLabs / edge-tts]
    CW --> WH
    CW --> LLM[GPT-4o]
    CW --> ASD[LR-ASD smart crop]
    BE --- PG[(PostgreSQL)]
    WK --- PG
    CW --- PG
```

Two Celery workers run separately: the general worker handles reel generation and background tasks; the clip worker handles the long-running clip pipeline (transcription → LLM analysis → per-clip smart crop).

## Clip Engine Architecture

```mermaid
flowchart TD
    subgraph Browser
        UP[Upload MP4]
        POLL[Poll /clip-jobs/id every 3s]
        UI[Clip cards UI]
    end

    subgraph FastAPI
        API[POST /clip-jobs]
        DL_API[GET /clips/id/download]
        DB[(PostgreSQL\nClipJob · Clip rows)]
    end

    subgraph Redis
        Q[(clips queue)]
    end

    subgraph Storage
        ST[(MinIO / local\nsource.mp4 · output.mp4)]
    end

    subgraph Clip Worker — Celery
        direction TD

        DOWNLOAD[1 · Download source.mp4]
        AUDIO[2 · FFmpeg\nextract audio.mp3]

        subgraph Whisper
            TRANS[3 · Transcribe\nword-level timestamps]
        end

        subgraph LLM
            ANALYSE[4 · GPT-4o\nread full transcript\nidentify Q&A + stories]
            CW[ClipWindow list\nstart · end · hook · score]
        end

        ANALYSE --> CW

        subgraph Per-clip loop
            TRIM[5 · FFmpeg trim\nraw.mp4]

            subgraph Smart Crop
                S3FD[S3FD face detector\ndetect faces per frame]
                TRACK[Face tracker\nbuild face tracks]
                TALKNET[TalkNet ASD\nscore active speaker]
                CROPMAP[Build crop map\nsmooth window]
                S3FD --> TRACK --> TALKNET --> CROPMAP
            end

            RENDER[6 · FFmpeg\ncrop to 9:16 · 1080×1920]

            subgraph Captions
                direction LR
                KARA[Karaoke ASS\nword highlight]
                STD[Standard ASS\nchunked]
            end

            BURN[7 · FFmpeg\nburn subtitles]
            UPLOAD[8 · Upload output.mp4]
        end

        TRIM --> S3FD
        CROPMAP --> RENDER
        RENDER --> KARA & STD
        KARA & STD --> BURN
        BURN --> UPLOAD
    end

    UP --> API --> DB
    API --> Q
    Q --> DOWNLOAD
    DOWNLOAD --> ST
    ST --> DOWNLOAD
    DOWNLOAD --> AUDIO --> TRANS --> ANALYSE
    CW --> TRIM
    UPLOAD --> ST
    DB --> POLL --> UI
    UI --> DL_API --> ST
```

## Clip Engine Pipeline

```mermaid
flowchart TD
    Q[QUEUED] --> D[DOWNLOADING]
    D --> EA[EXTRACTING_AUDIO]
    EA --> TR[TRANSCRIBING]
    TR --> AN[ANALYSING — GPT-4o]
    AN --> CL[CLIPPING]
    CL --> SC[Smart crop + captions per clip]
    SC --> UP[UPLOADING]
    UP --> DO[DONE]
    AN -.->|parse failure| E[FAILED]
    SC -.-> E
```

## Reel Studio Pipeline

```mermaid
flowchart TD
    Q[QUEUED] --> V[GENERATING_VOICEOVER]
    V --> T[TRANSCRIBING]
    T --> C[RENDERING_TITLE_CARD]
    C --> G[PICKING_GAMEPLAY]
    G --> X[COMPOSITING_VIDEO]
    X --> UP[UPLOADING]
    UP --> D[DONE]
    V -.->|any step fails| E[FAILED]
```

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Python | 3.11+ | `brew install python@3.11` |
| Node.js | LTS | https://nodejs.org |
| FFmpeg | **with libass** | see below |
| Docker | any recent | https://docker.com |

### FFmpeg with libass (required for captions)

**macOS:**
```bash
brew tap homebrew-ffmpeg/ffmpeg
brew install homebrew-ffmpeg/ffmpeg/ffmpeg
```

**Linux (Ubuntu/Debian):**
```bash
apt install ffmpeg   # libass included by default
```

Verify: `ffmpeg -filters | grep subtitles` — if that returns a line, you're good.

## Quick Start

```bash
./run.sh          # starts infra + backend + both workers + frontend
./run.sh status   # what's running
./run.sh logs     # tail all service logs
./run.sh stop     # stop everything
```

`run.sh` boots Postgres/Redis via Docker Compose, creates the Python venv, installs dependencies, runs Alembic migrations, seeds the admin user, then launches FastAPI (:8000), both Celery workers, and Next.js (:3000).

Open **http://localhost:3000** and sign in with the default admin:

```
admin@reelbot.dev / admin1234
```

`must_change_password=true` is set — you'll be redirected to `/change-password` on first sign-in.

## Manual Setup

<details>
<summary>Step by step</summary>

```bash
# 1. Infrastructure
docker compose up -d                      # postgres :5434, redis :6380

# 2. Backend
cd backend
python3.11 -m venv .venv
./.venv/bin/pip install -U pip "setuptools<81" wheel
./.venv/bin/pip install openai-whisper==20240930 --no-build-isolation
./.venv/bin/pip install -r requirements.txt
cp .env.example .env                      # edit if needed
./.venv/bin/python -m alembic upgrade head
./.venv/bin/python seed.py

# 3. Run services (three terminals)
./.venv/bin/python -m uvicorn main:app --port 8000
./.venv/bin/celery -A tasks.render worker -Q celery -B -l info
./.venv/bin/celery -A tasks.render worker -Q clips -n clipworker@%h -l info

# 4. Frontend
cd ../frontend
npm install
cp .env.local.example .env.local
npm run dev                               # http://localhost:3000
```

</details>

## Smart Crop

Smart crop uses [LR-ASD](https://github.com/Junhua-Liao/LR-ASD) (TalkNet + S3FD face detector) vendored at `backend/vendor/lrasd/`. Model weights (~200 MB) are downloaded automatically on first use.

Smart crop processes video at **25 fps** internally (TalkNet's native rate) regardless of source fps — the pipeline subsamples automatically.

Additional requirements (included in `requirements.txt`):
- `opencv-python-headless`
- `scipy`
- `python_speech_features`
- `torchvision`

## ElevenLabs (optional)

Works fully without it — edge-tts is free. For premium voices:

1. elevenlabs.io → Profile → **API Keys** → copy the `sk_…` key (exactly **51 characters**)
2. Add to `backend/.env`: `ELEVENLABS_API_KEY=sk_…`
3. Restart: `./run.sh stop && ./run.sh`

## Gameplay Clips

1. Drop vertical MP4s into `backend/assets/gameplay/`
2. **Admin → Assets → Upload Clip** — auto-transcoded to 1080×1920 and registered
3. Toggle clips on/off; `*.mp4` files are gitignored

Subtitle style playground:
```bash
./play.sh              # size 96, margin 680, speed 1.1
./play.sh 110 600 1.25 # size / margin-from-bottom / speech speed
open /tmp/reelbot/pg.mp4
```

## Environment Variables

### `backend/.env`

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_URL` | `postgresql+asyncpg://reelbot:reelbot@localhost:5434/reelbot` | asyncpg driver |
| `REDIS_URL` | `redis://localhost:6380/0` | broker + result backend |
| `SECRET_KEY` | — | HS256 JWT secret |
| `ELEVENLABS_API_KEY` | *(empty)* | optional, `sk_…` 51 chars |
| `LLM_PROVIDER` | `openai` | `openai` / `anthropic` / `groq` |
| `LLM_MODEL_OPENAI` | `gpt-4o` | model for clip analysis |
| `OPENAI_API_KEY` | — | required when `LLM_PROVIDER=openai` |
| `ANTHROPIC_API_KEY` | — | required when `LLM_PROVIDER=anthropic` |
| `STORAGE_BACKEND` | `local` | `local` or `s3` |
| `LOCAL_STORAGE_PATH` | `./outputs` | local-mode storage |
| `S3_ENDPOINT_URL` | *(empty)* | MinIO for dev; empty = real AWS |
| `S3_BUCKET` | `reelbot-dev` | private bucket |
| `AWS_ACCESS_KEY_ID` | *(empty)* | dev only |
| `AWS_SECRET_ACCESS_KEY` | *(empty)* | dev only |
| `RETENTION_TTL_MINUTES` | `15` | ephemeral reel lifetime |
| `MAX_BACKGROUND_UPLOAD_MB` | `500` | per-file cap for user footage |
| `FREE_DAILY_LIMIT` | `3` | free-tier daily quota |
| `FREE_MONTHLY_LIMIT` | `30` | free-tier monthly quota |

### `frontend/.env.local`

| Variable | Default |
|---|---|
| `NEXTAUTH_URL` | `http://localhost:3000` |
| `AUTH_SECRET` | — |
| `BACKEND_URL` | `http://localhost:8000` |
| `NEXT_PUBLIC_BACKEND_URL` | `http://localhost:8000` |

> **Port note:** Postgres maps to host **5434** and Redis to **6380** to avoid clashing with local services on 5432/6379.

## Project Structure

```
redditify/
├── run.sh                    # one-command launcher
├── play.sh                   # subtitle playground
├── docker-compose.yml        # postgres + redis
├── backend/
│   ├── main.py               # FastAPI app
│   ├── config.py             # pydantic-settings
│   ├── models.py             # SQLAlchemy models
│   ├── alembic/              # migrations
│   ├── routers/              # auth, jobs, clip_jobs, assets, admin
│   ├── services/
│   │   ├── video.py          # FFmpeg helpers, render_clip
│   │   ├── smart_crop.py     # LR-ASD active speaker detection + 9:16 crop
│   │   ├── clip_analyser.py  # LLM transcript analysis, ClipWindow
│   │   ├── whisper_service.py# transcription + karaoke ASS generation
│   │   ├── caption_png.py    # static caption PNG renderer (Twemoji)
│   │   ├── tts.py            # ElevenLabs / edge-tts
│   │   └── storage.py        # local / S3 abstraction
│   ├── tasks/
│   │   ├── render.py         # reel generation pipeline
│   │   └── clip.py           # clip engine pipeline
│   └── vendor/lrasd/         # LR-ASD (MIT, © 2025 Liao Junhua)
└── frontend/
    ├── app/(app)/dashboard/
    │   ├── clips/            # Clip Engine UI
    │   └── jobs/             # Reel Studio UI
    ├── components/clips/     # NewClipJobDialog, clip cards
    └── lib/                  # api.ts, types.ts
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| `whisper` install fails (`No module named 'pkg_resources'`) | `pip install "setuptools<81"` first, then `--no-build-isolation` for whisper |
| Subtitles missing — no error | FFmpeg lacks libass: `ffmpeg -filters \| grep subtitles`; use the homebrew-ffmpeg tap |
| Smart crop fails on first run | weights download on first use (~200 MB); check internet connectivity |
| Smart crop tensor size mismatch | video is subsampled to 25 fps automatically — this is fixed in `smart_crop.py` |
| `np.int` AttributeError in box_utils | fixed in `vendor/lrasd/model/faceDetector/s3fd/box_utils.py` |
| Clip Engine "LLM returned unparseable output" | check `LLM_MODEL_OPENAI` is `gpt-4o` or better; smaller models hallucinate timestamp formats |
| Worker stuck / jobs never start | `./run.sh logs worker`; confirm Redis port matches `REDIS_URL` |
| `edge-tts` fails with 403 | `pip install -U edge-tts` (7.2+) |
| Backend changes don't apply | Celery workers don't hot-reload; restart after editing `backend/` |
| Emojis missing from synced captions | expected — libass has no color-emoji font; static captions do render emojis via Twemoji |
| ElevenLabs 400 "api_key_id_used_as_api_key" | copy the `sk_…` key (51 chars), not the key ID |

## API

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/auth/register` | — | create account |
| POST | `/auth/login` | — | → `{token, user}` |
| POST | `/auth/change-password` | ✓ | |
| GET | `/quota/me` | ✓ | usage vs limits |
| POST | `/jobs` | ✓ | create reel job |
| GET/DELETE | `/jobs/{id}` | ✓ | detail / delete |
| GET | `/jobs/{id}/download` | ✓ | final MP4 |
| POST | `/clip-jobs` | ✓ | create clip job |
| GET | `/clip-jobs/{id}` | ✓ | job + clips |
| GET | `/clip-jobs/{id}/clips/{clipId}/download` | ✓ | clip MP4 |
| DELETE | `/clip-jobs/{id}/clips/{clipId}` | ✓ | dismiss clip |
| GET/POST | `/backgrounds` | ✓ | user footage |
| GET | `/fonts` · `/scenes` | ✓ | editor registries |
| GET/POST/DELETE | `/admin/assets` | admin | gameplay clips |
| GET/PATCH | `/admin/users` | admin | user management |
| GET | `/admin/stats` | admin | dashboard stats |

Interactive docs: **http://localhost:8000/docs**

## License

MIT — see [LICENSE](LICENSE).

Vendored [LR-ASD](https://github.com/Junhua-Liao/LR-ASD) is also MIT (© 2025 Liao Junhua).
