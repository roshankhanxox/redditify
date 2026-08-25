# Plan: Dashboard V2 — Platform Shell, Typography Overhaul & Reel Templates

Status: Draft — not started
Scope: frontend (full app shell + all authed pages), backend (stats, thumbnails, templates)
Depends on: nothing — builds directly on merged PR #3 (render customizations + voice catalog)

---

## 1. Summary

ReelBot today is a one-purpose tool wearing a two-link navbar. This plan turns it
into a proper product platform:

1. **A real app shell** — collapsible sidebar (Home / Create / My Reels /
   Library / Admin) replacing the top navbar inside the authed area.
2. **A typography overhaul** — the whole platform currently reads small
   (`text-xs`/`text-sm` everywhere). We adopt an explicit type scale with hard
   size floors and a dedicated display face for headings. No more squinting.
3. **An advanced-SaaS visual language** — flat surfaces, 1px borders,
   generous spacing, restrained motion, brand-orange used only as accent.
   Explicitly: no decorative gradients, no glassmorphism, no glow.
4. **New surface area** — Home hub with stats + recent reels, a multi-step
   Create wizard with template picker, upgraded My Reels, and a Library page
   for uploaded footage/images.
5. **Two new reel templates** (backend): a **Meme Studio** flow — pick a
   curated *scene* (rainbow gradient, cozy library, classroom… each shown as
   a truthfully-rendered thumbnail), upload any character image and get an
   automatic background removal, then arrange characters *and* draggable
   text boxes (font/color/size selectable) on a live phone-frame preview;
   plus a **Custom Image** template (upload → auto-crop 1080×1920 full-bleed
   → captions/TTS). Pitched-up "child" TTS included.

Everything ships in independently mergeable phases, each with its own test
gate. Every phase leaves `main` green.

## 2. Design principles (the "SaaS look" contract)

These are binding for every phase. When in doubt, flatter and quieter wins.

| Rule | Detail |
|---|---|
| Flat surfaces | `bg-card` + `border` (1px). Elevation via border contrast, not shadow stacking. Max one soft shadow (`shadow-sm`) on floating elements (popovers, sheets) |
| No decorative gradients | Zero gradient fills in app chrome. Gradients exist *only* as reel content (the meme template) |
| One accent | Brand orange `--brand` for primary actions, active states, selection. Everything else stays neutral |
| Spacing generosity | Page padding `p-6/8`, card gaps `gap-6`, internal card padding `p-6`. Density comes from hierarchy, not cramming |
| Motion restraint | 150–200ms `ease-out` transitions on hover/focus/state only. No springs, no bounces, no parallax in the app shell |
| Radius discipline | Keep the existing token scale (`--radius: 0.625rem`). Cards `rounded-xl`, controls `rounded-md`, pills `rounded-full` |
| Dark-first | The app is dark-only today; keep it. (Light theme = stretch goal, Phase 0.5, only if tokens prove clean) |

## 3. Typography system

### 3.1 Families

| Role | Family | Why |
|---|---|---|
| Display / headings | **Bricolage Grotesque** (Google Fonts, variable) | Characterful without being loud; reads "modern SaaS with taste". Fallback candidate if it feels too editorial: Space Grotesk |
| UI / body | **Geist Sans** (already wired) | Best-in-class UI legibility; problem was never the family, it was sizes |
| Mono / numbers | **Geist Mono** (already wired) | Durations, quotas, timestamps — always `tabular-nums` |

Wire via `next/font/google` in `app/layout.tsx` → `--font-display`; point the
existing unused `--font-heading` theme token at it. Zero layout shift
(`next/font` self-hosts; no FOUT).

### 3.2 Type scale (hard floors — this kills the "small text look")

| Token | Classes | Usage |
|---|---|---|
| Page title | `text-3xl font-semibold tracking-tight` (display) | One per page, sidebar-titled |
| Page subtitle | `text-base text-muted-foreground` | Under page title |
| Section title | `text-lg font-semibold tracking-tight` (display) | Card headers |
| Item title | `text-base font-medium` | Job titles, asset names |
| Body | `text-base` | Story editor, descriptions, empty-state copy |
| Secondary | `text-sm text-muted-foreground` | Supporting copy, metadata rows |
| Label | `text-sm font-medium` | Form labels (was mixed xs/sm) |
| Meta floor | `text-[13px]` | Timestamps, counters, helper hints |
| Badge/kbd only | `text-xs` | Badges, kbd, tiny status chips — never paragraphs, never labels |

