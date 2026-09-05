# PROGRESS.md

> Agent: read this before doing anything. Find the first unchecked box. That is your next task.

Last updated: 2026-08-22 — v1.0.0 tagged. All phases complete.

---

## Phase 1 — Repository & Infrastructure

### Repo Setup (branch: feature/repo-setup)
- [x] Git repository initialized
- [x] Monorepo folder structure created: backend/, frontend/, docker-compose.yml
- [x] .gitignore created (covers Python, Node, .env, *.mp4, outputs/, .next/)
- [x] README.md skeleton created
- [x] docker-compose.yml with postgres and redis services
- [x] feature/repo-setup merged to main

### Database Models (branch: feature/db-models)
- [x] SQLAlchemy async engine configured
- [x] Alembic initialized
- [x] User model: id, email, password_hash, role, must_change_password, created_at
- [x] Job model: id, user_id, post_id, post_title, status, settings, result_url, error_message, duration_seconds, created_at, updated_at
- [x] Asset model: id, filename, category, duration_seconds, file_size_bytes, resolution, enabled, created_at
- [x] QuotaUsage model: user_id, period, count
- [x] Initial Alembic migration generated and tested
- [x] seed.py creates admin@reelbot.local with role=admin, must_change_password=True
- [x] feature/db-models merged to main

---

## Phase 2 — Backend Services

### Reddit Integration (branch: feature/reddit-api)
- [x] PRAW client initialized as singleton
- [x] search_posts() filters non-self posts and empty/deleted bodies
- [x] fetch_post() returns title, body, subreddit, score, author
- [x] preprocess_text() strips Markdown, truncates to max_words, prepends subreddit intro
- [x] GET /reddit/search endpoint working (q, subreddit, sort, limit params)
- [x] GET /reddit/post/{post_id} endpoint working
- [x] feature/reddit-api merged to main

### TTS & Whisper (branch: feature/tts-whisper)
- [x] ElevenLabs SDK installed and generate_voiceover_elevenlabs() working
- [x] edge-tts installed and generate_voiceover_edge() working (async wrapped)
- [x] Fallback chain implemented: ElevenLabs → edge-tts, fallback logged silently
- [x] openai-whisper installed (LOCAL package, not cloud API)
- [x] Whisper model loaded as module-level singleton in whisper_service.py
- [x] transcribe() returns word-level timestamp dicts
- [x] words_to_chunks() groups into 4-word chunks, all-caps
- [x] chunks_to_srt() generates valid SRT file with correct timestamp format
- [x] feature/tts-whisper merged to main

