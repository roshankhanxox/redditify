# PROGRESS.md

> Agent: read this before doing anything. Find the first unchecked box. That is your next task.

Last updated: 2026-08-22

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
- [ ] run_ffmpeg() helper captures stderr, raises RuntimeError with full output on failure
- [ ] get_duration() via ffprobe
- [ ] render_video() with filter_complex: scale + overlay + subtitles
- [ ] Title card overlaid at top-center (80px from top)
- [ ] Subtitles positioned at midsection (MarginV=680, Alignment=2)
- [ ] Gameplay looped via -stream_loop -1 to match audio duration
- [ ] Output: 1080x1920, 60fps, libx264 CRF 18, AAC 192k, faststart
- [ ] Pillow title card render: dark/light/minimal styles
- [ ] Reddit orange (#FF4500) subreddit label on title card
- [ ] Title word-wrapped at 34 chars, max 4 lines
- [ ] Inter font files present in backend/fonts/
- [ ] feature/ffmpeg-pipeline merged to main

### Asset Manager Service (branch: feature/asset-service)
- [ ] pick_clip() queries DB for enabled clips by category, returns random path
- [ ] upload clip endpoint: accepts multipart, validates vertical resolution, min 30s
- [ ] Auto-transcode to 1080x1920 if needed (subprocess FFmpeg call)
- [ ] Asset DB record created after successful upload
- [ ] feature/asset-service merged to main

### Celery Jobs (branch: feature/celery-jobs)
- [ ] Celery app initialized with Redis broker and backend
- [ ] generate_reel task: all 8 steps in correct order
- [ ] set_status() helper updates job.status in DB within its own session
- [ ] Job cleanup: tmp directory removed in finally block
- [ ] max_retries=2, retry delay 30s
- [ ] Duplicate detection: if job for same post_id already QUEUED or PROCESSING, return existing job_id
- [ ] feature/celery-jobs merged to main

### Quota System (branch: feature/quota-system)
- [ ] check_quota() FastAPI dependency reads QuotaUsage from DB
- [ ] Admin role bypasses quota (role == "admin" early return)
- [ ] Returns HTTP 429 with descriptive message when daily or monthly limit exceeded
- [ ] increment_quota() called on successful job creation
- [ ] GET /quota/me returns daily_used, daily_limit, monthly_used, monthly_limit
- [ ] feature/quota-system merged to main

### REST API Layer (branch: feature/rest-api)
- [ ] FastAPI app with lifespan context manager (not deprecated on_event)
- [ ] JWT decode dependency (get_current_user)
- [ ] Admin role dependency (require_admin)
- [ ] POST /jobs (with check_quota dependency)
- [ ] GET /jobs/{job_id}
- [ ] GET /jobs (paginated, current user only)
- [ ] DELETE /jobs/{job_id}
- [ ] GET /assets (enabled clips, categories)
- [ ] POST /admin/assets
- [ ] PATCH /admin/assets/{id}
- [ ] DELETE /admin/assets/{id} (blocks on last enabled clip)
- [ ] GET /admin/users (paginated)
- [ ] PATCH /admin/users/{id}
- [ ] GET /admin/jobs (paginated)
- [ ] CORS configured for http://localhost:3000
- [ ] v0.1.0 tag created after this merge
- [ ] feature/rest-api merged to main

---

## Phase 3 — Frontend

### Frontend Setup (branch: feature/frontend-setup)
- [ ] Next.js scaffolded with npx create-next-app@latest (no pinned version), TypeScript, Tailwind, App Router
- [ ] shadcn/ui initialized (dark theme)
- [ ] shadcn components installed: button, input, card, badge, table, dialog, progress, sonner (toasts), select, slider, separator, avatar, dropdown-menu, skeleton, switch, tabs, radio-group, pagination
- [ ] NextAuth.js v5 installed and configured (credentials provider)
- [ ] next-auth session type extended with id, email, role fields
- [ ] Prisma schema for NextAuth adapter tables
- [ ] axios instance created in lib/api.ts with base URL and auth header injection
- [ ] SWR installed
- [ ] Next.js middleware for protected routes
- [ ] feature/frontend-setup merged to main

### Landing Page (branch: feature/landing-page)
- [ ] Navbar with logo, Sign In, Get Started buttons
- [ ] Hero section: headline, subheading, two CTAs (no background image, dark minimal)
- [ ] How It Works: three shadcn Cards (Search / Pick / Download)
- [ ] Features: 2x3 grid of feature cards
- [ ] Pricing: two cards (Free / Admin)
- [ ] Footer
- [ ] Fully responsive (mobile stacks)
- [ ] No auth required to view
- [ ] feature/landing-page merged to main

### Auth Pages (branch: feature/auth)
- [ ] /sign-in page: centered shadcn Card, email + password, validation errors inline
- [ ] /sign-up page: same layout, creates user on submit via POST to backend /auth/register
- [ ] /change-password page: shown when must_change_password is true
- [ ] Redirect to /dashboard on successful sign-in
- [ ] must_change_password enforced in middleware (redirect to /change-password)
- [ ] feature/auth merged to main

### Dashboard (branch: feature/dashboard)
- [ ] Protected route (middleware redirects if no session)
- [ ] Two-column layout (search left, settings right), stacks on mobile
- [ ] Search input + sort Select + subreddit input
- [ ] Search calls GET /reddit/search, shows Skeleton while loading
- [ ] PostCard component: title clamp, subreddit badge, score, comments, word count, Select button
- [ ] Selecting a PostCard highlights it and opens settings panel
- [ ] Settings panel: Voice Select, Title Style RadioGroup, Gameplay Select, Duration Slider
- [ ] QuotaBadge: fetches GET /quota/me, shows "X videos left today"
- [ ] Generate button calls POST /jobs, disables during request
- [ ] 429 response shown as toast (shadcn Sonner)
- [ ] JobStatusTracker: Progress bar + status label, polls every 2s via SWR
- [ ] Polling stops on DONE or FAILED
- [ ] Download button on DONE
- [ ] Error message + retry on FAILED
- [ ] feature/dashboard merged to main

### Job History (branch: feature/job-history)
- [ ] Protected route
- [ ] shadcn Table: Post Title, Subreddit, Status badge, Duration, Created, Actions
- [ ] Status badges colour-coded: muted/blue/green/red
- [ ] Download action for DONE jobs
- [ ] Delete action with confirmation Dialog
- [ ] Pagination with shadcn Pagination
- [ ] Empty state with CTA link to /dashboard
- [ ] feature/job-history merged to main

### Admin Panel (branch: feature/admin-panel)
- [ ] Protected + role check (redirect non-admins to /dashboard)
- [ ] shadcn Tabs: Overview / Users / Assets / Jobs
- [ ] Overview: stat cards (total jobs, today's jobs, total users, storage)
- [ ] Users tab: table with role badge, Edit Dialog to change role
- [ ] Assets tab: clip list with category badge, duration, enabled Switch, delete button; upload Dialog
- [ ] Jobs tab: all jobs table with user email column
- [ ] feature/admin-panel merged to main

---

## Phase 4 — Integration & Polish

### Integration (branch: feature/integration)
- [ ] End-to-end flow tested: sign up → search → select → generate → download
- [ ] ElevenLabs quota exhaustion → edge-tts fallback verified
- [ ] Free user quota enforcement tested (3rd video works, 4th returns 429)
- [ ] Admin user has no quota restrictions verified
- [ ] must_change_password redirect flow tested for admin@reelbot.local
- [ ] FFmpeg failure stored in error_message and displayed in UI
- [ ] feature/integration merged to main

### Documentation (branch: feature/docs)
- [ ] README.md complete: prerequisites, setup, Reddit API setup guide, seed.py instructions, how to add gameplay clips, docker-compose run instructions
- [ ] Mermaid diagrams in README: architecture, video generation pipeline, ER diagram
- [ ] .env.example files for both backend and frontend
- [ ] PROGRESS.md all checkboxes verified accurate
- [ ] v1.0.0 tag created
- [ ] feature/docs merged to main
