# Feature Plan: S3 Storage, User-Uploaded Backgrounds, and Retention Lifecycle

Status: Proposed
Owner: TBD
Scope: backend (FastAPI + Celery), frontend (Next.js), infrastructure (S3/IAM/docker)

---

## 1. Summary

Move ReelBot's file storage from the local filesystem to Amazon S3 and introduce a
full lifecycle for every object the platform touches:

1. **User-uploaded background footage** — users may optionally upload their own
   vertical gameplay/background clip, which lands directly in an S3 bucket via
   presigned uploads. A low-quality preview copy lets them view their footage
   inside the application through short-lived signed links.
2. **Intermediate render artifacts in S3** — voiceover audio, subtitle files,
   title cards, and raw composites are persisted to a `scratch/` prefix during
   rendering (instead of living only in worker-local `/tmp`), enabling crash
   recovery and cheap auto-cleanup.
3. **Retention choice at generation time** — the user picks one of two modes
   when generating a reel:
   - **Temporary** (default, free tier): the finished MP4 is automatically
     deleted from S3 after a configurable TTL (target: 10–20 minutes, default 15).
   - **Retain** (premium-gated): the MP4 persists until the user manually
     deletes it.
4. **Automatic garbage collection** — S3 lifecycle rules plus scheduled Celery
   beat tasks remove expired finals, stale scratch artifacts, abandoned
   multipart uploads, and orphaned pending background uploads.
5. **Security-first design** — zero public objects, per-user key namespaces,
   ownership-checked presigned URLs with short TTLs, and no client-controlled
   key material anywhere in the system.

Non-goals: payment/billing integration (premium is a `plan` flag flipped by
admins), CDN distribution, multi-region replication.

---

## 2. Current State (what this plan replaces)

Relevant code today:

| Component | Location | Behavior |
|---|---|---|
| Storage adapter | `backend/services/storage.py` | Three functions — `upload(path, key)`, `resolve(key)`, `delete(key)` — backed by `LOCAL_STORAGE_PATH` on disk |
| Render pipeline | `backend/tasks/render.py` | Writes intermediates (`voice.mp3`, `subs.ass`, `title.png`, `output.mp4`) into `/tmp/reelbot/{job_id}`, then calls `storage.upload(output_path, f"reels/{job_id}.mp4")` |
| Result pointer | `jobs.result_url` (`models.py`) | Stores the *logical key* (not a URL), e.g. `reels/{job_id}.mp4` |
| Downloads | `backend/routers/jobs.py::download_job` | Ownership check via `_get_job_checked`, then `FileResponse(path)` streaming from disk |
| Gameplay library | `backend/services/assets.py`, `routers/assets.py` | Admin-only clips on local disk under `ASSETS_DIR`; `pick_clip_sync()` returns a local path to the worker |
| Plans/roles | `users.role` (`models.py`) | Only `free` / `admin`; no premium concept |

Key architectural facts the design must respect:

- The Celery worker uses the **sync** DB session (`sync_db.SyncSessionLocal`);
  the API uses the async session. Storage helpers therefore need both-friendly
  (pure-sync boto3) implementations.
- FFmpeg requires **local files**; workers will always pull from S3 to a local
  scratch directory before rendering. S3 replaces the durable layer, not ffmpeg's working directory.
- The frontend reaches the backend exclusively through `/api/proxy/*`
  (Next.js attaches the backend JWT server-side), so presigned URLs must be
  minted by FastAPI after authentication, never by Next.js itself.

---

## 3. Target Architecture

```
                       ┌──────────────────────────────┐
 Browser ──presigned──▶│  S3 bucket (private)         │
 PUT (parts)           │                              │
                       │  users/{uid}/backgrounds/…   │  user footage + previews
 Browser ◀─presigned───│  users/{uid}/reels/…         │  final renders (TTL or retain)
 GET (short TTL)       │  scratch/{job_id}/…          │  intermediates (auto-expire)
                       │  library/{asset_id}.mp4      │  admin gameplay pool
                       └──────────────────────────────┘
                          ▲            ▲
        boto3 (sync)      │            │      boto3 (sync)
                   ┌──────┴────┐  ┌────┴─────┐
                   │ FastAPI   │  │ Celery   │◀── beat: reaper + sweeper
                   │ API       │  │ worker   │
                   └───────────┘  └──────────┘
```