**Hard rules:**
- Nothing below 13px anywhere. `text-xs` is banned outside badges/kbd.
- Interactive elements (buttons, links, menu items) minimum `text-sm`.
- Buttons: default size renders `text-sm font-medium h-9 px-4`; `lg` variant
  `text-base h-11`.
- All numerals in stats/durations use `tabular-nums`.

### 3.3 Sweep

One mechanical pass (codemod-style, reviewed by eye) across all existing pages
re-mapping: `text-xs → text-[13px]` (meta) or `text-sm` (labels),
body `text-sm → text-base`, card titles up one step. Landing page gets the
display-face headings too so marketing ↔ app feels like one product.

## 4. Component inventory (shadcn — install once, use everywhere)

Present: avatar, badge, button, card, dialog, dropdown-menu, input, label,
pagination, progress, radio-group, scroll-area, select, separator, skeleton,
slider, sonner, switch, table, tabs, textarea.

To add via `npx shadcn@latest add …` (Phase 0):

| Component | Used by |
|---|---|
| `sidebar` | Phase 1 app shell (the whole point) |
| `sheet` | Mobile nav + reel detail drawer |
| `alert-dialog` | Delete confirmations (jobs, assets) — replaces plain Dialog confirm |
| `tooltip` | Collapsed-rail sidebar icons, icon buttons |
| `breadcrumb` | Wizard steps context (Create › Rainbow Meme › Voice) |
| `empty` | Home/Reels/Library zero-states |
| `field` | Wizard form layouts (label + control + description + error) |
| `spinner` | Async buttons, loading grids |
| `item` | Template picker cards, list rows |
| `command` | Stretch: ⌘K palette (Phase 4+) |

Already in deps and ready: `react-hook-form`, `zod` (wizard validation),
`next-themes` (only if light mode happens), `lucide-react`, `swr`.

> ⚠️ **Next.js 16 notice:** this repo runs Next 16.3.2 with the new `proxy.ts`
> (not `middleware.ts`) convention. Per `frontend/AGENTS.md`, before writing
> any routing/layout code, read the relevant guides in
> `node_modules/next/dist/docs/` (route groups, redirects, proxy matcher
> semantics) and verify against current conventions — do not trust memorized
> Next.js patterns.

## 5. Information architecture

```
/                        landing (public, restyled headings only)
/sign-in /sign-up        public
/change-password         public (gated)
── app shell (sidebar) ──────────────────────────
/dashboard               Home hub: stats, recent reels, quick create CTA
/dashboard/create        Template picker (Story · Rainbow Meme · Custom Image)
/dashboard/create/[tpl]  Multi-step wizard (Content → Voice → Look → Review)
/dashboard/reels         My Reels: grid, filters, detail drawer, delete
/dashboard/library       Uploaded footage + images (grid, upload, delete)
/admin                   Existing admin panel, same shell, role-gated nav item

Redirects: /jobs → /dashboard/reels (bookmarks don't break)
Auth: proxy.ts PROTECTED list updated to "/dashboard/:path*" + "/admin/:path*"
```

Backend additions stay minimal and additive:

- `GET /stats/me` — total reels, total minutes rendered, quota snapshot (Home strip)
- Thumbnail frame extracted at end of render → deterministic key
  `users/{uid}/thumbs/{job_id}.jpg` (no DB migration; existence derived from DONE)
- `settings.template` in `_sanitize_settings` (`story` default) → render dispatch
- `settings.tts_pitch` (semitones, −12…+12) applied **after** Whisper so subs stay synced
- `GET /scenes` — curated scene registry with truthfully-rendered preview thumbnails
- `GET /fonts` — OFL font registry (same TTFs served to browser + used by Pillow renderer)
- Asset kinds in the backgrounds router: `video | image | character`
- Layer settings: `characters[]` / `text_overlays[]` with normalized
  center-anchored `{x, y, scale, flip}` (+ font/color/align for text),
  clamped server-side; compositing order scene → characters → text → captions

## 6. Phases

Ordering logic: foundations before surfaces (so nothing gets built twice),
shell before pages (pages land inside it), backend-heavy templates last.
Each phase = one branch + PR + test gate + merge.

---

