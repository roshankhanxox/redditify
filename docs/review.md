# Code Review — Correctness, Architecture & Quality

**Scope:** Functional correctness, bugs, architectural consistency, and technical
debt. Security-specific findings live in `audit.md`; performance/product ideas in
`suggestion.md`. This file is about "does it work and is it built well."

**Severity legend:** 🔴 Broken / bug · 🟠 Likely to bite · 🟡 Smell / debt · 🟢 Note

---

## Bugs

### 🔴 R1 — `presign_put` is unbound in the image upload path
`routers/backgrounds.py:267` calls `presign_put(bg.source_key, 900, content_type)`
but the module only imports `from services import storage` (line 14). There is no
top-level `presign_put` symbol → **`NameError` at runtime**. Every call to
`POST /backgrounds/image-init` (the meme character/image upload flow) crashes with
a 500 after the DB row is already inserted, leaving a dangling `pending` row.
- **Fix:** `storage.presign_put(...)`. Also verify `complete_image` path
  end-to-end, since this route can never have succeeded as written.

### 🟠 R2 — Clip-analyser chunking path is effectively dead code
`services/clip_analyser.analyse` branches to `_analyse_chunked` only when
`video_duration > 3600`. But uploaded videos are hard-capped at
`MAX_DURATION_SECONDS = 600` (`tasks/backgrounds.py:15`) during background
processing — a clip job can only ever run on a ≤10-minute source. The entire
chunking/overlap/dedupe-across-chunks branch will never execute in production.
- **Fix:** Either raise the source cap for clip-eligible uploads (then the branch
  matters and should be tested), or drop the dead branch to reduce surface. Decide
  intentionally — right now it's untested code implying a capability the product
  doesn't have.

### 🟡 R3 — Broad `except (json.JSONDecodeError, Exception)` swallows all errors
`services/clip_analyser.py:268` catches `Exception`, which makes the explicit
`json.JSONDecodeError` redundant and hides genuine failures (network errors,
auth errors, SDK exceptions) as "parse failed → return []". An empty clip list
then surfaces to the user as the misleading "LLM returned no valid clip windows"
(`tasks/clip.py`).
- **Fix:** Catch `json.JSONDecodeError` for parse issues and let/log provider
  errors distinctly so the job's `error_message` is actionable.

### 🟡 R4 — Inline `__import__` hack for `select`
`tasks/clip.py:127` uses
`__import__("sqlalchemy", fromlist=["select"]).select(Clip)` to fetch a clip row.
`select` is already a normal import elsewhere; this is unreadable and bypasses the
linter.
- **Fix:** `from sqlalchemy import select` at module top and use it. Better: fetch
  the created clip IDs when you insert them (R5) and skip the re-query entirely.

### 🟡 R5 — Clip rows are inserted, then re-queried by `(job_id, index)`
`tasks/clip.py` bulk-inserts all `Clip` rows, then in the render loop re-selects
each one by `job_id + index` to get its `id`. You already hold the objects at
insert time.
- **Fix:** Capture the inserted `Clip` objects (or `flush()` + read `.id`) and
  carry the IDs into the loop. Removes N extra queries and R4's hack.

### 🟡 R6 — `increment_quota`/`check_quota` race for the main job path
`check_quota` reads counts (`services/quota.py:31`) and `increment_quota`
(`quota.py:46`) writes in a separate session **after** job creation
(`routers/jobs.py:322`). Two concurrent requests can both pass the check before
either increments, letting a user exceed the daily limit by their concurrency
factor. Also, if `increment_quota` fails after the job is enqueued, the user got a
free render.
- **Fix:** Increment atomically within the same transaction as the check (or use
  an atomic `UPDATE ... SET count = count + 1 ... RETURNING` with a limit guard).

---

## Correctness / Consistency

### 🟠 R7 — Clips are encoded twice (quality + time cost)
`tasks/clip.py` does: `extract_clip` (re-encode H.264, `video.py:extract_clip`) →
then `transcode_vertical` (re-encode again) → then `_render_clip_composite`
(a third encode to burn captions). That's up to **three** libx264 passes per clip,
ten clips per job. Each pass compounds generation loss and CPU time.
- **Fix:** Collapse into a single `ffmpeg` invocation per clip: one input with
  `-ss/-t`, a filter chain doing scale/crop + subtitles, mapping original audio,
  encoded once. See suggestion.md §Pipeline for the concrete filtergraph.