- **Single private bucket**, Block Public Access enabled at account level.
  One bucket keeps IAM simple; prefix-level separation provides organization,
  and *all* reads/writes go through authenticated, ownership-checked endpoints
  or presigned URLs. (Optional hardening: split `scratch` into its own bucket
  with an aggressive lifecycle — see §9.)
- **Local disk remains the ffmpeg working set** (`/tmp/reelbot/{job_id}`),
  unchanged. Durable copies of chosen artifacts are pushed to `scratch/`.
- **MinIO in docker-compose** for local development, driven by
  `S3_ENDPOINT_URL`; production uses real S3 with the same code path.

### 3.1 Key namespace (authoritative)

```
{prefix}                                  owner         lifetime
users/{user_id}/backgrounds/{bg_id}/source.mp4    user   until user deletes
users/{user_id}/backgrounds/{bg_id}/preview.mp4   user   until user deletes
users/{user_id}/reels/{job_id}.mp4                user   TTL (ephemeral) or retain
scratch/{job_id}/voice.mp3                        job    lifecycle-expired 24 h
scratch/{job_id}/subs.ass                         job    lifecycle-expired 24 h
scratch/{job_id}/title.png                        job    lifecycle-expired 24 h
scratch/{job_id}/output.mp4                       job    lifecycle-expired 24 h
library/{asset_id}.mp4                            global until admin deletes
```

Rules:

- Keys are **always derived server-side** from UUIDs. Client-supplied filenames
  are used for display only and never appear in any key.
- The `user_id` path segment is defense-in-depth: even a future misconfiguration
  cannot expose user A's object under user B's prefix in an enumerable way.

---

## 4. Data Model Changes (Alembic migrations)

```python
# models.py additions

class User(Base):
    ...
    plan: Mapped[str] = mapped_column(Text, nullable=False, default="free")  # 'free' | 'premium'

class Job(Base):
    ...
    retention: Mapped[str] = mapped_column(Text, nullable=False, default="ephemeral")  # 'ephemeral' | 'retain'
    result_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # result_url stays as-is: NULL means "object gone/expired", non-NULL + DONE means downloadable.
    # When the reaper deletes an ephemeral object it sets result_url = NULL and records
    # result_expired_at for analytics (new nullable column).

class UserBackground(Base):
    __tablename__ = "user_backgrounds"

    id: Mapped[uuid.UUID]              # pk, gen_random_uuid()
    user_id: Mapped[uuid.UUID]         # FK users.id, ondelete CASCADE
    status: Mapped[str]                # 'pending' | 'processing' | 'ready' | 'failed'
    label: Mapped[str]                 # display name (sanitized, max 80 chars)
    source_key: Mapped[str]            # users/{uid}/backgrounds/{id}/source.mp4
    preview_key: Mapped[str | None]
    duration_seconds: Mapped[float | None]
    file_size_bytes: Mapped[int | None]
    resolution: Mapped[str | None]
    error_message: Mapped[str | None]
    created_at / updated_at
```

`Job.settings` (JSONB) gains two sanitized fields:

- `gameplay_source`: `"library"` (default) | `"user"`
- `background_id`: UUID string — validated at job creation to belong to
  `job.user_id` **and** be in `ready` status; otherwise rejected with 403/422.

New settings knobs (`backend/config.py`):

```python
STORAGE_BACKEND: str = "local"            # 'local' | 's3'
S3_ENDPOINT_URL: str = ""                  # empty = real AWS; MinIO URL for dev
S3_REGION: str = "us-east-1"
S3_BUCKET: str = "reelbot-prod"
AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY  # or instance profile in prod (preferred)
RETENTION_TTL_MINUTES: int = 15            # ephemeral reel lifetime (10–20 target)
SCRATCH_TTL_HOURS: int = 24
MAX_BACKGROUND_UPLOAD_MB: int = 500
PREVIEW_SIGNED_TTL_SECONDS: int = 900      # 15 min
DOWNLOAD_SIGNED_TTL_SECONDS: int = 600     # 10 min
UPLOAD_PART_SIGNED_TTL_SECONDS: int = 3600
FREE_MAX_BACKGROUNDS: int = 3
PREMIUM_MAX_BACKGROUNDS: int = 25
```

