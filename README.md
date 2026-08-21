# ReelBot

Turn any Reddit post into a short-form vertical video (9:16, 1080×1920) ready for YouTube Shorts and Instagram Reels — AI voiceover, word-synced subtitles, and a looping gameplay background, generated end-to-end by a Celery + FFmpeg pipeline.

## Status

Work in progress. See [PROGRESS.md](./PROGRESS.md) for the live build checklist.

## Architecture

```mermaid
flowchart LR
    U[User] --> FE[Next.js Frontend :3000]
    FE -- "JWT-proxied HTTP" --> BE[FastAPI Backend :8000]
    BE -- "enqueue job" --> RD[(Redis)]
    RD --> WK[Celery Worker]
    WK -- status updates --> PG[(PostgreSQL)]
    BE --- PG
    WK --- PG
    WK --> FF[FFmpeg + Whisper]
    WK --> TTS[TTS: ElevenLabs / edge-tts]
    WK --> PRAW[PRAW: Reddit API]
    FF --> OUT[outputs/ MP4]
```

## Video Generation Pipeline

Job status is the source of truth, stored in PostgreSQL and polled by the frontend every 2s:

```mermaid
flowchart TD
    Q[QUEUED] --> F[FETCHING_POST]
    F --> V[GENERATING_VOICEOVER]
    V --> T[TRANSCRIBING]
    T --> C[RENDERING_TITLE_CARD]
    C --> G[PICKING_GAMEPLAY]
    G --> X[COMPOSITING_VIDEO]
    X --> UP[UPLOADING]
    UP --> D[DONE]
    F -.->|any step fails| E[FAILED]
    V -.-> E
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
        text post_id
        text post_title
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
        uuid user_id PK,FK
        text period PK
        int count
    }
```

## Prerequisites

- Python 3.11+
- Node.js (LTS)
- FFmpeg (`brew install ffmpeg` / `apt install ffmpeg`)
- Docker (for Postgres + Redis via `docker-compose`)

## Setup

_Detailed setup instructions land in Phase 4 (feature/docs). Until then, follow PROGRESS.md._

## Documentation

Full setup guide, Reddit API credentials walkthrough, seed admin credentials, gameplay clip management, and environment variable reference will be completed in `feature/docs`.
