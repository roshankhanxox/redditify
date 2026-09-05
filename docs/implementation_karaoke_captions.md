# Implementation Plan — Animated Karaoke Captions

## Goal

Add the signature short-form caption look: a small group of words on screen with
the **currently-spoken word highlighted** (colour swap + a quick scale "pop"),
moving word-by-word in sync with speech. This is the visual upgrade that makes
output read as natively TikTok/Reels rather than generic burned subtitles.

## Scope & constraints

- **Synced captions only.** Karaoke needs real per-word timings from Whisper.
  Static captions (user-typed, `caption_mode="static"`) go through the Pillow/PNG
  path (`services/caption_png.py`) and fabricate timings via `even_chunks` — out of
  scope. When `caption_mode="static"`, the karaoke toggle is ignored (falls back to
  the existing static render).
- **Reuse the existing burn path.** No new FFmpeg stage. Karaoke is still one `.ass`
  file burned via the `subtitles=` filter, so both the reel single-pass and clip
  single-pass renders stay exactly as they are.
- Applies to **both** pipelines: reels (`tasks/render.py`) and clips
  (`tasks/clip.py`), which already share `whisper_service`.

## Approach decision

ASS supports two ways to do this:

1. **Native `\k` karaoke tags** — one Dialogue line per chunk with inline
   `{\k<centiseconds>}` per word. libass swaps each word from `SecondaryColour` to
   `PrimaryColour` as it's "sung." Cheapest, but the effect is *cumulative fill*
   (once highlighted, a word stays highlighted) and gives no scale animation.

2. **Per-word Dialogue events with override tags** (chosen) — for each visible
   chunk of N words, emit N time-sequential events; event *k* shows the whole chunk
   with word *k* wrapped in a highlight colour + a `\t` scale bump, the rest in the
   base colour. Because the events are contiguous and non-overlapping in time, only
   one shows at a moment, so the highlight *moves* word-to-word and each word can
   "pop." This produces the recognizable modern look and gives us animation control.

We implement **#2** as the primary style. `\k` can be added later as a lighter
"fill" variant if desired.

## ASS technical design

New builder in `services/whisper_service.py`:

```python
def words_to_karaoke_ass(
    words: list[dict],      # [{word, start, end}, ...] already sliced to the segment
    path: str,
    style: dict | None = None,
    chunk_size: int = 2,    # visible words per line (reuses caption_words, 1–3)
    highlight: str = "&H0000E5FF",  # ASS &H00BBGGRR (default = yellow)
) -> str
```

Reuses the **exact header + Style line** from `chunks_to_ass` (same PlayRes
1080×1920, same `Reel` style, so font/outline/position/`margin_v` all inherit from
`caption_style_from_settings` unchanged). Only the `[Events]` generation differs.

Per chunk group `g = words[i:i+chunk_size]` (n words):
- `chunk_end = g[-1].end + 0.1`
- For `k in range(n)`:
  - `ev_start = g[k].start`
  - `ev_end   = g[k+1].start if k < n-1 else chunk_end`
  - guard: if `ev_end <= ev_start`, set `ev_end = ev_start + 0.05`
  - build the line text: for each word `j` in the chunk, prefix an override block
    that **resets colour and scale** so nothing bleeds between words:
    - active (`j == k`):
      `{\c<HL>\fscx115\fscy115\t(0,150,\fscx100\fscy100)}WORD`
      → appears ~15% larger and settles to 100% over 150 ms (the "pop").
    - inactive:
      `{\c<BASE>\fscx100\fscy100}WORD`
  - join words with a single space; uppercase to match current caption styling.

Colour conversion: Style colours are `&H00BBGGRR` (8 hex incl. alpha); inline `\c`
wants `&HBBGGRR&`. Convert with `"&H" + color[-6:] + "&"`. `<BASE>` derives from the
style's `primary`; `<HL>` from the chosen highlight palette entry.

Escaping (speech is user-controlled via uploaded audio — treat as untrusted):
- `{` → `(`, `}` → `)` (ASS override delimiters)
- newlines → space
- (words are short tokens; no length cap needed beyond the existing chunking)

Event-count sanity: ~2–3 words/sec ⇒ a 60 s reel ≈ 120–180 events; a 45 s clip
similar. libass handles thousands of events fine.

## Backend changes