### Phase 0 — Foundations: tokens, typography, component inventory
**Effort:** ~1 day · **Touches:** `globals.css`, `layout.tsx`, all existing pages (type sweep), `components/ui/*`

Deliverables:
1. Add Bricolage Grotesque via `next/font`; wire `--font-display` +
   `--font-heading` theme token; verify self-hosting (no network requests to
   Google in build output).
2. Encode §3.2 scale as Tailwind utilities only (no new abstraction layer);
   document the scale in a comment block at the top of `globals.css`.
3. Install the §4 component list via shadcn CLI; commit generated files.
4. Type-scale sweep across dashboard, jobs, admin, sign-in/up, change-password,
   landing (headings only). Button default sizing per §3.2.
5. Global focus-visible ring audit (`ring-ring/50`, offset 2) — keyboard nav
   must be obvious at the new sizes.

Test plan:
- `tsc --noEmit` + `eslint` + `next build` clean.
- Manual checklist: every page eyeballed at 1440×900 and 390×844; grep gate:
  `rg "text-xs" frontend/app frontend/components` returns badge/kbd usages only.
- No functional change: generate one reel end-to-end locally (`./run.sh`),
  confirm identical pipeline behavior.

Merge gate: green build + checklist ticked.

---

### Phase 1 — App shell: sidebar + route restructure
**Effort:** ~1–1.5 days · **Touches:** new `components/app-shell.tsx`, route group `(app)`, `proxy.ts`, `app-nav.tsx` retirement

Deliverables:
1. shadcn `Sidebar` (collapsible to icon rail, state persisted to cookie per
   shadcn convention). Sections:
   - **Create** group: Home, Create
   - **Workspace** group: My Reels, Library
   - **Admin** group (role-gated): Admin
   - Footer: user avatar + email + sign-out (dropdown-menu)
2. Route restructure into a `(app)` route group sharing the shell layout;
   move `app/jobs/page.tsx` → `app/dashboard/reels/page.tsx`; `/dashboard`
   becomes the Home hub (placeholder content until Phase 2).
3. Redirects: `/jobs/*` → `/dashboard/reels` (config-level `redirects()` or
   proxy-level, whichever Next 16 docs recommend — verify first).
4. `proxy.ts`: update `PROTECTED` + matcher to cover all `/dashboard/:path*`;
   admin role-gate unchanged. Remove `AppNav` from all authed pages; mobile
   gets the sidebar-in-`Sheet` pattern from shadcn docs.
5. Active-route highlighting via `usePathname` with segment matching
   (`/dashboard/create/x` highlights Create).

Test plan:
- Nav matrix manual test: every link deep-linked signed-out → redirected to
  sign-in with `callbackUrl`, lands correctly after auth.
- `/jobs` and `/jobs/<id>` bookmarks redirect correctly.
- Admin sees Admin item, regular user doesn't; `/admin` still 403-redirects.
- Sidebar collapse state survives reload; mobile sheet opens/closes cleanly.
- `tsc`/`eslint`/`build` green.

---

### Phase 2 — Home hub + thumbnails + stats
**Effort:** ~1.5 days · **Touches:** `tasks/render.py`, `services/video.py`, `routers/jobs.py` (+new `routers/stats.py`), `dashboard/page.tsx` rebuild

Deliverables:
1. **Thumbnails (backend):** after `set_status("DONE")` in `render.py`,
   extract poster frame at t=1s: `ffmpeg -ss 1 -i output.mp4 -frames:v 1`
   scaled to 270×480 JPG → `storage.upload(..., users/{uid}/thumbs/{job_id}.jpg)`.
   Failure-to-thumbnail must never fail the job (try/except + log).
2. `job_to_dict` gains `thumbnail_url`: S3 mode → presigned GET (300s TTL);
   local mode → new authenticated route `GET /jobs/{id}/thumbnail`
   (ownership-checked `FileResponse`). SWR fetches lazily; broken thumb →
   neutral film-strip skeleton fallback.
3. **`GET /stats/me`:** `{ total_reels, total_seconds, daily_used, daily_limit,
   monthly_used, monthly_limit, unlimited }` — two cheap SQL aggregates over
   jobs + quota_usage. Frontend hook `useStats()`.
