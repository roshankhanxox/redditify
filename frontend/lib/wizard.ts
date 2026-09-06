import { z } from "zod";
import {
  CAPTION_POSITION_Y,
  DEFAULT_RENDER_SETTINGS,
  type RenderSettings,
} from "@/lib/types";
import type { CaptionMode } from "@/lib/types";

export const DURATIONS = [
  { label: "~30s", words: 400 },
  { label: "~60s", words: 800 },
  { label: "~90s", words: 1200 },
  { label: "Full post", words: 2000 },
] as const;

export const TEMPLATES = [
  {
    id: "story",
    name: "Story Reel",
    tagline: "Paste a story — voiceover, synced captions, gameplay background.",
    status: "live" as const,
  },
  {
    id: "meme",
    name: "Meme Studio",
    tagline: "Gradient scenes, pitched kid-voice TTS and synced captions.",
    status: "live" as const,
  },
  {
    id: "image",
    name: "Custom Image",
    tagline: "Upload a photo, we crop it vertical and add captions + TTS.",
    status: "coming-soon" as const,
  },
] as const;

export type TemplateId = (typeof TEMPLATES)[number]["id"];

// ------------------------------------------------------------------ schema
// Mirrors backend `_sanitize_settings` clamps so client errors match what
// the server would enforce anyway.

const renderSchema = z.object({
  captions_enabled: z.boolean(),
  caption_mode: z.enum(["synced", "static"]),
  caption_layout: z.enum(["chunks", "block"]),
  caption_font_size: z.number().int().min(48).max(140),
  caption_scale: z.number().int().min(50).max(100),
  caption_position: z.enum(["lower", "center", "upper"]),
  caption_y: z.number().min(0.05).max(0.95),
  caption_color: z.enum(["white", "yellow", "brand"]),
  caption_outline: z.number().int().min(0).max(12),
  caption_words: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  caption_animation: z.enum(["none", "karaoke"]),
  caption_highlight_color: z.enum(["white", "yellow", "brand"]),
  title_enabled: z.boolean(),
  title_position: z.enum(["top", "bottom"]),
  title_scale: z.number().int().min(60).max(130),
  title_style: z.enum(["dark", "light", "minimal"]),
  title_badge: z.boolean(),
});

export const wizardSchema = z
  .object({
    template: z.enum(["story", "meme", "image"]),
    // Content
    title: z.string().trim().max(300),
    subreddit: z.string().trim().max(50).default(""),
    story: z.string().trim().min(1, "Paste a story first"),
    max_words: z.number().int().min(50).max(2000),
    // Static-caption source text (caption_mode === "static")
    caption_text: z.string().max(600),
    // Voice
    tts_provider: z.enum(["auto", "elevenlabs", "edge"]),
    voice: z.string().min(1),
    voice_personality: z.enum(["none", "friendly", "hype", "calm", "serious"]),
    speed: z.number().min(0.8).max(1.5),
    expressiveness: z.enum(["natural", "expressive", "dramatic"]),
    tts_pitch: z.number().int().min(-12).max(12),
    scene_id: z.string(),
    scene_animated: z.boolean(),
    characters: z.array(z.object({
      asset_id: z.string(),
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1),
      scale: z.number().min(0.05).max(0.9),
      flip: z.boolean(),
      bob: z.boolean(),
      rotation: z.number().min(-180).max(180).optional(),
    })).max(3),
    text_overlays: z.array(z.object({
      text: z.string().min(1).max(140),
      font_id: z.string().min(1),
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1),
      scale: z.number().min(0.02).max(0.98),
      color: z.string(),
      align: z.enum(["left", "center", "right"]),
    })).max(3),
    // Look — background (story template)
    gameplay_category: z.string(),
    gameplay_source: z.enum(["library", "user"]),
    background_id: z.string().default(""),
    retention: z.enum(["ephemeral", "retain"]),
    // Look — render knobs (flattened RenderSettings)
    ...renderSchema.shape,
  })
  .superRefine((v, ctx) => {
    // Reddit packaging — a reel title is a story-template concern.
    if (v.template !== "meme" && !v.title.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["title"],
        message: "Give your reel a title",
      });
    }
    if (
      v.template === "story" &&
      v.gameplay_source === "user" &&
      !v.background_id
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["background_id"],
        message: "Pick or upload your own footage first",
      });
    }
    if (v.template === "meme" && !v.scene_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["scene_id"],
        message: "Pick a scene",
      });
    }
  });