| File | Change |
|------|--------|
| `services/whisper_service.py` | Add `words_to_karaoke_ass()` (above). Add `CAPTION_HIGHLIGHT_COLORS` map (reuse the `CAPTION_COLOR_PRIMARY` values: white/yellow/brand). |
| `tasks/render.py` | In the **synced** caption branch, if `cfg["caption_animation"] == "karaoke"`, call `words_to_karaoke_ass(words, srt_path, style, chunk_size, highlight)` instead of `words_to_chunks` + `chunks_to_ass`. `words` is already available from `transcribe()`. |
| `tasks/clip.py` | In the caption section (already builds `clip_words` sliced+offset to the clip window), branch the same way: karaoke → `words_to_karaoke_ass(clip_words, ...)`, else current `words_to_chunks`+`chunks_to_ass`. Thread `caption_animation` + `caption_highlight_color` into `caption_style_cfg`. |

Note: `tasks/clip.py` already offsets word timings to the clip start (single-pass
input-seek timeline), so the sliced `clip_words` feed straight into the karaoke
builder with no extra work.

## Settings / schema changes

Two new fields, defaulting to today's behaviour:

- `caption_animation`: `"none" | "karaoke"` (default `"none"`)
- `caption_highlight_color`: `"white" | "yellow" | "brand"` (default `"yellow"`)

| File | Change |
|------|--------|
| `routers/jobs.py` `_sanitize_settings` | Whitelist both fields (enum-validate; anything else → default). |
| `routers/clip_jobs.py` `_sanitize_clip_settings` | Same two fields, so clip jobs can opt in. |
| `frontend/lib/types.ts` | Add both to `RenderSettings` + `DEFAULT_RENDER_SETTINGS`; add a `CaptionAnimation` type. |

## Frontend UI

| File | Change |
|------|--------|
| `components/create/customize-panel.tsx` (and/or the wizard "Look" step) | Add a **Caption style** control — `Standard` / `Karaoke (word-by-word)` — shown only when `captions_enabled && caption_mode === "synced"`. When `karaoke`, reveal a **Highlight colour** select (white/yellow/brand). |
| `components/clips/new-clip-job-dialog.tsx` | The dialog currently exposes only a captions on/off toggle. Add the same "Karaoke" toggle + highlight colour (compact) so clip jobs can use it. |
| `components/create/phone-preview.tsx` | Cheap static approximation: render the sample caption chunk with the middle word in the highlight colour and slightly enlarged (optional CSS pulse). Full per-word animation in the browser is out of scope — the preview just communicates the style. |

Gating rule everywhere: karaoke only offered for synced captions; if the user has
static selected, hide/disable the option.

## Edge cases & risks

- **Contiguous non-overlapping events** are essential — if two events overlap in
  time libass stacks them. The `ev_end = next.start` construction guarantees this;
  the `ev_end <= ev_start` guard covers zero-length/again-stamped words.
- **Scale-pop layout shift**: scaling one word nudges neighbours slightly (anchor is
  the line, alignment 2). This is the expected "bounce" and is acceptable; if it
  reads as jitter, drop the `\t` and keep colour-only highlight.
- **Big inter-word gaps**: last word of a chunk holds highlight until `chunk_end`;
  between chunks nothing shows (matches current chunk behaviour).
- **Non-English / disfluencies**: Whisper `base` word timings can be loose. Karaoke
  exposes timing errors more than block captions — a future `WHISPER_MODEL` bump
  (already noted in suggestion.md §2.3) or `faster-whisper` improves this.
- **Static mode**: explicitly unsupported; ensure the toggle can't be set alongside
  static (server also ignores it defensively).

## Testing

- **Unit** (`words_to_karaoke_ass`): valid ASS header; event count equals word count
  within chunks; strictly increasing, non-overlapping `Start/End`; brace/newline
  escaping; correct base vs highlight colour tags on the active index.
- **Integration**: reuse the synthetic-source ffmpeg test from the single-pass work
  — build a karaoke `.ass` from fake words and confirm `render_clip(..., subs=...)`
  burns it without error and output duration/resolution are correct.
- **Visual QA**: one real reel + one real clip, eyeball sync and the pop.

## Rollout checkpoints (commit at each)

1. `services/whisper_service.py` builder + unit tests.
2. Settings plumbing — backend sanitizers + `types.ts` defaults.
3. Pipeline wiring — `tasks/render.py` and `tasks/clip.py` branches.
4. Frontend controls + gating + preview approximation.
5. Integration render test + visual QA, then PR.

## Out of scope (future)

- Native `\k` "fill sweep" as a second karaoke variant.
- Per-word emoji/color (libass can't do colour emoji — would need the PNG path).
- Word-level manual timing correction in the UI.