4. **Home page rebuild:** greeting header (time-of-day aware), stat strip
   (4 cards: Quota left today w/ Progress ring, Monthly usage, Total reels,
   Minutes rendered — mono/tabular), Recent reels horizontal grid (thumb +
   status badge + duration + relative time, click → reels page detail),
   persistent "New reel" CTA card. `Empty` component when zero jobs.
5. Loading states via `Skeleton`; polling only while any recent job is
   non-terminal.

Test plan:
- Backend: pytest — thumbnail extraction unit test (synthetic mp4 → JPG
  exists, correct dimensions); `job_to_dict` shape test; `/stats/me`
  ownership + math test (seeded fixtures).
- Render a real job: thumb appears in storage and in Home grid.
- Ephemeral retention reap also removes the thumbnail (extend
  `maintenance.reap_expired_reels` — same key prefix) + regression test.
- Frontend: loading/loaded/empty states eyeballed; `tsc`/build green.

---

### Phase 3 — Create wizard + template picker
**Effort:** ~2 days · **Touches:** new `dashboard/create/page.tsx`, `dashboard/create/[template]/page.tsx`, `lib/wizard-schema.ts`, extract shared bits from current dashboard form

Deliverables:
1. **Template picker** (`/dashboard/create`): three large `Item` cards —
   "Story Reel" (live), "Meme Studio" (Phases 6–7), "Custom Image"
   (Phase 8) —
   each with mini illustrative preview (pure CSS, no images), one-line
   description, "Coming soon" badge + disabled state for unshipped ones.
2. **Wizard** (`[template]/page.tsx`): 4 steps, custom stepper header
   (numbered circles + connector lines, breadcrumb above):
   - **Step 1 · Content** — title, subreddit label, story textarea, word
     count + max-duration selector (existing DURATIONS).
   - **Step 2 · Voice** — provider radio, grouped voice select (searchable —
     20 voices now), speed slider, expressiveness segmented.
   - **Step 3 · Look** — CustomizePanel (existing) + background source
     (library/user picker, moved here) + retention choice.
   - **Step 4 · Review** — sticky right pane: phone-frame live preview
     (extracted from current customize-panel CSS mock, always visible from
     Step 2 onward), settings summary list, quota reminder, submit.
3. Validation: zod schema per step (`wizard-schema.ts`), RHF per-step forms,
   Next/Back preserve values; can't advance with invalid step; toast on
   blocked advance.
4. Draft persistence: full wizard state → `localStorage` keyed by template;
   restored on return with "Draft restored" toast; cleared on submit.
5. Submission identical payload to today (`POST /jobs` settings superset) →
   redirect to `/dashboard/reels?highlight={jobId}` with progress drawer
   auto-opened (Phase 4 dependency noted; interim: toast + link).

Test plan:
- Unit: zod schemas (min lengths, word caps, enum whitelists mirror server
  `_sanitize_settings` — shared constants documented).
- Integration walkthrough manual: happy path ×3 templates (disabled ones
  excluded), back-nav preserves state, refresh restores draft, quota-error
  path surfaces server `detail` verbatim.
- Payload parity test: submitted settings JSON deep-equals legacy form output
  for story template defaults (snapshot fixture).
- `tsc`/eslint/build green; keyboard-only run-through of all 4 steps.

---

### Phase 4 — My Reels upgrades
**Effort:** ~1.5 days · **Touches:** `dashboard/reels/page.tsx`, `routers/jobs.py` (search param), new `components/reel-detail-sheet.tsx`

Deliverables:
1. Layout: filter row (status Tabs: All/Processing/Done/Failed, client-side)
   + view toggle (Grid ▸ default with thumbnails / List ▸ compact table).
   Server pagination kept; page-size select.
2. Cards: thumbnail (16:9-cropped object-cover from 9:16), title, status
   badge, duration, relative created time, expiry countdown badge (reuse
   `ExpiryBadge`), overflow menu (Download / Regenerate / Delete).
3. Detail `Sheet`: inline `<video>` player (local: authenticated streaming
   route — extend download route with `inline=1` returning `FileResponse`
   without attachment disposition, same ownership check; S3: presigned GET
   without filename-forcing), settings summary, created/expiry metadata,
   actions row.
4. Delete → `AlertDialog` confirm (typed job title to confirm? No — friction;
   simple confirm with destructive button, focus trapped).
5. Regenerate: navigates to wizard with `?from={jobId}` → pre-fills every
   step from `job.settings` (round-trips through the same zod schemas).