export type WizardState = z.infer<typeof wizardSchema>;
/** Pre-validation shape: `.default()`-ed fields may be absent (form inputs). */
export type WizardInput = z.input<typeof wizardSchema>;

export const DEFAULT_WIZARD_STATE: WizardState = {
  template: "story",
  title: "",
  subreddit: "",
  story: "",
  max_words: DURATIONS[2].words,
  caption_text: "",
  tts_provider: "auto",
  voice: "daniel",
  voice_personality: "none",
  speed: 1.1,
  expressiveness: "expressive",
  tts_pitch: 0,
  scene_id: "rainbow",
  scene_animated: true,
  characters: [],
  text_overlays: [],
  gameplay_category: "any",
  gameplay_source: "library",
  background_id: "",
  retention: "ephemeral",
  ...DEFAULT_RENDER_SETTINGS,
};

/** Meme defaults: captions carry the text, so the title card starts off.
 *  Gradient scenes default to a static frame — matches the fixed-background
 *  reel style; flip "Background motion" to animate. */
export const DEFAULT_MEME_STATE: WizardState = {
  ...DEFAULT_WIZARD_STATE,
  template: "meme",
  voice: "ana",
  tts_pitch: 5,
  scene_animated: false,
  title_enabled: false,
};

export const STEPS = [
  { id: "content", label: "Content" },
  { id: "voice", label: "Voice" },
  { id: "look", label: "Look" },
  { id: "review", label: "Review" },
] as const;

/** Fields validated when leaving each step (zod paths). */
export const STEP_FIELDS: Record<(typeof STEPS)[number]["id"], string[]> = {
  content: ["title", "story"],
  voice: ["tts_provider", "voice", "voice_personality", "speed", "expressiveness", "tts_pitch"],
  look: [
    "gameplay_category",
    "gameplay_source",
    "background_id",
    "scene_id",
    "scene_animated",
    "retention",
    "captions_enabled",
    "caption_mode",
    "caption_layout",
    "caption_text",
    "caption_font_size",
    "caption_scale",
    "caption_position",
    "caption_y",
    "caption_color",
    "caption_outline",
    "caption_words",
    "title_enabled",
    "title_position",
    "title_scale",
    "title_style",
    "title_badge",
  ],
  review: [],
};

/** Exact payload shape of the legacy dashboard form (server contract). */
export function buildPayload(s: WizardState) {
  const render: RenderSettings = {
    captions_enabled: s.captions_enabled,
    caption_mode: s.caption_mode,
    caption_layout: s.caption_layout,
    caption_font_size: s.caption_font_size,
    caption_scale: s.caption_scale ?? 100,
    caption_position: s.caption_position,
    caption_y: s.caption_y,
    caption_color: s.caption_color,
    caption_outline: s.caption_outline,
    caption_words: s.caption_words as RenderSettings["caption_words"],
    caption_animation: s.caption_animation,
    caption_highlight_color: s.caption_highlight_color,
    title_enabled: s.title_enabled,
    title_position: s.title_position,
    title_scale: s.title_scale,
    title_style: s.title_style,
    title_badge: s.title_badge,
  };
  const base = {
    voice: s.voice,
    tts_provider: s.tts_provider,
    voice_personality: s.voice_personality,
    speed: s.speed,
    expressiveness: s.expressiveness,
    ...render,
    caption_text: s.caption_text,
    caption_layout: s.caption_layout,
    retention: s.retention,
    max_words: s.max_words,
  };
  // Memes skip the Reddit packaging: derive a title when the user skipped it.
  const title =
    s.title.trim() ||
    (s.template === "meme"
      ? (s.caption_text || s.story || "Meme reel").trim().replace(/\s+/g, " ").slice(0, 80)
      : "");
  return {
    title,
    subreddit: s.subreddit.trim() || null,
    story: s.story.trim(),
    settings:
      s.template === "meme"
        ? {
            template: "meme",
            scene_id: s.scene_id,
            scene_animated: s.scene_animated,
            tts_pitch: s.tts_pitch,
            characters: s.characters,
            text_overlays: s.text_overlays,
            ...base,
          }
        : {
            template: "story",
            gameplay_category: s.gameplay_category,
            gameplay_source: s.gameplay_source,
            ...(s.gameplay_source === "user"
              ? { background_id: s.background_id }
              : {}),
            ...base,
          },
  };
}

// ------------------------------------------------------------ draft persistence

const draftKey = (template: string) => `reelbot:draft:${template}`;

