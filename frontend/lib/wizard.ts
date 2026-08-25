import { z } from "zod";
import { DEFAULT_RENDER_SETTINGS, type RenderSettings } from "@/lib/types";

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
    tagline: "Rainbow scenes, character cutouts, draggable text and child TTS.",
    status: "coming-soon" as const,
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
  caption_font_size: z.number().int().min(48).max(140),
  caption_position: z.enum(["lower", "center", "upper"]),
  caption_color: z.enum(["white", "yellow", "brand"]),
  caption_outline: z.number().int().min(0).max(12),
  caption_words: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  title_enabled: z.boolean(),
  title_position: z.enum(["top", "bottom"]),
  title_scale: z.number().int().min(60).max(130),
  title_style: z.enum(["dark", "light", "minimal"]),
  title_badge: z.boolean(),
});

export const wizardSchema = z
  .object({
    // Content
    title: z.string().trim().min(1, "Give your reel a title").max(300),
    subreddit: z.string().trim().max(50).default(""),
    story: z.string().trim().min(1, "Paste a story first"),
    max_words: z.number().int().min(50).max(2000),
    // Voice
    tts_provider: z.enum(["auto", "elevenlabs", "edge"]),
    voice: z.string().min(1),
    speed: z.number().min(0.8).max(1.5),
    expressiveness: z.enum(["natural", "expressive", "dramatic"]),
    // Look — background
    gameplay_category: z.string(),
    gameplay_source: z.enum(["library", "user"]),
    background_id: z.string().default(""),
    retention: z.enum(["ephemeral", "retain"]),
    // Look — render knobs (flattened RenderSettings)
    ...renderSchema.shape,
  })
  .superRefine((v, ctx) => {
    if (v.gameplay_source === "user" && !v.background_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["background_id"],
        message: "Pick or upload your own footage first",
      });
    }
  });

export type WizardState = z.infer<typeof wizardSchema>;
/** Pre-validation shape: `.default()`-ed fields may be absent (form inputs). */
export type WizardInput = z.input<typeof wizardSchema>;

export const DEFAULT_WIZARD_STATE: WizardState = {
  title: "",
  subreddit: "",
  story: "",
  max_words: DURATIONS[2].words,
  tts_provider: "auto",
  voice: "daniel",
  speed: 1.1,
  expressiveness: "expressive",
  gameplay_category: "any",
  gameplay_source: "library",
  background_id: "",
  retention: "ephemeral",
  ...DEFAULT_RENDER_SETTINGS,
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
  voice: ["tts_provider", "voice", "speed", "expressiveness"],
  look: [
    "gameplay_category",
    "gameplay_source",
    "background_id",
    "retention",
    "captions_enabled",
    "caption_font_size",
    "caption_position",
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
    caption_font_size: s.caption_font_size,
    caption_position: s.caption_position,
    caption_color: s.caption_color,
    caption_outline: s.caption_outline,
    caption_words: s.caption_words as RenderSettings["caption_words"],
    title_enabled: s.title_enabled,
    title_position: s.title_position,
    title_scale: s.title_scale,
    title_style: s.title_style,
    title_badge: s.title_badge,
  };
  return {
    title: s.title.trim(),
    subreddit: s.subreddit.trim() || null,
    story: s.story.trim(),
    settings: {
      voice: s.voice,
      tts_provider: s.tts_provider,
      speed: s.speed,
      expressiveness: s.expressiveness,
      ...render,
      gameplay_category: s.gameplay_category,
      gameplay_source: s.gameplay_source,
      ...(s.gameplay_source === "user"
        ? { background_id: s.background_id }
        : {}),
      retention: s.retention,
      max_words: s.max_words,
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