6. Optional stretch: `command` ⌘K palette for jump-to-reel.

Test plan:
- Grid/list/filter/pagination matrix manual test incl. empty + failed states.
- Player plays in Sheet for both storage backends (flip STORAGE_BACKEND in dev).
- Delete cancels vs confirms; optimistic remove + rollback on API error.
- Regenerate round-trip: settings in JSON == wizard state out.
- Regression: active-job polling still stops on terminal states.

---

### Phase 5 — Library (uploads management)
**Effort:** ~1 day · **Touches:** new `dashboard/library/page.tsx`, lift `UserBackgroundPanel` internals into reusable hooks/components

Deliverables:
1. Two tabs: **Footage** (user backgrounds — full CRUD exists) and **Images**
   (Phase 7 placeholder `Empty` state with explanation).
2. Footage grid: label, duration/resolution/size meta, status badge
   (processing spinner → ready), preview-on-hover muted loop using existing
   360×640 `render_preview` renditions (already generated in
   `process_background`), delete with AlertDialog, upload zone (drag-drop +
   file picker) driving existing init/presigned-part/complete flow with
   progress.
3. Quota awareness: FREE_MAX_BACKGROUNDS / PREMIUM_MAX shown inline; blocked
   upload explains limit + plan (matches backend 403 wording).
4. Select-mode: picking an asset here sets it as the wizard's background
   (query param handoff `create/story?bg={id}`) — closes the loop the old
   picker did, now with full-page context.

Test plan:
- Upload happy path (multi-hundred-MB file exercises multipart parts),
  failure mid-upload aborts cleanly (`abort_multipart` path).
- Delete while a job references the background → backend 409 handling
  surfaced as toast (verify worker-side re-check still guards).
- Free-user cap hit → clear message, no phantom request.

---

### Phase 6 — Meme Studio I: scene engine, preset gallery, child TTS
**Effort:** ~1.5 days · **Touches:** `services/graphics.py` (new), `services/scenes.py` (new), `routers/scenes.py` (new), `services/tts.py`, `tasks/render.py`, `routers/jobs.py`, wizard Look step

Deliverables:
1. `settings.template` sanitized (`story|meme|image`, default `story`).
   `render.py` dispatches compositing per template; stages upstream
   (TTS → Whisper → ASS) unchanged.
2. `services/graphics.py`: gradient background generator —
   - Static 1080×1920 PNGs via Pillow (vertical/radial/diagonal
     interpolation), cached per (palette, direction);
   - Animated variant via ffmpeg native `-f lavfi -i
     gradients=s=1080x1920:c0=…:c1=…:speed=0.05` (slow drift — content, not
     chrome, so gradients allowed here).
3. `services/scenes.py`: curated scene registry —
   `{id, label, kind: gradient_static | gradient_animated | image, params}`.
   Launch lineup trending with the format: Rainbow (animated), Sunset,
   Ocean, Candy pastel (gradients); Cozy library, Classroom, Starry night
   (committed CC0 image pack). Image-kind scenes are admin-extensible via
   the existing Assets system (`category="scene"`) so new trends ship
   without deploys.
4. **Truthful previews**: `GET /scenes` returns presets with
   `preview_url`; thumbnails are rendered by the *same* code path as the
   final background at 270×480, lazily generated once and cached under
   `scenes/previews/{id}.webp`. Picker shows exactly what renders.
5. Child-TTS: `settings.tts_pitch` clamp(−12…+12 semitones) + catalog voice
   `ana` (edge `en-US-AnaNeural`, genuine child voice). Pitch applied as a
   post-Whisper audio stage: `asetrate=sr*2^(n/12),aresample=sr,
   atempo=2^(-n/12)` — duration preserved, subtitles stay word-synced because
   transcription ran on the unshifted audio. Scratch-artifact aware (pitched
   file is a derived intermediate, regenerated on resume).
6. Wizard Look step: visual scene grid (rendered thumbs, selected ring,
   labels), pitch preset chip ("Meme child +5"). Title-card layer defaults
   off for memes.

Test plan:
- Golden tests: gradient PNG determinism (hash) per palette; preview
  byte-determinism; ffmpeg arg snapshot for pitch stage (n=−12/0/+5/+12).
- Render matrix: meme × {static, animated} × {pitch 0, +5}; duration
  invariant ±50ms vs unpitched.