---

## 5. Storage Adapter (Phase 1)

Refactor `services/storage.py` into a thin dispatcher over two backends,
keeping the exact same call signatures so `render.py` and `jobs.py` change
minimally:

```python
# services/storage.py (shape)
def upload(path: str, key: str) -> str       # local: move file; s3: put_object/multipart, return key
def resolve(key: str) -> str | None          # local: path; s3: download to /tmp cache, return local path
def delete(key: str) -> None                 # both: best-effort, never raises
def presign_get(key: str, ttl: int, filename: str | None = None) -> str   # s3 only
def presign_part(...) / create_multipart(...) / complete_multipart(...)   # s3 only
def stat(key: str) -> dict | None            # head_object wrapper (size, content_type)
```

Notes:

- `resolve()` for S3 downloads into a per-process temp dir with the same
  basename; workers call it exactly where they previously received a disk path.
- boto3 clients are module-level singletons; `S3_ENDPOINT_URL` honored for MinIO.
- The `local` backend stays fully functional so development without Docker/S3
  keeps working, and as a fallback.

### 5.1 Internal Access Path (no URLs inside the backend)

There are exactly two access paths, and they must not be conflated:

| Path | Mechanism | Credentials | Lifetime |
|---|---|---|---|
| Browser ↔ S3 (preview/download) | Presigned URL minted by FastAPI after ownership check | None (signature IS the token) | 10–15 min, single object + verb |
| API/Worker ↔ S3 (pipeline I/O) | Direct boto3 calls (`download_file` / `upload_file`) | Server-side IAM creds (env in dev, instance/task role in prod) | Permanent, never leaves the server |

Consequences for `tasks/render.py`: **nothing changes structurally**. The task
still works entirely out of `/tmp/reelbot/{job_id}` with local paths; ffmpeg
still burns ASS subtitles from a local file. The only delta:

```python
# BEFORE (Phase 0)
clip_path = assets.pick_clip_sync(cfg.get("gameplay_category", "any"))   # reads ASSETS_DIR

# AFTER (Phases 1–2)
clip_path = assets.pick_clip_for_job_sync(job_user_id, cfg)
#   library mode → storage.resolve(f"library/{asset_id}.mp4")            → boto3 GET to /tmp
#   user mode    → re-check UserBackground.user_id == job_user_id, then
#                  storage.resolve(bg.source_key)                         → boto3 GET to /tmp
# intermediates: written locally as today, mirrored up via
#   storage.upload(local, f"scratch/{job_id}/{name}") after each stage
# finals:        storage.upload(output_path, f"users/{uid}/reels/{job_id}.mp4")
```

Privacy model, restated concretely:

1. **Object selection is server-side.** Keys are constructed in Python from
   UUIDs loaded through ownership-checked DB queries. Clients submit IDs, never
   keys, so no user can name another user's object even in a forged request.
2. **Credentials are infrastructure secrets.** boto3 signs requests (SigV4)
   with IAM credentials present only on API/worker hosts. A user can no more
   invoke these than they could open a raw Postgres socket.
3. **Presigned URLs are the only credential-shaped thing that crosses the
   trust boundary**, and they are single-object, single-verb, short-TTL, and
   redacted from logs (§10).

Anti-pattern (explicitly rejected): passing a presigned HTTPS URL to ffmpeg as
input. It leaks signatures into process arguments and logs, forfeits retry and
timeout control, prevents multipart throughput, and diverges from the
local-backend development path.

**Download endpoint change** (`routers/jobs.py::download_job`):

- Ownership checks stay identical (`_get_job_checked`).
- Instead of `FileResponse`, return
  `{"url": presign_get(job.result_url, ttl, filename=f"{safe_title}.mp4"), "expires_in": ttl}`.
- Presigned GET includes response header overrides:
  `ResponseContentDisposition: attachment; filename="{safe_title}.mp4"` and
  `ResponseContentType: video/mp4` — forcing download and preventing inline
  content-type sniffing.