export function loadDraft(template: string): WizardState | null {
  try {
    const raw = localStorage.getItem(draftKey(template));
    if (!raw) return null;
    const parsed = wizardSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function saveDraft(template: string, state: WizardState): void {
  try {
    localStorage.setItem(draftKey(template), JSON.stringify(state));
  } catch {
    /* quota/private-mode failures are non-fatal */
  }
}

export function clearDraft(template: string): void {
  try {
    localStorage.removeItem(draftKey(template));
  } catch {
    /* ignore */
  }
}

// ------------------------------------------------------------ regenerate prefill

/** Map a stored job (`GET /jobs/{id}` payload) back into wizard state.
 *  Every settings field re-validates against the schema bounds; anything
 *  missing or out-of-range falls back to defaults. */
export function stateFromJob(job: {
  title?: string | null;
  story?: string | null;
  settings?: Record<string, unknown> | null;
}): WizardState {
  const st = job.settings ?? {};
  const num = (v: unknown, def: number, lo: number, hi: number) =>
    typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : def;
  const bool = (v: unknown, def: boolean) => (typeof v === "boolean" ? v : def);
  const pick = <T extends string | number>(v: unknown, allowed: readonly T[], def: T): T =>
    allowed.includes(v as T) ? (v as T) : def;

  const template = pick(st.template, ["story", "meme", "image"] as const, "story");
  return {
    template,
    characters: Array.isArray(st.characters) ? st.characters : [],
    text_overlays: Array.isArray(st.text_overlays) ? st.text_overlays : [],
    scene_id:
      typeof st.scene_id === "string" && st.scene_id ? st.scene_id : DEFAULT_WIZARD_STATE.scene_id,
    // Jobs stored before the knob were rendered animated — restore that.
    scene_animated: bool(st.scene_animated, true),
    tts_pitch: num(st.tts_pitch, 0, -12, 12),
    title: (job.title ?? "").slice(0, 300),
    subreddit:
      typeof st.subreddit_label === "string" ? st.subreddit_label.slice(0, 50) : "",
    story: job.story ?? "",
    max_words: num(st.max_words, DURATIONS[2].words, 50, 2000),
    tts_provider: pick(st.tts_provider, ["auto", "elevenlabs", "edge"] as const, "auto"),
    voice: typeof st.voice === "string" ? st.voice : DEFAULT_WIZARD_STATE.voice,
    voice_personality: pick(
      st.voice_personality,
      ["none", "friendly", "hype", "calm", "serious"] as const,
      "none",
    ),
    speed: num(st.speed, 1.1, 0.8, 1.5),
    expressiveness: pick(
      st.expressiveness,
      ["natural", "expressive", "dramatic"] as const,
      "expressive",
    ),
    gameplay_category:
      typeof st.gameplay_category === "string" ? st.gameplay_category : "any",
    gameplay_source: pick(st.gameplay_source, ["library", "user"] as const, "library"),
    background_id: typeof st.background_id === "string" ? st.background_id : "",
    retention: pick(st.retention, ["ephemeral", "retain"] as const, "ephemeral"),
    captions_enabled: bool(st.captions_enabled, true),
    caption_mode: pick(st.caption_mode, ["synced", "static"] as const, "synced"),
    caption_layout: pick(st.caption_layout, ["chunks", "block"] as const, "chunks"),
    caption_text: typeof st.caption_text === "string" ? st.caption_text.slice(0, 600) : "",
    caption_font_size: num(st.caption_font_size, 96, 48, 140),
    caption_scale: num(st.caption_scale, 100, 50, 100),
    caption_position: pick(st.caption_position, ["lower", "center", "upper"] as const, "lower"),
    caption_y: num(
      st.caption_y,
      CAPTION_POSITION_Y[pick(st.caption_position, ["lower", "center", "upper"] as const, "lower")],
      0.05,
      0.95,
    ),
    caption_color: pick(st.caption_color, ["white", "yellow", "brand"] as const, "white"),
    caption_outline: num(st.caption_outline, 6, 0, 12),
    caption_words: pick(st.caption_words, [1, 2, 3] as const, 2),
    caption_animation: pick(st.caption_animation, ["none", "karaoke"] as const, "none"),
    caption_highlight_color: pick(st.caption_highlight_color, ["white", "yellow", "brand"] as const, "yellow"),
    title_enabled: bool(st.title_enabled, true),
    title_position: pick(st.title_position, ["top", "bottom"] as const, "top"),
    title_scale: num(st.title_scale, 100, 60, 130),
    title_style: pick(st.title_style, ["dark", "light", "minimal"] as const, "dark"),
    title_badge: bool(st.title_badge, true),
  };
}