### FFmpeg Pipeline (branch: feature/ffmpeg-pipeline)
- [x] run_ffmpeg() helper captures stderr, raises RuntimeError with full output on failure
- [x] get_duration() via ffprobe
- [x] render_video() with filter_complex: scale + overlay + subtitles
- [x] Title card overlaid at top-center (80px from top)
- [x] Subtitles positioned at midsection (MarginV=680, Alignment=2)
- [x] Gameplay looped via -stream_loop -1 to match audio duration
- [x] Output: 1080x1920, 60fps, libx264 CRF 18, AAC 192k, faststart
- [x] Pillow title card render: dark/light/minimal styles
- [x] Reddit orange (#FF4500) subreddit label on title card
- [x] Title word-wrapped at 34 chars, max 4 lines
- [x] Inter font files present in backend/fonts/
- [x] feature/ffmpeg-pipeline merged to main

### Asset Manager Service (branch: feature/asset-service)
- [x] pick_clip() queries DB for enabled clips by category, returns random path
- [x] upload clip endpoint: accepts multipart, validates vertical resolution, min 30s
- [x] Auto-transcode to 1080x1920 if needed (subprocess FFmpeg call)
- [x] Asset DB record created after successful upload
- [x] feature/asset-service merged to main

### Celery Jobs (branch: feature/celery-jobs)
- [x] Celery app initialized with Redis broker and backend
- [x] generate_reel task: all 8 steps in correct order
- [x] set_status() helper updates job.status in DB within its own session
- [x] Job cleanup: tmp directory removed in finally block
- [x] max_retries=2, retry delay 30s
- [x] Duplicate detection: if job for same post_id already QUEUED or PROCESSING, return existing job_id
- [x] feature/celery-jobs merged to main

### Quota System (branch: feature/quota-system)
- [x] check_quota() FastAPI dependency reads QuotaUsage from DB
- [x] Admin role bypasses quota (role == "admin" early return)
- [x] Returns HTTP 429 with descriptive message when daily or monthly limit exceeded
- [x] increment_quota() called on successful job creation
- [x] GET /quota/me returns daily_used, daily_limit, monthly_used, monthly_limit
- [x] feature/quota-system merged to main

### REST API Layer (branch: feature/rest-api)
- [x] FastAPI app with lifespan context manager (not deprecated on_event)
- [x] JWT decode dependency (get_current_user)
- [x] Admin role dependency (require_admin)
- [x] POST /jobs (with check_quota dependency)
- [x] GET /jobs/{job_id}
- [x] GET /jobs (paginated, current user only)
- [x] DELETE /jobs/{job_id}
- [x] GET /assets (enabled clips, categories)
- [x] POST /admin/assets
- [x] PATCH /admin/assets/{id}
- [x] DELETE /admin/assets/{id} (blocks on last enabled clip)
- [x] GET /admin/users (paginated)
- [x] PATCH /admin/users/{id}
- [x] GET /admin/jobs (paginated)
- [x] CORS configured for http://localhost:3000
- [x] v0.1.0 tag created after this merge
- [x] feature/rest-api merged to main

---

## Phase 3 — Frontend

### Frontend Setup (branch: feature/frontend-setup)
- [x] Next.js scaffolded with npx create-next-app@latest (no pinned version), TypeScript, Tailwind, App Router
- [x] shadcn/ui initialized (dark theme)
- [x] shadcn components installed: button, input, card, badge, table, dialog, progress, sonner (toasts), select, slider, separator, avatar, dropdown-menu, skeleton, switch, tabs, radio-group, pagination
- [x] NextAuth.js v5 installed and configured (credentials provider)
- [x] next-auth session type extended with id, email, role fields
- [x] Prisma schema for NextAuth adapter tables
- [x] axios instance created in lib/api.ts with base URL and auth header injection
- [x] SWR installed
- [x] Next.js middleware for protected routes
- [x] feature/frontend-setup merged to main

### Landing Page (branch: feature/landing-page)
- [x] Navbar with logo, Sign In, Get Started buttons
- [x] Hero section: headline, subheading, two CTAs (no background image, dark minimal)
- [x] How It Works: three shadcn Cards (Search / Pick / Download)
- [x] Features: 2x3 grid of feature cards
- [x] Pricing: two cards (Free / Admin)
- [x] Footer
- [x] Fully responsive (mobile stacks)
- [x] No auth required to view
- [x] feature/landing-page merged to main

### Auth Pages (branch: feature/auth)
- [ ] /sign-in page: centered shadcn Card, email + password, validation errors inline
- [ ] /sign-up page: same layout, creates user on submit via POST to backend /auth/register
- [ ] /change-password page: shown when must_change_password is true
- [ ] Redirect to /dashboard on successful sign-in
- [ ] must_change_password enforced in middleware (redirect to /change-password)
- [ ] feature/auth merged to main

### Dashboard (branch: feature/dashboard)
- [x] Protected route (middleware redirects if no session)
- [x] Two-column layout (search left, settings right), stacks on mobile
> Spec pivot: Reddit search replaced by paste-a-story form (title/subreddit/story textarea) per user instruction.
- [x] Search input + sort Select + subreddit input
- [x] Search calls GET /reddit/search, shows Skeleton while loading
- [x] PostCard component: title clamp, subreddit badge, score, comments, word count, Select button
- [x] Selecting a PostCard highlights it and opens settings panel
- [x] Settings panel: Voice Select, Title Style RadioGroup, Gameplay Select, Duration Slider
- [x] QuotaBadge: fetches GET /quota/me, shows "X videos left today"
- [x] Generate button calls POST /jobs, disables during request
- [x] 429 response shown as toast (shadcn Sonner)
- [x] JobStatusTracker: Progress bar + status label, polls every 2s via SWR
- [x] Polling stops on DONE or FAILED
- [x] Download button on DONE
- [x] Error message + retry on FAILED
- [x] feature/dashboard merged to main

### Job History (branch: feature/job-history)
- [x] Protected route
- [x] shadcn Table: Post Title, Subreddit, Status badge, Duration, Created, Actions
- [x] Status badges colour-coded: muted/blue/green/red
- [x] Download action for DONE jobs
- [x] Delete action with confirmation Dialog
- [x] Pagination with shadcn Pagination
- [x] Empty state with CTA link to /dashboard
- [x] feature/job-history merged to main

### Admin Panel (branch: feature/admin-panel)
- [x] Protected + role check (redirect non-admins to /dashboard)
- [x] shadcn Tabs: Overview / Users / Assets / Jobs
- [x] Overview: stat cards (total jobs, today's jobs, total users, storage)
- [x] Users tab: table with role badge, Edit Dialog to change role
- [x] Assets tab: clip list with category badge, duration, enabled Switch, delete button; upload Dialog
- [x] Jobs tab: all jobs table with user email column
- [x] feature/admin-panel merged to main

---

## Phase 4 — Integration & Polish

### Integration (branch: feature/integration)
- [x] End-to-end flow tested: sign up → search → select → generate → download
> Spec pivot: "search" replaced by paste-a-story form; verified repeatedly with real renders.
- [x] ElevenLabs quota exhaustion → edge-tts fallback verified
- [x] Free user quota enforcement tested (3rd video works, 4th returns 429)
- [x] Admin user has no quota restrictions verified
- [x] must_change_password redirect flow tested for admin@reelbot.dev
- [x] FFmpeg failure stored in error_message and displayed in UI
- [x] feature/integration merged to main

### Documentation (branch: feature/docs)
- [x] README.md complete: prerequisites, setup, Reddit API setup guide, seed.py instructions, how to add gameplay clips, docker-compose run instructions
> Spec pivot: Reddit API guide replaced by paste-content docs + run.sh/play.sh launcher guides.
- [x] Mermaid diagrams in README: architecture, video generation pipeline, ER diagram
- [x] .env.example files for both backend and frontend
- [x] PROGRESS.md all checkboxes verified accurate
- [x] v1.0.0 tag created
- [x] feature/docs merged to main

---

## Post-v1 Features

### S3 storage & retention (merged via feature/s3-storage-and-retention)
- [x] Dual-backend storage adapter, presigned downloads, scratch artifacts, lifecycle reaper

### Expressiveness + render customizations (branch: feature/expressiveness-render-customizations)
- [x] TTS expressiveness knob (natural / expressive / dramatic): ElevenLabs voice_settings + edge-tts prosody contour
- [x] Caption knobs: font size (48–140), position lower/center/upper, color white/yellow/brand, outline 0–12, words-per-screen 1–3, captions toggle
- [x] Title card knobs: enable toggle, top/bottom position, scale 60–130%, subreddit badge toggle, ellipsis truncation past 4 lines
- [x] Server-side sanitizer clamps/enums for every new key; defaults byte-match legacy output
- [x] Disabled layers skip their pipeline stages entirely (no whisper when captions off, no card render/upload)
- [x] Dashboard "Customize look" panel with live 9:16 CSS preview, reset-to-defaults
- [x] Golden ASS tests + sanitizer tests + ffmpeg corner-case render matrix (backend/tests/)