- Frontend: `/api/proxy/jobs/{id}/download` becomes `/api/proxy/jobs/{id}/download-url`;
  the browser follows the returned URL directly (crossing from the app origin to
  the bucket origin is intentional — different domains mean app cookies are never
  attached to storage requests).

**Existing-data migration:** one-off script `scripts/backfill_s3.py` walks
`LOCAL_STORAGE_PATH/reels/**`, uploads each object under the same key, and
verifies checksums. Local files are retained until verification passes, then
archived. Admin library clips migrate under `library/{existing_filename}`.

Acceptance criteria:

- [ ] With `STORAGE_BACKEND=s3`, generate-reel produces a playable presigned URL end-to-end.
- [ ] With `STORAGE_BACKEND=local`, behavior is byte-for-byte identical to today.
- [ ] Deleting a job removes the S3 object (verified by `stat()` returning None).

---

## 6. User Background Uploads (Phase 2)

### 6.1 Flow

```
Client                                API (auth required)                    S3
  │ POST /backgrounds/init                │                                  │
  │  {label, size_bytes, content_type}    │ validate plan limits + size cap  │
  │ ◀── {background_id, upload_id,        │ create row status='pending'      │
  │      parts:[{url,part_number}…]}      │ create_multipart_upload          │
  │ PUT part bytes ×N ────────────────────────────────────────────────────▶ │
  │ POST /backgrounds/{id}/complete       │                                  │
  │  {parts:[{part_number, etag}…]}       │ complete_multipart_upload        │
  │                                       │ enqueue celery probe task        │
  │ ◀── {id, status:'processing'}         │                                  │
Celery worker: ffprobe → validate → transcode_vertical(source→normalized 1080×1920)
               + render low-quality preview (360×640, high CRF, no audio strip needed)
               → upload both → status='ready'
  │ GET /backgrounds                      │ list own rows                    │
  │ GET /backgrounds/{id}/preview-url     │ ownership check → presigned GET  │
  │ DELETE /backgrounds/{id}              │ ownership check → delete objs+row│
```

Why direct-to-S3: background clips are hundreds of MB; proxying through FastAPI/
Next.js would double bandwidth and pin worker connections. The API only ever
handles metadata.

### 6.2 Validation (server-side, post-upload — never trust the client)

Performed by the Celery probe task on the completed object:

1. `ffprobe` succeeds; container is mp4/mov/webm; has a video stream.
2. Duration between 30 s and 600 s (matches library rules; configurable).
3. Size ≤ `MAX_BACKGROUND_UPLOAD_MB` (also enforced pre-upload via presigned
   part conditions `content-length-range`).
4. Transcode to normalized 1080×1920 (reuse `video.transcode_vertical`) — the
   source is kept for re-transcodes; preview generated at 360×640 / CRF 32.
5. Any failure → status=`failed`, objects deleted, `error_message` surfaced to
   the owner only.

Per-user caps enforced in `/backgrounds/init`: count of `ready` backgrounds
vs. `FREE_MAX_BACKGROUNDS` / `PREMIUM_MAX_BACKGROUNDS`.

### 6.3 Pipeline integration

- `pick_clip_sync(category)` gains a sibling
  `pick_clip_for_job_sync(user_id, settings)`:
  - `settings.gameplay_source == "user"` → load `UserBackground` row (assert
    `user_id` matches the job's `user_id` again inside the worker — never trust
    settings alone), `resolve(source_key)` to a local path, return it.
  - else fall back to the existing library picker.
- Dashboard UI: background selector gains a third mode "My footage" listing the
  user's ready uploads with thumbnail/preview playback (see §8), upload
  progress per part, and delete buttons.

Acceptance criteria:

- [ ] Uploading a 200 MB clip from the dashboard completes without touching API bandwidth.
- [ ] Non-ready / failed backgrounds cannot be selected for a job.
- [ ] Preview plays in-app via a URL that stops working after `PREVIEW_SIGNED_TTL_SECONDS`.

---

## 7. Retention Model (Phase 3)

### 7.1 Semantics

