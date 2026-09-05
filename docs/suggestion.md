# Suggestions — Optimizations, Rate Limits & Product

**Scope:** Performance, cost control, scaling, rate-limit design, and
product/UX improvements. Bugs are in `review.md`; security in `audit.md`. These are
opportunities, ordered roughly by impact-to-effort.

---

## 1. Rate Limits (design proposal)

The platform currently has **quota** (per-day/month render counts) but **no rate
limiting** (requests-per-window) and **no quota at all on clip jobs**. Proposed
layered model:

### Tier 1 — Per-IP HTTP throttle (coarse, blocks floods)
Add `slowapi` (or a Redis token-bucket) middleware. Redis is already running, so
back the limiter with it for multi-worker correctness.

| Route group | Limit (free) | Rationale |
|---|---|---|
| `POST /auth/login` | 5 / min / IP + 20 / hr / account | Stop credential stuffing (audit A4) |
| `POST /auth/register` | 3 / hr / IP | Stop account spam (audit A11) |
| `GET` read endpoints | 120 / min / user | Generous; catches runaway polling |
| `POST /jobs`, `POST /clip-jobs` | 10 / min / user | Burst guard on top of quota |
| Upload init routes | 20 / hr / user | Bound multipart churn |

### Tier 2 — Business quota (cost control)
- **Reels:** already enforced (`FREE_DAILY_LIMIT=3`, `FREE_MONTHLY_LIMIT=30`).
- **Clip jobs (NEW — audit A9):** introduce `FREE_CLIP_DAILY_LIMIT` /
  `FREE_CLIP_MONTHLY_LIMIT` (clip jobs are far more expensive than reels — Whisper
  + LLM tokens + 10 encodes). Enforce as a `Depends(check_clip_quota)` and
  increment on creation, mirroring the reel path but with its own counters.
- **Concurrency cap:** max N in-flight clip jobs per user (e.g. free = 1,
  premium = 3). Reject with 409 if exceeded — protects the shared worker (A10).

### Tier 3 — Spend metering (LLM)
Track tokens/cost per clip job in a column (e.g. `clip_jobs.llm_tokens`,
`llm_cost_cents`). Enforce a monthly per-user spend ceiling and a global
kill-switch env var so a runaway key can be capped instantly. Log provider +
model + tokens per call.

---

## 2. Pipeline / Encoding Optimizations

### 2.1 — Single-pass clip render (biggest CPU win) — ties to review R7
Today each clip is encoded up to 3× (extract → vertical → caption burn). Collapse
to one `ffmpeg` call:
```
ffmpeg -ss <start> -i source.mp4 -t <dur> \
  -filter_complex "[0:v]scale=1080:1920:force_original_aspect_ratio=increase,\
crop=1080:1920,setsar=1,subtitles='subs.ass'[v]" \
  -map "[v]" -map 0:a -c:v libx264 -crf 18 -preset veryfast \
  -c:a aac -b:a 192k -movflags +faststart out.mp4
```
One decode, one encode, original audio preserved, captions burned inline. Roughly
**3× faster and higher quality** per clip. Extract the ASS from the sliced Whisper
words first (with the overlap fix, review R8).

### 2.2 — Transcribe once, reuse everywhere
The clip job already transcribes the full source. The per-clip caption path
re-derives caption words from that same transcript (good). Keep it that way — do
**not** re-run Whisper per clip. Consider persisting the transcript (JSON) to
storage so re-clipping the same source (different settings) skips Whisper entirely.

### 2.3 — Whisper model sizing & device
`whisper_service.py:70` loads the `base` model on CPU. For a content engine whose
whole value is transcript quality driving clip selection, `base` may under-segment.
- Make the model size configurable (`WHISPER_MODEL=base|small|medium`).
- If a GPU is available in deployment, load on CUDA — order-of-magnitude speedup.
- Consider `faster-whisper` (CTranslate2) for ~4× throughput at equal accuracy.

### 2.4 — Parallelize clip renders
With a real worker pool (see §4), fan the 10 clip encodes out as a Celery `chord`
so they run concurrently instead of sequentially. Wall-clock for a job drops from
Σ(clips) to ~max(clip) + overhead.

---

## 3. The Analyser Prompt & Selection Quality

### 3.1 — Return candidates, then rank server-side
Ask the model for ~15 candidates and select the top 10 after server-side dedupe +
diversity enforcement. Gives headroom to drop overlapping/low-quality picks without
ending up short.

