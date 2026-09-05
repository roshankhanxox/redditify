# Security Audit — Redditify / ReelBot Content Engine

**Scope:** Full application — auth, authorization, secrets, input handling, abuse
vectors, storage exposure, and infrastructure. Covers the existing reel pipeline
and the new content-engine clip pipeline.

**Severity legend:** 🔴 Critical · 🟠 High · 🟡 Medium · 🟢 Low / hardening

---

## 1. Authentication & Session

### 🔴 A1 — Default `SECRET_KEY` present in committed `.env`
`backend/config.py:9` and `backend/.env:3` both carry
`SECRET_KEY=replace_with_64_char_random_string`. JWTs are signed with HS256 using
this key (`security.py:35`). If this value reaches any shared/staging/prod
environment, **anyone can forge a valid admin token** — the entire authorization
model collapses. `.env` is correctly gitignored, but the live local `.env` still
holds the placeholder, which means the app boots and signs tokens with a
publicly-known secret.
- **Action:** Fail fast at startup if `SECRET_KEY` equals the placeholder or is
  shorter than 32 bytes. Generate per-environment secrets. Rotate immediately if
  the placeholder was ever used beyond localhost.

### 🟠 A2 — No token revocation / password change doesn't invalidate sessions
Tokens live 7 days (`ACCESS_TOKEN_EXPIRE_MINUTES = 60*24*7`). `change-password`
(`routers/auth.py:59`) rehashes the password but does **not** invalidate
previously issued JWTs — a stolen or leaked token remains valid for up to a week
after a password reset. There is no `jti`/blocklist and no `token_version` column.
- **Action:** Add a `token_version` (or `password_changed_at`) claim; reject
  tokens whose version predates the user row. Shorten access-token lifetime and
  introduce refresh tokens if session longevity is needed.

### 🟡 A3 — User enumeration on registration
`register` returns `409 "Email already registered"` (`routers/auth.py:33`) while
`login` correctly returns a generic error. The 409 lets an attacker enumerate
which emails have accounts.
- **Action:** Return a generic success/neutral response on register, or gate
  registration behind email verification.

### 🟡 A4 — No brute-force protection on `/auth/login`
There is no rate limiting, lockout, or backoff on login (`routers/auth.py:42`).
bcrypt slows each attempt but does not stop credential-stuffing at scale.
- **Action:** Per-IP + per-account attempt throttling (see A9 and suggestion.md
  §Rate Limits).

### 🟢 A5 — Password policy is length-only
`min_length=8` with no complexity/breach checks (`routers/auth.py:16,27`).
Acceptable, but consider a HaveIBeenPwned k-anonymity check or zxcvbn scoring.

---

## 2. Authorization

### 🟢 A6 — Object ownership checks are consistent and correct
Ownership is enforced server-side across jobs (`routers/jobs.py:327`), backgrounds
(`routers/backgrounds.py:35`), and clip jobs (`routers/clip_jobs.py:_get_job_checked`).
Foreign/missing IDs are made indistinguishable (404), which is good practice.
Storage object keys are never exposed to clients (`backgrounds.py:44`). This area
is a strength.

### 🟡 A7 — Admin role toggle has no guardrails
`PATCH /admin/users/{id}` (`routers/admin.py:55`) lets any admin promote any user
(including themselves already being admin) to `admin`. There is no audit log and
no protection against removing the last admin.
- **Action:** Log privilege changes; prevent demoting the final admin; consider a
  separate super-admin tier for role grants.

### 🟢 A8 — Clip download/thumbnail correctly re-check job ownership
`routers/clip_jobs.py` re-runs `_get_job_checked` before minting presigned URLs or
serving files for both download and thumbnail routes. Good.

---

## 3. Abuse & Resource Exhaustion (biggest risk area)

### 🔴 A9 — Clip jobs completely bypass quota and rate limiting
`POST /clip-jobs` (`routers/clip_jobs.py:create_clip_job`) has **no**
`Depends(check_quota)` and never calls `increment_quota` — unlike `POST /jobs`
(`routers/jobs.py:263`). A single free user can enqueue unlimited clip jobs. Each
job triggers:
- a full Whisper transcription (CPU-heavy),
- an LLM API call (real token cost — Anthropic/OpenAI/Groq),
- **up to 10 double video re-encodes** (see review.md R7).

Because the worker is single-slot (A10), a handful of submissions is an effective
denial-of-service against the whole platform **and** an unbounded cost drain on
the LLM key.
- **Action:** Add a dedicated clip-job quota (daily/monthly), enforce it as a
  dependency, and increment on creation. Add a hard cap on concurrent in-flight
  clip jobs per user. Meter LLM token spend.

### 🔴 A10 — Single-slot worker = trivial DoS
`run.sh:77` launches Celery with `--pool=solo --concurrency=1`. Every task —
reels, background transcodes, clip jobs — is serialized through one process. One
long clip job (10 sequential encodes on a 10-minute video) blocks **all** other
users' renders for the duration. Combined with A9, this is a one-request DoS.
- **Action:** Separate queues (e.g. `renders`, `clips`, `maintenance`) with
  independent worker pools; raise concurrency; move CPU-bound encode work onto a
  sized pool. See suggestion.md §Scaling.