| | Temporary (default) | Retain |
|---|---|---|
| Availability | Free tier | Premium (`users.plan == 'premium'` or `role == 'admin'`) |
| Final object | Deleted from S3 `RETENTION_TTL_MINUTES` after status hits `DONE` | Persists indefinitely |
| History row | Kept forever (title, settings, duration, statuses) — only the media is reaped | Same |
| Manual delete | Available until expiry (existing `DELETE /jobs/{id}`) | Available anytime |

State encoding (deliberately minimal):

- `DONE && result_url != NULL` → downloadable.
  - `retention == 'ephemeral'` → UI renders a live countdown from
    `result_expires_at`.
  - `retention == 'retain'` → `result_expires_at` is NULL.
- `DONE && result_url == NULL` → expired/reaped; UI shows "This reel has
  expired" with the original title/duration intact.
- `result_expires_at` is stamped by the worker in the same transaction that sets
  `status='DONE'` (`now() + RETENTION_TTL_MINUTES`). Clock lives entirely
  server-side; clients only receive the timestamp.

Optional enhancement (behind a flag): sliding expiry — each successful
download extends `result_expires_at` by the TTL, capped at one extension.
Default OFF for v1 to keep mental load low.

### 7.2 Entitlement enforcement

- `POST /jobs` sanitizer: `retention = "retain"` requires
  `user.plan == "premium" or user.role == "admin"`; free users requesting
  retain receive `403 {"detail": "Retain requires a premium plan"}`.
- The reaper independently re-checks plan at reap time — if an admin downgrades
  a user, already-retained reels are NOT retroactively reaped (documented
  product decision; flip via admin action if ever needed).
- Admin panel: user rows gain a plan toggle writing `users.plan` (manual
  premium management until billing exists).

### 7.3 The Reaper (Celery beat)

```python
@celery.task
def reap_expired_reels():
    # SELECT id, user_id, result_url FROM jobs
    # WHERE status='DONE' AND retention='ephemeral'
    #   AND result_url IS NOT NULL AND result_expires_at <= now()
    # FOR UPDATE SKIP LOCKED
    # → storage.delete(result_url); result_url=NULL; result_expired_at=now()
```

- Schedule: every 60 s (`celery -A tasks.render beat` entry or
  `beat_schedule` dict). Batch limit 100/run.
- Idempotent: deleting an already-deleted key is a no-op (`storage.delete`
  swallows missing keys).
- `SKIP LOCKED` prevents double-deletes across multiple workers.
- Failure handling: S3 errors leave the row untouched; the next tick retries.

Acceptance criteria:

- [ ] An ephemeral job's object disappears within TTL + 60 s; a retain job's object survives ≥ 24 h.
- [ ] Free user cannot create a retain job (403); premium user can.
- [ ] Reaper is safe to run concurrently (no exceptions, no double work).

---

## 8. Frontend Changes

| Surface | Change |
|---|---|
| `app/dashboard/page.tsx` | Retention selector (radio pair: "Auto-delete after 15 min" default / "Keep until I delete" with a premium tag; disabled with tooltip for free plans). Background selector gains "My footage" mode: list of ready backgrounds, upload button with per-part progress, inline `<video>` preview player whose `src` is fetched on demand via `/api/proxy/backgrounds/{id}/preview-url` and revoked on unmount |
| New `components/background-upload.tsx` | Init → parallel part uploads (XHR with progress events) → complete; polls status until ready/failed |
| `app/jobs/page.tsx` | Countdown badge for ephemeral DONE jobs (`result_expires_at`), "Expired" state row styling, existing Delete button unchanged |
| `lib/api.ts` | Endpoints for backgrounds init/complete/list/delete/preview-url; download switched to `download-url` |
| Types | `UserBackground`, updated `Job` (`retention`, `result_expires_at`) in `lib/types.ts` |

Preview hygiene: presigned URLs live only in component memory (state/ref),
never in `localStorage`, never logged, never sent to analytics.

---

## 9. Garbage Collection (Phase 4)

Three independent layers, so a failure in one never leaks storage:

1. **S3 lifecycle rules** (bucket-level, applied via IaC/console at deploy):
   - Prefix `scratch/` → expire objects 24 h after creation (`SCRATCH_TTL_HOURS`).
   - Whole bucket → `AbortIncompleteMultipartUpload` after 7 days (kills
     abandoned part uploads that never reach `/complete`).
