# ReelBot

Turn any story into a short-form vertical video (9:16, 1080×1920) ready for YouTube Shorts and Instagram Reels — AI voiceover, word-synced subtitles burned into the frame, and a looping gameplay background, generated end-to-end by a Celery + FFmpeg pipeline.

> **Design note:** the original spec used the Reddit API to fetch posts. Reddit now gates API access behind an application/approval process, so ReelBot instead lets users **paste any post/story text directly** — same pipeline, zero API keys required.

## Features

- Paste-a-story editor with title, subreddit label, and word count
- 10 voices across both engines, speech-speed control (0.8×–1.5×)
- Voice engine picker: **Auto** (ElevenLabs → free fallback), **ElevenLabs** premium, or **Local TTS** (free)
- Word-synced subtitles (Whisper, local model — no cloud calls) rendered as big, shorts-style captions
- Pillow-rendered title cards (dark / light / minimal) with subreddit label
- Gameplay background auto-loops to voiceover length; auto-transcoded to 1080×1920
- Job queue (Celery + Redis) with live status tracking and exponential-backoff polling
- Quota system: 3/day, 30/month for free users; admins unlimited
- Admin panel: stats, user management, clip uploads, all-jobs view

## Architecture

```mermaid
flowchart LR
    U[User] --> FE[Next.js :3000]
    FE -- "session JWT via /api/proxy/*" --> BE[FastAPI :8000]
    BE -- "enqueue" --> RD[(Redis)]
    RD --> WK[Celery Worker]
    WK --> FF[FFmpeg]
    WK --> WH[Whisper local]
    WK --> TTS[TTS: ElevenLabs / edge-tts]
    BE --- PG[(PostgreSQL)]
    WK --- PG
    WK --- RD
    FF --> OUT[backend/outputs/reels/*.mp4]
```

## Pipeline

Job status lives in PostgreSQL (source of truth). The dashboard polls `/jobs/{id}` with exponential backoff (1.5s → 12s) and stops on terminal states:

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
    T -.-> E
    C -.-> E
    G -.-> E
    X -.-> E
    UP -.-> E