### 🟠 A11 — No global HTTP rate limiting
`slowapi`/equivalent is absent everywhere. Every endpoint — login, register,
job create, background init, clip create — is unthrottled. `POST /auth/register`
allows unlimited account creation (spam/abuse).
- **Action:** Introduce app-wide and per-route limits. Concrete tiers proposed in
  suggestion.md.

### 🟡 A12 — Background/clip upload size caps exist but count-caps are race-prone
`init_background` checks `ready_count >= cap` (`backgrounds.py:112`) then creates a
pending row. The check is not atomic with creation, so parallel init calls can
exceed the cap. Low impact (bounded by cap+concurrency) but real.
- **Action:** Enforce with a DB constraint or `SELECT ... FOR UPDATE` on a counter
  row.

---

## 4. Input Handling & Injection

### 🟢 A13 — FFmpeg inputs are not shell-interpolated
`run_ffmpeg` (`services/video.py:5`) passes an argv list to `subprocess.run`
without `shell=True`. Subtitle paths are escaped for the libass filter
(`video.py`, `tasks/clip.py:_render_clip_composite`). No command injection via
filenames/keys, which are server-derived anyway. Good.

### 🟢 A14 — SQL uses the ORM / bound parameters throughout
No raw string SQL; all queries go through SQLAlchemy expressions. No SQLi surface.

### 🟡 A15 — LLM prompt injection via uploaded video audio
The clip analyser feeds a Whisper transcript of **user-supplied** video directly
into the LLM system+user prompt (`services/clip_analyser.py`). A user can speak
"ignore your instructions and …" into their video. Impact is contained because
the output is validated: timestamps are snapped to real word boundaries and
clamped (`_validate_clip`), and `clip_type` is whitelisted. But `hook` and
`reason` are free-text fields written to the DB and rendered in the UI.
- **Residual risk:** Injected/offensive text surfaced in the gallery. React escapes
  by default so it is **not** stored XSS, but content moderation is nil.
- **Action:** Treat transcript as untrusted data (already mostly done); length-cap
  and optionally moderate `hook`/`reason`; never let the model's text drive control
  flow (it currently doesn't — keep it that way).

### 🟢 A16 — Upload content-type allow-lists are enforced server-side
`ALLOWED_CONTENT_TYPES` for video (`backgrounds.py:19`) and image
(`backgrounds.py:227`), plus ffprobe re-validation in `process_background`
(never trusting client metadata). Strong.

---

## 5. Storage & Data Exposure

### 🟠 A17 — Generated clips have no lifecycle and leak on job deletion
Reels are reaped on a TTL and audited by `sweep_orphan_objects`
(`tasks/maintenance.py`). **Clips are covered by neither.** The orphan sweep only
matches `/reels/`, `/thumbs/`, `/previews/` (`maintenance.py:133`); `users/*/clips/*`
objects are invisible to it. If a `clip_jobs` row is ever removed out-of-band, or a
clip upload partially fails, the MP4/thumbnail objects orphan permanently. Clips
also never expire, so storage grows unbounded.
- **Action:** Extend the orphan sweep to clip keys; add a retention policy for
  clips (or an explicit "keep" flag mirroring reels); ensure `DELETE /clip-jobs`
  (which does clean up, `clip_jobs.py:delete_clip_job`) is the only removal path.

### 🟢 A18 — Presigned URLs are short-lived and disposition-safe
GET URLs force `attachment` disposition and short TTLs (`storage.py:150`).
Multipart completion uses server-side `ListParts` rather than trusting client ETags
(`backgrounds.py:166`). Good.

### 🟡 A19 — MinIO/Postgres credentials hardcoded in `docker-compose.yml`
`reelbot / reelbot-secret` and `POSTGRES_PASSWORD: reelbot` are fine for local dev
but must never ship. No `.dockerignore`/secret management for prod is defined.
- **Action:** Externalize via env/secrets manager for any non-local deployment.

---

## 6. Transport & Infra

### 🟡 A20 — CORS is hardcoded to a single localhost origin
`main.py:19` allows only `http://localhost:3000` with credentials. Correct for dev,
but it will silently break in prod and, if later widened carelessly with
`allow_origins=["*"] + allow_credentials=True`, becomes a vulnerability.
- **Action:** Drive allowed origins from config per environment; never combine `*`
  with credentials.

### 🟢 A21 — Backend token stays server-side in the proxy
`app/api/proxy/[...path]/route.ts` injects the backend JWT from the Auth.js session
server-side; the token never reaches the browser or the S3 domain. Good design.

### 🟢 A22 — Error messages are scoped to owners
Worker failures store `error_message` on the owner's row only; other users never
see them. Tracebacks are not returned to clients.

---

## Priority Remediation Order
1. **A1** — kill the default `SECRET_KEY` (startup guard + rotate).
2. **A9 + A10** — quota-gate clip jobs and de-serialize the worker (these two
   together are the platform's most exploitable weakness).
3. **A11** — introduce rate limiting (details in suggestion.md).
4. **A17** — clip lifecycle + orphan-sweep coverage.
5. **A2** — token invalidation on password change.
6. Remaining medium/low items as hardening passes.
