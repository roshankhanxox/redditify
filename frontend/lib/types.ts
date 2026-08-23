export interface Job {
  id: string;
  title: string;
  story_excerpt: string;
  status: string;
  settings: Record<string, unknown>;
  retention: string;
  result_url: string | null;
  result_expires_at: string | null;
  error_message: string | null;
  duration_seconds: number | null;
  created_at: string;
  updated_at: string;
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

export interface UserBackgroundList {
  items: UserBackground[];
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
