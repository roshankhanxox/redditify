# Feature Plan: Render Customizations (Captions, Title Card, Output)

Status: Implemented on `feature/expressiveness-render-customizations` (combined with the TTS expressiveness knob)
Branch: `feature/expressiveness-render-customizations`
Scope: backend (`services/whisper_service.py`, `services/title_card.py`, `tasks/render.py`, `routers/jobs.py`), frontend dashboard
Depends on: nothing — builds directly on the merged S3/retention work

---

## 1. Summary

Give users visual control over the two burned-in layers of a reel — the
word-synced captions and the title card — plus small output conveniences.
Today every knob is hardcoded:

| Knob | Where it lives now | Current value |
|---|---|---|
| Caption font size | `chunks_to_ass()` Style line | 96 px |
| Caption vertical position | MarginV in same line | 680 |
| Caption font / outline / shadow / colors | ASS style string | Arial, white fill, black outline 6, shadow 3 |
| Caption words per screen | `words_to_chunks(chunk_size=2)` | 2 words |
| Title card visibility & position | `render_video()` overlay filter | always shown, top-center at y=80 |
| Title card style | `title_style` setting | dark / light / minimal |
| Subreddit badge on card | `title_card.render()` | always drawn |

The customization feature exposes these as per-job settings with sane
defaults (identical output to today when untouched), validated server-side,
and previewed live in the dashboard before spending quota.

## 2. Settings Schema (additive to `Job.settings`)

```jsonc
{
  // Captions
  "caption_font_size":   96,          // int, clamp 48–140
  "caption_position":    "lower",     // lower | center | upper  -> MarginV 680 / 860 / 1180
  "caption_color":       "white",     // white | yellow | brand  -> PrimaryColour
  "caption_outline":     6,           // int, clamp 0–12 (0 = clean flat text)
  "caption_words":       2,           // 1 | 2 | 3 words per caption chunk
  "captions_enabled":    true         // false = no burned captions at all
}
```

```jsonc
{
  // Title card
  "title_enabled":       true,        // false = skip card + overlay entirely
  "title_position":      "top",       // top | bottom -> overlay y=80 or y=1500
  "title_scale":         100,         // % width of frame, clamp 60–130
  // title_style already exists (dark | light | minimal)
}
```

Sanitization follows the established `_sanitize_settings` pattern: unknown
values fall back to defaults; numeric clamps applied server-side. The client
can never inject strings that reach libass or PIL.

## 3. Backend Changes

### 3.1 `whisper_service.py`

- `words_to_chunks(words, chunk_size=2)` — already parameterized; pipeline
  passes `cfg.get("caption_words", 2)`.
- `chunks_to_ass(chunks, path, style=None)` — accept an optional style dict
  and template the Style line from it:

```python
DEFAULT_CAPTION_STYLE = {
    "fontname": "Arial", "fontsize": 96,
    "primary": "&H00FFFFFF", "outline_colour": "&H00000000",
    "outline": 6, "shadow": 3, "alignment": 2, "margin_v": 680,
}
```

Position mapping (PlayRes 1080x1920): `lower=680`, `center=860`,
`upper=1180`. Colors map to ASS `&H00BBGGRR`: white, yellow `&H0000E5FF`
(ffmpeg gold), brand orange `&H002A45FF`.

### 3.2 `title_card.py`

- `render(..., scale_pct=100, show_badge=True)`:
  - Scale canvas `W = int(1000 * scale_pct / 100)`, fonts scale linearly.
  - `show_badge=False` skips the subreddit row and shifts the title block up.
  - Keep 4-line wrap cap; longer titles truncate with an ellipsis instead of
    overflowing.

### 3.3 `tasks/render.py`

- Skip `RENDERING_TITLE_CARD` stage entirely when `title_enabled=false`
  (also skip its scratch artifact upload).
- Pass card position/scale into `video.render_video(..., card_pos="top",
  card_scale=1.0)`; the overlay filter becomes
  `overlay=(W-w)/2:{y}:enable=...` with `y = 80` (top) or `H-h-120` (bottom).
- Skip subtitle burn when `captions_enabled=false` (filter chain drops the
  `subtitles=` node).

### 3.4 `routers/jobs.py`

Extend `_sanitize_settings` with every new key (clamps listed in section 2).
No schema migration needed — settings live in the existing JSONB column.

## 4. Frontend Changes (dashboard)

Replace the flat "Title Card Style" radio group with a collapsible
**"Customize look"** panel so the default path stays fast:

1. **Live preview strip** — pure client-side mock (HTML/CSS replica of a
   9:16 frame) bound to the same state object sent as settings. Shows caption
   chunk ("so I quit my job") styled with chosen size/color/position and the
   title card rendered as a styled div. No server round-trip, updates instantly.
2. **Caption controls**: size slider (48–140), position segmented control
   (Lower / Center / Upper), color swatches (white/yellow/orange), outline
   slider (0–12), words-per-screen segmented control (1/2/3), captions toggle.
3. **Title controls**: enable toggle, position toggle (Top/Bottom), scale
   slider (60–130%), style radios (existing dark/light/minimal), badge toggle.
4. **Reset to defaults** button restoring today's hardcoded values exactly.

`lib/types.ts` gains a `RenderSettings` interface shared by the panel and the
generate payload.

## 5. Non-Goals (this pass)

- Custom font upload (licensing + libass fontconfig wiring) — later.
- Per-word karaoke highlight animation (`\k` tags) — separate feature, big UX win.
- Emoji rendering in captions (libass emoji fallback is unreliable).
- Saving presets across jobs (candidate follow-up: `user_presets` table).

## 6. Implementation Phases

| Phase | Deliverables | Effort |
|---|---|---|
| C1 — Caption knobs | style dict threading through whisper_service + render.py, sanitizer clamps | 0.5 d |
| C2 — Title knobs | title_card scale/badge, render_video position/scale, skip-stage logic for disabled layers | 0.5 d |
| C3 — Dashboard panel | customize panel + live CSS preview, types, payload wiring | 1 d |
| C4 — Verification | golden-file ASS tests (style string snapshot), manual render matrix (positions x sizes), play.sh parity check | 0.5 d |

## 7. Test Plan

- Sanitizer: out-of-range ints clamped, bogus enums fall back, injection
  attempts (`fontname: "Arial,Comic"` etc.) never reach ASS/PIL.
- Golden test: `chunks_to_ass` output byte-compares against fixture for each
  position/color preset.
- Render matrix: one short synthetic job per extreme corner (min/max font,
  top/bottom card, captions off, card off) renders without ffmpeg errors and
  produces expected duration.
- UI: preview matches final render within tolerance at all three positions;
  defaults reproduce current output bit-for-bit.

## 8. Open Questions

1. Should caption position also support free-form MarginV (advanced mode)?
2. Brand-orange caption color — keep after rebrand discussions?
3. Persist last-used customizations per user automatically (vs explicit presets)?