- Whisper-sync regression: pitch ON → ASS timestamps equal pitch-OFF run.
- Sanitizer fuzz: unknown template/scene ids rejected; registry whitelist
  against disk listing (no arbitrary paths reach ffmpeg/PIL).

---

### Phase 7 — Meme Studio II: cutout characters + drag-and-drop layer editor
**Effort:** ~2.5 days · **Touches:** `routers/backgrounds.py` (`kind=character`), `@imgly/background-removal` (client), `lib/placement.ts` (new), `components/layer-editor.tsx` (new), `services/text_overlay.py` (new), `tasks/render.py`, wizard Step 3 replacement

Deliverables:
1. **Character uploads**: backgrounds router gains `kind=character`
   (PNG/JPEG/WebP ≤ 15MB), downscaled to ≤2048px before processing.
   Client-side **background removal** via `@imgly/background-removal` (WASM,
   self-hosted model assets in `/public/imgly/`), behind an opt-in switch
   (default ON in the Character tab); RGBA WebP stored. Server-side `rembg`
   explicitly deferred (model weight + worker RAM not justified while the
   client path is free). Rough fur/hair edges are acceptable — the format's
   own aesthetic uses rough cutouts.
2. **Placement contract** (`lib/placement.ts`): every layer position is
   `{x, y}` in normalized [0..1] frame space, center-anchored, plus
   `scale ∈ [0.05..0.9]` (fraction of frame width) and `flip: boolean`.
   Defined once, mirrored by the backend sanitizer
   (clamps: x,y → [0,1], scale → [0.05,0.9], arrays capped at 3 layers).
   CSS preview and ffmpeg math are identical by construction.
3. **Layer editor**: replaces the plain Look step for meme template — the
   phone-frame live preview becomes a canvas of draggable layers:
   - Characters (RGBA imgs) and text boxes are uniformly selectable,
     draggable (pointer events), resizable (corner handle + scale slider
     fallback for touch), arrow-key nudge and Delete-key removal;
   - Text layer inspector: text input (≤140 chars), font picker, size,
     color swatches, alignment;
   - Character inspector: flip toggle, subtle bob animation toggle
     (ffmpeg overlay y-expression `sin(t*2)*20`), default static.
4. **Fonts**: curated OFL registry (≤10: Anton, Bebas Neue, Inter,
   Bricolage Grotesque, Caveat, Patrick Hand, Baloo 2, …) committed to
   `backend/fonts/` and exposed via `GET /fonts`. The browser preview loads
   the **same TTF files** (`@font-face`); final text is rendered by
   `services/text_overlay.py` with Pillow from the same files into
   transparent PNGs → one ffmpeg `overlay` input per text layer.
   Width-fit auto-shrink (no auto-wrap) eliminates cross-engine
   line-break drift.
5. **Compositing order** (z-law of the format): scene → characters →
   text overlays → word-synced captions last. `settings.characters[]` and
   `settings.text_overlays[]` sanitized server-side (ids ownership-checked /
   whitelisted against registry, floats clamped, colors validated).
6. Draft persistence (Phase 3 localStorage) extended with layers; zod
   schemas mirror sanitizer constants.

Test plan:
- Sanitizer matrix: clamps, array caps, `asset_id` ownership (403s),
  `font_id`/color whitelists, hostile strings never reach ffmpeg/PIL.
- ffmpeg arg snapshot per representative layer combination (1 char + 1 text,
  flipped char, bobbed char, 3-layer cap).
- PIL overlay determinism (hash) for fixed layer specs.
- WYSIWYG check: preview screenshot vs extracted video frame — text block
  position within tolerance at all four corners + center (manual, 1440px and
  mobile widths).
- Keyboard-only editor pass (select/move/nudge/delete reachable).
- Flagship e2e: rainbow scene + cutout cat + dragged title text +
  pitched child TTS renders end-to-end.

---

### Phase 8 — Custom Image template (full-bleed)
**Effort:** ~1 day (cheap now: image upload pipeline lands in Phase 7) · **Touches:** `routers/backgrounds.py` (`kind=image`), `services/image.py` (new), `tasks/render.py`, wizard

Deliverables:
1. Full-bleed image uploads (`kind=image`, ≤ 15MB): processing task decodes,
   cover-crops to 1080×1920 (bias: center 35% top — subjects sit upper),
   stores the rendition.