```

## Database

```mermaid
erDiagram
    USERS ||--o{ JOBS : creates
    USERS ||--o{ QUOTA_USAGE : accumulates
    USERS {
        uuid id PK
        text email UK
        text password_hash
        text role
        boolean must_change_password
        timestamptz created_at
    }
    JOBS {
        uuid id PK
        uuid user_id FK
        text post_title
        text post_body
        text status
        jsonb settings
        text result_url
        text error_message
        float duration_seconds
    }
    ASSETS {
        uuid id PK
        text filename
        text category
        float duration_seconds
        bigint file_size_bytes
        text resolution
        boolean enabled
    }
    QUOTA_USAGE {
        uuid user_id FK
        text period
        int count
    }
```

---

## Prerequisites

| Tool | Version | Install |
|---|---|---|
| Python | 3.11+ | `brew install python@3.11` / `apt install python3.11` |
| Node.js | LTS | `brew install node` / https://nodejs.org |
| FFmpeg | **with libass** (see troubleshooting) | see below |
| Docker | any recent | https://docker.com |

### FFmpeg with libass (required for subtitles)

**macOS:**
```bash
brew tap homebrew-ffmpeg/ffmpeg
brew install homebrew-ffmpeg/ffmpeg/ffmpeg
```

**Linux (Ubuntu/Debian):**
```bash
apt install ffmpeg   # libass included by default
```

Verify: `ffmpeg -filters | grep subtitles` — if that returns a line, you're good. If empty, your build lacks libass and subtitle burning will fail.

## Quick Start (one command)

```bash
./run.sh          # starts infra + backend + worker + frontend
./run.sh status   # what's running
./run.sh logs     # tail all service logs
./run.sh stop     # stop everything
```

`run.sh` will: boot Postgres/Redis via docker compose, create the Python venv and install dependencies, run Alembic migrations, seed the admin user, then launch FastAPI (:8000), the Celery worker, and Next.js (:3000).

Then open **http://localhost:3000**, sign up (or use admin below), go to **Dashboard**, paste a title + story, hit **Generate Reel**.

### Default admin

```
admin@reelbot.dev / admin1234
```

Seeded with `must_change_password=true` — you'll be redirected to `/change-password` on first sign-in and must set a new password before anything else.

## Manual Setup

<details>
<summary>Step by step (what run.sh automates)</summary>

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

# 3. Run backend + worker (two terminals)
./.venv/bin/python -m uvicorn main:app --port 8000
./.venv/bin/celery -A tasks.render worker -l info --pool=solo

# 4. Frontend
cd ../frontend
npm install
cp .env.local.example .env.local
npm run dev                               # http://localhost:3000
```

</details>

## ElevenLabs (optional)

ReelBot works fully without it (edge-tts is free, no key). For premium voices:

1. Create an account at https://elevenlabs.io → Profile → **API Keys**
2. Copy the key — it starts with `sk_` and is exactly **51 characters** (key *IDs* won't work)
3. Put it in `backend/.env`:
   ```
   ELEVENLABS_API_KEY=sk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ```
4. Restart the worker (`./run.sh stop && ./run.sh`)

Engine behavior per job (set in Dashboard → Voice Engine):
- **Auto** — tries ElevenLabs, silently falls back to local TTS (logged, never surfaced as an error)
- **ElevenLabs** — premium only; failures surface so you know your quota ran out
- **Local TTS** — never touches your quota

## Gameplay Clips

1. Drop vertical MP4s (≥30s recommended) into `backend/assets/gameplay/`
2. Open **Admin → Assets → Upload Clip** — files are probed (duration ≥ 30s enforced), auto-transcoded to 1080×1920 if needed, and registered in the DB
3. Toggle clips on/off with the switch; deletion is blocked while a category's last enabled clip would be removed
4. Clips are gitignored (`*.mp4`) — metadata only lives in the DB

There's also a subtitle playground for styling tweaks without spending TTS credits:

```bash
./play.sh              # defaults: size 96, margin 680, speed 1.1
./play.sh 110 600 1.25 # size / margin-from-bottom / speech speed
open /tmp/reelbot/pg.mp4
```

## Environment Variables

### `backend/.env`

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_URL` | `postgresql+asyncpg://reelbot:reelbot@localhost:5434/reelbot` | asyncpg driver |
| `REDIS_URL` | `redis://localhost:6380/0` | broker + result backend |
| `SECRET_KEY` | — | HS256 JWT secret; set a real random string in production |
| `ELEVENLABS_API_KEY` | *(empty)* | optional, `sk_…`, 51 chars |
| `STORAGE_BACKEND` | `local` | |
| `LOCAL_STORAGE_PATH` | `./outputs` | finished reels land in `outputs/reels/` |
| `ASSETS_DIR` | `./assets/gameplay` | gameplay clips |
| `FREE_DAILY_LIMIT` | `3` | free-tier daily quota |
| `FREE_MONTHLY_LIMIT` | `30` | free-tier monthly quota |

### `frontend/.env.local`

| Variable | Default | Notes |
|---|---|---|
| `NEXTAUTH_URL` | `http://localhost:3000` | |
| `AUTH_SECRET` | — | Auth.js session encryption |
| `BACKEND_URL` | `http://localhost:8000` | server-side proxy target |
| `NEXT_PUBLIC_BACKEND_URL` | `http://localhost:8000` | used by /sign-up (register happens pre-auth) |

> **Port note:** compose maps Postgres to host **5434** and Redis to **6380** to avoid clashing with locally-installed services on 5432/6379. If those are free on your machine, feel free to change the mappings back — just keep `.env` in sync.

## Project Structure

```
redditify/
├── run.sh                  # one-command launcher
├── play.sh                 # subtitle style playground (local TTS)
├── docker-compose.yml      # postgres + redis
├── PROGRESS.md             # build checklist
├── backend/
│   ├── main.py             # FastAPI app (lifespan, CORS, routers)
│   ├── config.py           # pydantic-settings
│   ├── db.py               # async engine/session
│   ├── sync_db.py          # sync engine (Celery workers)
│   ├── models.py           # SQLAlchemy models
│   ├── security.py         # bcrypt, JWT issue/verify, dependencies
│   ├── seed.py             # admin bootstrap
│   ├── alembic/            # migrations
│   ├── routers/            # auth, jobs, assets, quota, admin
│   ├── services/           # tts, whisper_service, video, title_card,
│   │                       # assets, storage, jobs, text
│   ├── tasks/render.py     # Celery pipeline task
│   ├── assets/gameplay/    # gameplay clips (*.mp4, gitignored)
│   └── outputs/reels/      # finished videos (gitignored)
└── frontend/
    ├── proxy.ts            # route protection (Next.js middleware)
    ├── auth.ts             # Auth.js v5 credentials provider
    ├── app/                # landing, sign-in/up, change-password,
    │                       # dashboard, jobs, admin
    ├── components/ui/      # shadcn/ui components
    └── lib/                # api.ts (axios), types.ts, voices.ts
```

## How auth flows

```mermaid
sequenceDiagram
    participant B as Browser
    participant N as Next.js :3000
    participant F as FastAPI :8000

    B->>N: POST /api/auth/callback/credentials (email, password)
    N->>F: POST /auth/login
    F-->>N: {token (HS256 JWT), user}
    N-->>B: session cookie (JWT contains backendToken)
    B->>N: GET /api/proxy/jobs/123
    N->>F: GET /jobs/123 + Authorization: Bearer <backendToken>
    F-->>N: job JSON
    N-->>B: JSON
```

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `whisper` install fails with `No module named 'pkg_resources'` | setuptools ≥ 81 removed pkg_resources; whisper's setup.py needs it | install `"setuptools<81"` first, use `--no-build-isolation` for whisper |
| Subtitles missing from output, no error | two known causes: (a) FFmpeg build lacks libass — check `ffmpeg -filters \| grep subtitles`; (b) SRT + large MarginV renders off-canvas because libass puts plain SRT on a 384×288 virtual canvas | use a libass-enabled FFmpeg; ReelBot generates ASS subtitles with explicit `PlayRes: 1080×1920` for this reason |
| Subtitles tiny despite correct ASS | a leftover `force_style=Fontsize=20` in the render filter overrides ASS styles | fixed in current code — keep `render_video()` free of `force_style` |
| `edge-tts` fails with 403 handshake | Microsoft rotates tokens; old library versions break | `pip install -U edge-tts` (7.2+) |
| Worker picks up nothing / jobs stuck QUEUED | broker URL mismatch or worker crashed on startup | `./run.sh logs worker`; confirm Redis port matches `REDIS_URL` |
| `role "reelbot" does not exist` when running migrations | connecting to a local Postgres instead of the container (port 5432 clash) | compose maps to **5434** — make sure `DATABASE_URL` points there |
| Login rejects `admin@reelbot.local` | pydantic `EmailStr` refuses reserved `.local` TLD | seeded admin is `admin@reelbot.dev` |
| Celery task errors `got Future attached to a different loop` | async SQLAlchemy pool reused across `asyncio.run()` loops in worker | worker code uses the sync session (`sync_db.py`) — don't call async services from tasks directly |
| ElevenLabs 400 "api_key_id_used_as_api_key" / "exactly 51 characters" | wrong credential copied | copy the actual key (`sk_…`, 51 chars) from elevenlabs.io profile |
| FFmpeg installed but `subtitles` filter missing | Homebrew's default FFmpeg formula dropped libass | use the homebrew-ffmpeg tap: `brew tap homebrew-ffmpeg/ffmpeg && brew install homebrew-ffmpeg/ffmpeg/ffmpeg` |

## API Summary

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/auth/register` | — | `{email, password}` → create account |
| POST | `/auth/login` | — | → `{token, user{id, email, role, must_change_password}}` |
| POST | `/auth/change-password` | ✓ | `{current_password, new_password}` |
| GET | `/quota/me` | ✓ | usage vs limits |
| POST | `/jobs` | ✓ + quota | `{title, story, subreddit?, settings}` → `{job_id}` |
| GET | `/jobs` · `/jobs/{id}` · DELETE `/jobs/{id}` | ✓ | history / detail / delete |
| GET | `/jobs/{id}/download` | ✓ | final MP4 |
| GET | `/assets` | ✓ | categories + clips for UI |
| POST/PATCH/DELETE | `/admin/assets[/{id}]` | admin | upload / toggle / delete clips |
| GET/PATCH | `/admin/users[/{id}]` | admin | list / change role, reset quota |
| GET | `/admin/jobs` · `/admin/stats` | admin | all jobs / dashboard stats |

Interactive docs at http://localhost:8000/docs.