2. **Explicit deletes in the pipeline**: `render.py`'s existing
   `finally: shutil.rmtree(tmp)` gains best-effort
   `storage.delete(f"scratch/{job_id}/{artifact}")` for each artifact on
   terminal states (DONE/FAILED). Success-path keeps them briefly for
   post-mortem; the lifecycle rule is the backstop.
3. **Celery beat sweeper** (hourly):
   - `UserBackground` rows stuck in `pending`/`processing` > 48 h → attempt
     abort of their multipart upload, delete partial objects, mark `failed`.
   - Rows `failed` > 7 days → drop row + objects (keeps listings clean).
   - Orphan scan (weekly, cheap): list `users/*/reels/*` and confirm each key
     maps to a non-null `jobs.result_url`; delete true orphans and log loudly —
     this is the audit trail that nothing escapes the DB bookkeeping.

Local `/tmp/reelbot` already self-cleans per job; add a worker-startup sweep
deleting leftover `/tmp/reelbot/*` dirs older than 12 h (crash residue).

Scratch artifacts written by the worker (§5/§6 refactor of `render.py`):

```python
ARTIFACTS = {"voice": "voice.mp3", "subs": "subs.ass", "card": "title.png"}
# after each stage: storage.upload(local_path, f"scratch/{job_id}/{name}")
# retry path: if scratch/{job_id}/voice.mp3 exists and stat() agrees with job stage,
# skip TTS regeneration and resume from TRANSCRIBING (saves ElevenLabs spend)
```

Resume-from-artifact is a bonus capability unlocked by scratch persistence;
implement it as a guarded fast-path, falling back to full regeneration on any
inconsistency.

---

## 10. Security Model

Threat: user A obtaining user B's footage/reels, or anyone obtaining URLs or
objects without an account.

### Controls

1. **No public objects.** Bucket has Block Public Access (account level) and no
   public-read policy. The only read paths are (a) authenticated API endpoints
   and (b) presigned URLs minted after an ownership check.
2. **Ownership checks everywhere, twice.**
   - Every `/backgrounds/*` and `/jobs/*/download-url` route resolves the row
     and compares `user_id` to the JWT-derived user (`_get_job_checked`
     pattern; reuse it — return **404**, not 403, for foreign IDs so
     enumeration reveals nothing).
   - The worker re-validates `background.user_id == job.user_id` before
     reading, because `job.settings` is attacker-influenced input.
3. **Short-TTL presigned URLs only.** Preview 15 min, download 10 min, upload
   parts 60 min. URLs contain no identity claims — they are bearer tokens, so
   they are treated like tokens: short-lived, scoped to exactly one object and
   one verb, never logged, never cached, never embedded in emails.
4. **Server-derived keys.** Clients send IDs and metadata only; every key is
   built from UUIDs server-side (`f"users/{uid}/backgrounds/{bg_id}/source.mp4"`).
   Filename sanitization applies to the display label only (strip control
   chars, cap length).
5. **Upload constraints.** Presigned part URLs carry `content-length-range`;
   content-type allowlist enforced at init and re-validated by ffprobe
   post-upload (magic-byte trust comes from probing, not headers).
6. **Transport & rest encryption.** Bucket policy denies non-TLS
   (`aws:SecureTransport false`); SSE-S3 (or SSE-KMS with a CMK if compliance
   requires) on all objects.
7. **Least-privilege IAM.** Two distinct principals:
   - `reelbot-api`: `GetObject`, `PutObject`, `DeleteObject`, `ListBucket`,
     `AbortMultipartUpload`, `Create/CompleteMultipartUpload` scoped to
     `arn:aws:s3:::BUCKET` + `BUCKET/*` (prefix narrowing optional).
   - `reelbot-worker`: same verbs minus nothing today, split later if desired.
   No wildcards on principals; prod uses instance profiles/task roles, never
   static keys in `.env` (keys only for local dev against MinIO).
8. **Proxy boundary preserved.** Presigned URL requests originate from the
   browser but carry no app cookies (different registrable domain), and the
   Next.js `/api/proxy/*` route continues to be the only place the backend JWT
   is attached — the bucket never sees session material.