2. Optional Ken Burns: slow zoompan 1.0→1.08 across voiceover duration
   (`-loop 1 -t dur` + zoompan) so static images get life; toggle in wizard.
3. Pipeline branch: processed image as `[0:v]`; layer editor, captions,
   TTS all reused unchanged. Template picker card goes live.

Test plan:
- Crop unit tests: portrait/landscape/square/tiny/huge → exact 1080×1920,
  top-bias sanity.
- Upload rejection matrix: oversize, wrong MIME, corrupt/truncated files.
- Ken Burns duration == voiceover ±50ms, no black tail frames.
- e2e: uploaded photo + removed-bg character over it + captions.

---

## 7. Risk register

| Risk | Mitigation |
|---|---|
| Next 16 breaking changes (route groups, proxy semantics differ from older Next) | Read `node_modules/next/dist/docs/` guides before each routing-touching phase (mandated by `frontend/AGENTS.md`); smallest possible diffs per phase |
| Thumbnail presign cost on grid views (N presigns per load) | Short TTL (300s), SWR dedupe, lazy-load below fold; acceptable at current scale |
| Pitch-shift desyncs subtitles if ordered wrong | Pitch strictly post-Whisper, enforced by stage order in `render.py` + regression test asserting ASS timestamps unchanged |
| Client BG-removal model size (~40–80MB WASM+weights first visit) | Self-hosted assets + explicit user opt-in switch + browser cache; lazy chunk so non-users never download it |
| Cutout edge quality on fur/hair (U2Net-class limits) | Acceptable by design — the format's own aesthetic uses rough cutouts; server-side `rembg` upgrade path stays open |
| Browser↔Pillow font metric drift breaks WYSIWYG | Same committed TTFs both sides; width-fit auto-shrink instead of auto-wrap; corner+center position tolerance test in Phase 7 gate |
| Layer editor complexity creep (rotation, opacity, keyframes…) | v1 contract fixed: move/scale/flip/bob only — everything else deferred to post-V2 (see Non-goals) |
| Sidebar refactor breaks auth flows | Proxy matcher changes land in Phase 1 with full redirect matrix test; `/jobs` redirects permanent (308) |
| Scope creep in wizard (becomes form-builder) | Non-goals below |

## 8. Non-goals (this plan)

- Light/dark theme toggle (tokens stay dark-first; revisit post-V2)
- Team/multi-workspace features, sharing links, scheduling/posts queue
- Real-time collaboration or websocket job streaming (polling is fine at this scale)
- Video-gen / lip-synced characters (needs generative models — different plan, different budget)
- Replacing the admin panel's internal design beyond the type sweep
- Layer-editor extras: rotation, opacity, z-reordering UI, keyframed
  animation, multi-select — schema leaves room, editor ships without them
- Custom font uploads (font registry is admin-code-curated for licensing safety)

## 9. Sequencing & effort summary

| Phase | Deliverable | Effort | Cumulative |
|---|---|---|---|
| 0 | Tokens + typography + components | 1 d | usable immediately |
| 1 | Sidebar shell + routes | 1–1.5 d | platform feel ✓ |
| 2 | Home hub + thumbs + stats | 1.5 d | informative dashboard ✓ |
| 3 | Template picker + wizard | 2 d | high-converting create ✓ |
| 4 | My Reels upgrades | 1.5 d | management ✓ |
| 5 | Library | 1 d | assets ✓ |
| 6 | Meme Studio I: scenes + previews + child TTS | 1.5 d | trend feature ✓ |
| 7 | Meme Studio II: cutouts + drag-drop layer editor | 2.5 d | signature editor ✓ |
| 8 | Custom Image template | 1 d | full vision ✓ |

Total ≈ 13–14 focused days. Phases 0–3 alone deliver the "proper platform"
feel; 4–5 complete management; 6–8 ship the meme studio and new reel types.
Phases 6/7 are independent of 4/5 and can interleave if the trend feature
needs to ship early (minimum path to demo: 0 → 1 → 3 → 6 → 7).

Every phase ends with: `pytest tests/` (backend), `tsc --noEmit` + `eslint` +
`next build` (frontend), the phase's manual checklist, one real end-to-end
reel render, then PR → merge to `main`. Branch naming follows the existing
convention (`feature/v2-phase-N-*`).