### 🟡 R8 — Clip caption slicing assumes clean word containment
`tasks/clip.py` builds `clip_words` by keeping Whisper words where
`start >= w.start and end <= w.end`. Words straddling the cut boundary are dropped
entirely, so the first/last spoken word of a clip can be missing from captions.
- **Fix:** Include words that *overlap* the window and clamp their timings to
  `[0, duration]`, rather than requiring full containment.

### 🟡 R9 — `job_to_dict` in clip router builds thumbnail URLs even in list view
`routers/clip_jobs.py:clip_to_dict` calls `presign_get`/`stat` per clip. The list
endpoint (`list_clip_jobs`) passes no clips so it's fine today, but `get_clip_job`
presigns a URL for every clip on every poll (every 3s while processing). At 10
clips that's 10 presign calls × frequent polls.
- **Fix:** Presigning is cheap (no network for SigV4) so low urgency, but consider
  batching or letting the client hit the thumbnail route lazily.

### 🟡 R10 — `pendingClips`/`doneClips`/`failedClips` computed but only one is used
`frontend/app/(app)/dashboard/clips/[jobId]/page.tsx` derives `doneClips` and
`pendingClips` but only `failedClips.length` is rendered. Dead locals.
- **Fix:** Remove unused derivations or use them (e.g. "3 processing…" hint).

### 🟢 R11 — Reel `timeAgo` minutes branch is wrong
Pre-existing: `components/reels/reel-card.tsx:timeAgo` — the `< 3600` branch
divides by 3600 (hours) instead of 60 (minutes), so anything under an hour renders
"0h ago". Not introduced by this work but worth fixing while nearby.

---

## Architecture & Debt

### 🟢 R12 — LLM provider abstraction is clean and correct
`services/llm.py` — the `LLMProvider` ABC with Anthropic/OpenAI/Groq (Groq as an
OpenAI-compatible subclass) is a good seam. Model IDs are configurable. This will
make swapping providers painless.

### 🟢 R13 — Clip pipeline reuses existing infra well
Downloading from MinIO, Whisper, `transcode_vertical`, ASS caption burning, and the
storage adapter are all reused rather than reinvented. The new task mirrors the
`generate_reel` status-machine pattern. Consistent with the codebase.

### 🟡 R14 — Two parallel "media job" systems now exist (`jobs` vs `clip_jobs`)
Reels and clip jobs have separate tables, routers, status vocabularies, list/detail
endpoints, and near-identical download/thumbnail/delete logic. Divergence risk over
time (e.g. R1-style bugs fixed in one but not the other).
- **Consider:** Extract shared helpers (`_get_owned`, presign+serve, ownership
  guards) into a common module. Not urgent, but the duplication is already visible.

### 🟡 R15 — Clip status vocabulary duplicated across BE/FE with no single source
Stage strings (`DOWNLOADING`, `EXTRACTING_AUDIO`, …) are defined in the task,
re-listed in the router's mental model, and hardcoded again in two frontend files
(`clips/page.tsx`, `clips/[jobId]/page.tsx`). Drift will cause missing labels.
- **Consider:** Export a shared constant/enum (backend emits, frontend consumes via
  a generated type or a small shared JSON).

### 🟢 R16 — Migration head conflict was already hit and resolved
`f1a2b3c4d5e6` originally branched from the same parent as `b4c5d6e7f8a9`
(multiple heads). Now re-chained onto `b4c5d6e7f8a9`. Fine — just a reminder that
new migrations must always descend from the current single head.

### 🟢 R17 — `run.sh` worker is `--pool=solo`
Called out in audit.md (A10) as a security/throughput issue; from a *correctness*
angle it also means Celery `chord`/parallel patterns (mentioned in the original
plan) silently degrade to sequential. The implementation is honest sequential code,
so no bug — but the deploy config caps throughput at 1.

---

## Testing Gaps
- No tests exist for the clip pipeline (analyser parsing, timestamp snapping,
  caption slicing, provider selection).
- `_validate_clip` and `_snap_to_word_boundary` are pure functions — ideal unit
  test targets and worth covering before this ships (they guard against LLM
  hallucinated timestamps).
- No integration test exercises `POST /clip-jobs → DONE`.

---

## Quick-Win Fix List (low effort, clear value)
1. R1 `storage.presign_put` — one-line, unblocks image/character uploads.
2. R4/R5 — proper `select` import + reuse inserted rows.
3. R3 — narrow the exception handling.
4. R10/R11 — dead locals + `timeAgo` minutes bug.
5. R8 — overlap-based caption slicing (small change, visible quality win).