9. **Logging hygiene.** Presigned URLs are redacted in serializers/loggers
   (they contain valid signatures); S3 server access logs or CloudTrail data
   events enabled in prod for audit; alert on anomalous `GET` volume per
   prefix.
10. **Expiry UX honesty.** After the reaper runs, `result_url` is NULL — an
    expired link can never 200 because the object no longer exists; the UI
    reflects the authoritative DB state rather than guessing from clock skew.

### Explicit non-features (for security reasons)

- No client-supplied object keys, no client-chosen ACLs, no public-share links
  in v1, no server-side copying between user prefixes.

---

## 11. Implementation Phases & Milestones

| Phase | Deliverables | Depends on | Est. effort |
|---|---|---|---|
| 0 — Foundations | boto3 dep, MinIO service in `docker-compose.yml`, settings plumbing, IAM/Terraform notes | — | 0.5 d |
| 1 — Storage adapter | `storage.py` dual-backend, presign helpers, `download-url` endpoint + frontend switch, backfill script | 0 | 1.5 d |
| 2 — User backgrounds | Migration + `UserBackground` model, `/backgrounds/*` routes, probe/transcode Celery task, dashboard uploader + preview UI, pipeline `pick_clip_for_job_sync` | 1 | 3 d |
| 3 — Retention | `users.plan`, `jobs.retention/result_expires_at`, sanitizer gating, reaper beat task, dashboard/jobs UI states, admin plan toggle | 1 | 1.5 d |
| 4 — Scratch + GC | Artifact uploads + resume fast-path in `render.py`, lifecycle rules, sweeper tasks, orphan audit | 1 | 1.5 d |
| 5 — Hardening & docs | Cross-user test suite, redaction middleware, README/env-doc updates | 1–4 | 1 d |

Sequencing note: Phase 3 can proceed in parallel with Phase 2 (it depends only
on Phase 1).

---

## 12. Test Plan

Unit:

- Key builders produce namespaced keys; never interpolate client strings.
- Settings sanitizer: foreign `background_id` rejected; `retention=retain`
  rejected for free users; invalid combos fall back to safe defaults.
- TTL math: `result_expires_at = done_at + RETENTION_TTL_MINUTES` (freeze time).

Integration (pytest + moto/MinIO):

- Generate reel with `STORAGE_BACKEND=s3` → object exists → presigned GET
  downloads identical bytes → reaper deletes after TTL → GET returns 403/404.
- Cross-user matrix: user B calling `/backgrounds/{A_id}/preview-url`,
  `/jobs/{A_id}/download-url`, `DELETE /backgrounds/{A_id}` → all 404.
- Worker picks user background only when row belongs to job owner.
- Multipart: happy path, abandoned upload swept by lifecycle/abort, oversized
  upload rejected at init and by probe.
- Retain job survives 25 h with reaper running every minute (fake clock).

Manual QA checklist: preview autoplay in Chrome/Safari, countdown rendering
across timezone, expired-state UI, admin plan toggle effect on dashboard CTA.

---

## 13. Rollout & Ops

- Feature-flag rollout: `STORAGE_BACKEND` per environment; ship Phase 1 to dev
  (MinIO) first, staging, then prod with the backfill window announced.
- Monitoring: reaper/sweeper task duration + failure alerts; S3 bucket size
  metric with alarm on week-over-week growth; count of expired-vs-total DONE
  jobs as a product health signal.
- Cost guardrails: ephemeral-by-default keeps hot storage tiny; lifecycle rules
  prevent silent accumulation; `PREVIEW`/`DOWNLOAD` TTLs bound request signing
  exposure. Rough sizing note: 500 MB max source + ~5 MB preview + ~10 MB reel
  per retained job — trivially bounded by `*_MAX_BACKGROUNDS` and plan gates.

## 14. Open Questions

1. Sliding expiry on download (extend TTL per view) — enable post-v1?
2. Should ephemeral reels get a low-res preview too (streamable after the MP4
   expires), or is full deletion the honest product?
3. Background sharing between teams/users (currently strictly personal)?
4. Billing integration trigger for `premium` (Stripe webhook vs admin-managed)?
