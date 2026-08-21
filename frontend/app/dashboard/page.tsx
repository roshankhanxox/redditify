"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import useSWR from "swr";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import type { AssetList, Job } from "@/lib/types";

const STATUS_STEPS: Record<string, number> = {
  QUEUED: 5,
  GENERATING_VOICEOVER: 25,
  TRANSCRIBING: 45,
  RENDERING_TITLE_CARD: 60,
  PICKING_GAMEPLAY: 70,
  COMPOSITING_VIDEO: 85,
  UPLOADING: 95,
  DONE: 100,
};

const STATUS_LABELS: Record<string, string> = {
  QUEUED: "Queued...",
  GENERATING_VOICEOVER: "Generating voiceover...",
  TRANSCRIBING: "Transcribing for subtitles...",
  RENDERING_TITLE_CARD: "Rendering title card...",
  PICKING_GAMEPLAY: "Picking gameplay clip...",
  COMPOSITING_VIDEO: "Compositing video...",
  UPLOADING: "Uploading...",
  DONE: "Done!",
};

const DURATIONS = [
  { label: "~30s", words: 400 },
  { label: "~60s", words: 800 },
  { label: "~90s", words: 1200 },
  { label: "Full post", words: 2000 },
];

const fetcher = (url: string) => api.get(url).then((r) => r.data);

export default function DashboardPage() {
  const { data: session } = useSession();

  const [title, setTitle] = useState("");
  const [subreddit, setSubreddit] = useState("");
  const [story, setStory] = useState("");
  const [voice, setVoice] = useState("male");
  const [titleStyle, setTitleStyle] = useState("dark");
  const [category, setCategory] = useState("any");
  const [durationIdx, setDurationIdx] = useState(2);
  const [jobId, setJobId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const wordCount = story.trim() ? story.trim().split(/\s+/).length : 0;

  const { data: quota } = useSWR<{ daily_used: number; daily_limit: number; unlimited?: boolean }>(
    session ? "/quota/me" : null,
    fetcher,
    { refreshInterval: 30_000 },
  );
  const { data: assetData } = useSWR<AssetList>(session ? "/assets" : null, fetcher);

  function generate() {
    if (!title.trim()) return toast.error("Give your reel a title");
    if (!story.trim()) return toast.error("Paste a story first");
    setCreating(true);
    api
      .post<{ job_id: string; duplicate: boolean }>("/jobs", {
        title,
        subreddit: subreddit || null,
        story,
        settings: {
          voice,
          title_style: titleStyle,
          gameplay_category: category,
          max_words: DURATIONS[durationIdx].words,
        },
      })
      .then((r) => setJobId(r.data.job_id))
      .catch((err) => {
        toast.error(err?.response?.data?.detail || "Could not create job");
      })
      .finally(() => setCreating(false));
  }

  function reset() {
    setJobId(null);
    setTitle("");
    setStory("");
  }

  return (
    <div className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Create a Reel</h1>
        <div className="flex items-center gap-3">
          <a href="/jobs" className="text-sm text-muted-foreground hover:text-foreground">
            My Jobs
          </a>
          <Badge variant="secondary">
            {quota
              ? quota.unlimited
                ? "Unlimited"
                : `${Math.max(0, quota.daily_limit - quota.daily_used)} videos left today`
              : "..."}
          </Badge>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        {/* Left — content */}
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>The Story</CardTitle>
            <CardDescription>Paste any Reddit-style post or story text</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="title">Title</Label>
              <Input
                id="title"
                placeholder={'e.g. "AITA for returning my roommate\'s vacuum?"'}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="subreddit">Subreddit label (optional)</Label>
              <Input
                id="subreddit"
                placeholder="AskReddit"
                value={subreddit}
                onChange={(e) => setSubreddit(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="story">Story / post content</Label>
                <span className="text-xs text-muted-foreground">{wordCount} words</span>
              </div>
              <Textarea
                id="story"
                rows={14}
                placeholder="Paste the full post text here..."
                value={story}
                onChange={(e) => setStory(e.target.value)}
                className="resize-y"
              />
            </div>
          </CardContent>
        </Card>

        {/* Right — settings + generation */}
        <div className="flex flex-col gap-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Settings</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <div className="flex flex-col gap-2">
                <Label>Voice</Label>
                <Select value={voice} onValueChange={setVoice}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="male">Storyteller Male</SelectItem>
                    <SelectItem value="female">Storyteller Female</SelectItem>
                    <SelectItem value="neutral">Neutral</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-3">
                <Label>Title Card Style</Label>
                <RadioGroup value={titleStyle} onValueChange={setTitleStyle} className="flex gap-4">
                  {["dark", "light", "minimal"].map((s) => (
                    <div key={s} className="flex items-center gap-2">
                      <RadioGroupItem value={s} id={`style-${s}`} />
                      <Label htmlFor={`style-${s}`} className="capitalize font-normal">
                        {s}
                      </Label>
                    </div>
                  ))}
                </RadioGroup>
              </div>

              <div className="flex flex-col gap-2">
                <Label>Gameplay Background</Label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(assetData?.categories ?? ["any"]).map((c) => (
                      <SelectItem key={c} value={c} className="capitalize">
                        {c === "any" ? "Any" : c.replace("_", " ")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <Label>Max Duration</Label>
                  <span className="text-sm text-muted-foreground">{DURATIONS[durationIdx].label}</span>
                </div>
                <Slider
                  min={0}
                  max={3}
                  step={1}
                  value={[durationIdx]}
                  onValueChange={([v]) => setDurationIdx(v)}
                />
              </div>
            </CardContent>
          </Card>

          {jobId ? (
            <JobStatusTracker jobId={jobId} onReset={reset} />
          ) : (
            <Button size="lg" className="w-full" onClick={generate} disabled={creating}>
              {creating ? "Starting..." : "Generate Reel"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function JobStatusTracker({ jobId, onReset }: { jobId: string; onReset: () => void }) {
  const isTerminal = (s?: string) => s === "DONE" || s === "FAILED";

  const { data: job } = useSWR<Job>(
    isTerminal(jobStatusCache.get(jobId)) ? null : `/jobs/${jobId}`,
    fetcher,
    { refreshInterval: 2000, onSuccess: (d) => jobStatusCache.set(jobId, d.status) },
  );

  const status = job?.status ?? "QUEUED";
  const pct = STATUS_STEPS[status] ?? 0;

  if (status === "DONE") {
    return (
      <Card>
        <CardContent className="flex flex-col gap-3 p-6">
          <p className="font-medium text-center">Your reel is ready!</p>
          <Button asChild className="w-full">
            <a href={`/api/proxy/jobs/${jobId}/download`} download>
              Download MP4
            </a>
          </Button>
          <Button variant="outline" className="w-full" onClick={onReset}>
            Generate Another
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (status === "FAILED") {
    return (
      <Card>
        <CardContent className="flex flex-col gap-3 p-6">
          <p className="font-medium text-destructive text-center">Generation failed</p>
          <p className="text-sm text-muted-foreground break-words line-clamp-4">
            {job?.error_message || "Unknown error"}
          </p>
          <Button variant="outline" className="w-full" onClick={onReset}>
            Try Again
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-6">
        <Progress value={pct} />
        <p className="text-sm text-muted-foreground text-center">{STATUS_LABELS[status]}</p>
        <p className="text-xs text-muted-foreground text-center">{pct}%</p>
      </CardContent>
    </Card>
  );
}

// Tracks terminal state so SWR polling stops once a job finishes.
const jobStatusCache = new Map<string, string>();