### 3.2 — Enforce diversity in code, not just the prompt
The prompt requests spread + ≥4 clip types, but nothing enforces it. Add a
post-processing pass: bucket by `clip_type`, cap per-bucket, and ensure temporal
spread across the video so you don't ship 10 clips from one hot 3-minute stretch.

### 3.3 — Feed structure, get structure (reduce parse failures)
- Use the provider's native JSON/structured-output mode where available (Anthropic
  tool-use / OpenAI `response_format=json_schema`) instead of free-text + regex
  extraction (`_parse_response`). Eliminates a class of parse failures (review R3).
- Include the video duration and a max-clip-count in the schema so the model can't
  return out-of-range timestamps.

### 3.4 — Show *why* in the UI (you already capture it)
`hook`, `reason`, `engagement_score`, and `clip_type` are stored and rendered — this
is a genuine product differentiator. Consider surfacing a transcript snippet for
each clip and a one-tap "regenerate this clip ±5s" trim control.

---

## 4. Scaling & Infrastructure

### 4.1 — De-serialize the worker (ties to audit A10)
Move off `--pool=solo --concurrency=1`. Recommended:
- Dedicated queues: `renders`, `clips`, `maintenance`.
- CPU-bound encode work on a `prefork` pool sized to cores.
- Route clip jobs to their own queue so a big clip job never starves reels.

### 4.2 — Clip lifecycle & storage hygiene (ties to audit A17)
- Add clips to `sweep_orphan_objects` key matching (`/clips/`).
- Add an optional TTL/retention for clips (free = ephemeral like reels, premium =
  retained), with the reaper handling `users/*/clips/*`.
- Emit a storage-usage metric per user for the admin dashboard.

### 4.3 — Observability
- Structured logging with job IDs (partly there via `print`) → move to `logging`
  with correlation IDs.
- Track per-stage timings (transcribe/analyse/encode) to find bottlenecks.
- Surface LLM latency + token counts.

---

## 5. Product / UX

### 5.1 — Clip preview before download
Cards show a thumbnail but no inline playback. Add a lightweight hover/preview
(reels already do this via a low-res `preview.mp4`). Generate a preview rendition
per clip like the reel pipeline does.

### 5.2 — Aspect-ratio & framing choice
Auto-crop to 9:16 can decapitate speakers. Offer: 9:16 (center crop), 9:16 with
face-tracking crop (future), 1:1, and original. Face-aware cropping is the premium
feature that makes clips actually usable for talking-head content.

### 5.3 — Editable clip boundaries
Let users nudge start/end (±seconds) and re-render a single clip. Since the
transcript is cached (§2.2), re-rendering one clip is cheap.

### 5.4 — Batch actions
"Download all," "Download top 5," and a ZIP export. Also a "post to…" hand-off
(schedule/export) is the natural next product step for a "content engine."

### 5.5 — Progress granularity
The `[jobId]` page already shows a nice stage pipeline. Add a per-clip progress
count during the CLIPPING stage (you already track `clip_count`) — e.g. a subtle
"6 / 10 rendered" so users see forward motion on long jobs.

### 5.6 — Timed-dismiss consistency
The clip "dismiss with 5s undo" is a nice touch. Consider the same undo pattern for
reel deletion for consistency, and make the delay a shared constant.

---

## 6. Cost Model Awareness
A single clip job on a 10-minute video costs, roughly: 1 Whisper pass + 1 LLM call
(thousands of input tokens) + 10 encodes. Reels cost 1 TTS + 1 Whisper + 1 encode.
**Clip jobs are the most expensive operation in the product and currently the least
protected** (no quota, no rate limit, single worker). Prioritizing §1 Tier-2 clip
quota and §4.1 worker separation protects both cost and availability.

---

## Recommended Sequencing
1. **Clip quota + concurrency cap** (§1 Tier-2) — closes the cost/DoS hole.
2. **Single-pass clip encode** (§2.1) — 3× throughput, better quality, one change.
3. **Worker queues/pool** (§4.1) — unlocks parallelism and isolates clip load.
4. **HTTP rate limits** (§1 Tier-1) — login/register/create protection.
5. **Structured LLM output + diversity enforcement** (§3) — selection quality.
6. **Clip lifecycle + orphan sweep** (§4.2) — storage hygiene.
7. Product polish (§5) as capacity allows.
