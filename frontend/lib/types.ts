export type CaptionPosition = "lower" | "center" | "upper";
export type CaptionColor = "white" | "yellow" | "brand";
export type TitlePosition = "top" | "bottom";
export type TitleCardStyle = "dark" | "light" | "minimal";

export interface RenderSettings {
  captions_enabled: boolean;
  caption_font_size: number;
  caption_position: CaptionPosition;
  /** Normalized vertical center of the caption block [0.05..0.95]; maps to
   *  ASS MarginV = (1-y)*1920. Overrides `caption_position` at render time. */
  caption_y: number;
  caption_color: CaptionColor;
  caption_outline: number;
  caption_words: 1 | 2 | 3;
  title_enabled: boolean;
  title_position: TitlePosition;
  title_scale: number;
  title_style: TitleCardStyle;
  title_badge: boolean;
}

/** Where each legacy position preset lands vertically (fraction of frame height). */
export const CAPTION_POSITION_Y: Record<CaptionPosition, number> = {
  lower: 0.65,
  center: 0.55,
  upper: 0.38,
};

export const DEFAULT_RENDER_SETTINGS: RenderSettings = {
  captions_enabled: true,
  caption_font_size: 96,
  caption_position: "lower",
  caption_y: CAPTION_POSITION_Y.lower,
  caption_color: "white",
  caption_outline: 6,
  caption_words: 2,
  title_enabled: true,
  title_position: "top",
  title_scale: 100,
  title_style: "dark",
  title_badge: true,
};

export interface Job {
  id: string;
  title: string;
  story_excerpt: string;
  /** Full body — only present on the single-job detail endpoint. */
  story?: string;
  status: string;
  settings: Record<string, unknown>;
  retention: string;
  result_url: string | null;
  thumbnail_url: string | null;
  preview_url: string | null;
  result_expires_at: string | null;
  error_message: string | null;
  duration_seconds: number | null;
  created_at: string;
  updated_at: string;
}

export interface StatsMe {
  total_reels: number;
  total_seconds: number;
  daily_used: number;
  daily_limit: number;
  monthly_used: number;
  monthly_limit: number;
  unlimited: boolean;
  plan: string;
}

export interface JobList {
  items: Job[];
  page: number;
  per_page: number;
  total: number;
}

export interface AssetClip {
  id: string;
  filename: string;
  category: string;
  duration_seconds: number | null;
  file_size_bytes: number | null;
  resolution: string | null;
  enabled: boolean;
}

export interface AssetList {
  categories: string[];
  clips: AssetClip[];
}

export interface UserBackground {
  id: string;
  label: string;
  status: "pending" | "processing" | "ready" | "failed";
  duration_seconds: number | null;
  file_size_bytes: number | null;
  resolution: string | null;
  error_message: string | null;
  created_at: string;
}

export interface CharacterAssetList {
  items: CharacterAsset[];
}

export interface CharacterAsset {
  id: string;
  label: string;
  status: "pending" | "ready" | "failed";
  width: number | null;
  height: number | null;
  file_size_bytes: number | null;
  bg_removed: boolean;
  error_message: string | null;
  created_at: string;
}

export interface UserBackgroundList {
  items: UserBackground[];
  /** Plan-dependent ready-clip cap (mirrors backend FREE/PREMIUM_MAX_BACKGROUNDS). */
  max_backgrounds?: number;
}

export interface AdminJob extends Job {
  user_id: string;
  user_email: string | null;
}

export interface AdminUser {
  id: string;
  email: string;
  role: string;
  plan: string;
  must_change_password: boolean;
  created_at: string;
  quota: {
    daily_used: number;
    monthly_used: number;
    daily_limit: number;
    monthly_limit: number;
  };
}
