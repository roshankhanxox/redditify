"use client";

import { useState, useRef } from "react";
import { useSession } from "next-auth/react";
import useSWR from "swr";
import { toast } from "sonner";
import { api, downloadReel } from "@/lib/api";
import { AppNav } from "@/components/app-nav";
import { UserBackgroundPanel } from "@/components/background-picker";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { AssetList, Job } from "@/lib/types";
import { DEFAULT_RENDER_SETTINGS, type RenderSettings } from "@/lib/types";
import { VOICES, TTS_PROVIDERS } from "@/lib/voices";
import { CustomizePanel, Segmented } from "@/components/customize-panel";

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
  const [ttsProvider, setTtsProvider] = useState("auto");
  const [speed, setSpeed] = useState(1.1);
  const [expressiveness, setExpressiveness] = useState<"natural" | "expressive" | "dramatic">("expressive");
  const [render, setRender] = useState<RenderSettings>(DEFAULT_RENDER_SETTINGS);
  const [category, setCategory] = useState("any");
  const [bgSource, setBgSource] = useState<"library" | "user">("library");
  const [backgroundId, setBackgroundId] = useState<string>("");
  const [retention, setRetention] = useState<"ephemeral" | "retain">("ephemeral");
  const [durationIdx, setDurationIdx] = useState(2);
  const [jobId, setJobId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const wordCount = story.trim() ? story.trim().split(/\s+/).length : 0;

  const { data: quota } = useSWR<{ daily_used: number; daily_limit: number; unlimited?: boolean; plan?: string }>(
    session ? "/quota/me" : null,
    fetcher,
    { refreshInterval: 30_000 },
  );
  const canRetain = session?.user?.role === "admin" || quota?.plan === "premium";
  const { data: assetData } = useSWR<AssetList>(session ? "/assets" : null, fetcher);

  function generate() {
    if (!title.trim()) return toast.error("Give your reel a title");
    if (!story.trim()) return toast.error("Paste a story first");
    if (bgSource === "user" && !backgroundId)
      return toast.error("Pick or upload your own footage first");
    setCreating(true);
    api
      .post<{ job_id: string; duplicate: boolean }>("/jobs", {
        title,
        subreddit: subreddit || null,
        story,
        settings: {
          voice,
          tts_provider: ttsProvider,
          speed,
          expressiveness,
          ...render,
          gameplay_category: category,
          gameplay_source: bgSource,
          background_id: bgSource === "user" ? backgroundId : undefined,
          retention,
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
    <>
      <AppNav />
      <div className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
        <header className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold tracking-tight">Create a Reel</h1>
          <Badge variant="secondary">
            {quota
              ? quota.unlimited
                ? "Unlimited"
                : `${Math.max(0, quota.daily_limit - quota.daily_used)} videos left today`
              : "..."}
          </Badge>
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

        {/* Right — settings + generation. Bounded to the viewport; [&>*]:shrink-0
            is essential: the Cards are flex items with overflow-hidden, so
            without it they shrink-to-fit instead of overflowing into a
            scrollbar (content got clipped with nothing to scroll). Scrollbar
            styling is global (globals.css). */}
        <div className="flex max-h-[calc(100dvh-6rem)] flex-col gap-6 self-start overflow-y-auto pr-1 [&>*]:shrink-0 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Settings</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <Tabs defaultValue="voice" className="w-full gap-4">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="voice">Voice</TabsTrigger>
                  <TabsTrigger value="look">Look</TabsTrigger>
                </TabsList>

                <TabsContent value="voice" className="flex flex-col gap-5">
                  <div className="flex flex-col gap-2">
                    <Label>Voice Engine</Label>
                    <RadioGroup
                      value={ttsProvider}
                      onValueChange={setTtsProvider}
                      className="flex flex-col gap-2"
                    >
                      {TTS_PROVIDERS.map((p) => (
                        <div key={p.id} className="flex items-center gap-2">
                          <RadioGroupItem value={p.id} id={`tts-${p.id}`} />
                          <Label htmlFor={`tts-${p.id}`} className="font-normal">
                            {p.label}
                          </Label>
                        </div>
                      ))}
                    </RadioGroup>
                  </div>

                  <div className="flex flex-col gap-2">
                    <Label>Voice</Label>
                    <Select value={voice} onValueChange={setVoice}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {["Male", "Female", "Neutral"].map((group) => (
                          <div key={group}>
                            <p className="px-2 py-1 text-xs font-medium text-muted-foreground">
                              {group}
                            </p>
                            {VOICES.filter((v) => v.group === group).map((v) => (
                              <SelectItem key={v.id} value={v.id}>
                                {v.label}
                              </SelectItem>
                            ))}
                          </div>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                      <Label>Speech Speed</Label>
                      <span className="text-sm text-muted-foreground">{speed.toFixed(2)}×</span>
                    </div>
                    <Slider
                      min={0.8}
                      max={1.5}
                      step={0.05}
                      value={[speed]}
                      onValueChange={([v]) => setSpeed(v)}
                    />
                  </div>

                  <div className="flex flex-col gap-2">
                    <Label>Expressiveness</Label>
                    <Segmented
                      value={expressiveness}
                      onChange={(v) => setExpressiveness(v)}
                      options={[
                        { value: "natural", label: "Natural" },
                        { value: "expressive", label: "Expressive" },
                        { value: "dramatic", label: "Dramatic" },
                      ]}
                    />
                  </div>
                </TabsContent>

                <TabsContent value="look" className="pt-1">
                  <CustomizePanel
                    value={render}
                    onChange={(patch) => setRender((r) => ({ ...r, ...patch }))}
                  />
                </TabsContent>
              </Tabs>

              <div className="flex flex-col gap-3">
                <Label>Gameplay Background</Label>
                <RadioGroup
                  value={bgSource}
                  onValueChange={(v) => setBgSource(v as "library" | "user")}
                  className="flex gap-4"
                >
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="library" id="bgsrc-library" />
                    <Label htmlFor="bgsrc-library" className="font-normal">
                      Library
                    </Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="user" id="bgsrc-user" />
                    <Label htmlFor="bgsrc-user" className="font-normal">
                      My footage
                    </Label>
                  </div>
                </RadioGroup>

                {bgSource === "library" ? (
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
                ) : (
                  <UserBackgroundPanel value={backgroundId || undefined} onChange={setBackgroundId} />
                )}
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

              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <Label>Keep the finished file?</Label>
                  {!canRetain && (
                    <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                      premium
                    </Badge>
                  )}
                </div>
                <RadioGroup
                  value={retention}
                  onValueChange={(v) => setRetention(v as "ephemeral" | "retain")}
                  className="flex gap-4"
                >
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="ephemeral" id={`ret-${"ephemeral"}`} />
                    <Label htmlFor={`ret-${"ephemeral"}`} className="font-normal">
                      Auto-delete (~15 min)
                    </Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="retain" id="ret-retain" disabled={!canRetain} />
                    <Label htmlFor="ret-retain" className={`font-normal ${canRetain ? "" : "opacity-50"}`}>
                      Keep until I delete
                    </Label>
                  </div>
                </RadioGroup>
              </div>

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
    </>
  );
}

function JobStatusTracker({ jobId, onReset }: { jobId: string; onReset: () => void }) {
  const isTerminal = (s?: string) => s === "DONE" || s === "FAILED";

  // Exponential backoff: 1.5s → 2.25s → 3.4s … capped at 12s. Resets whenever
  // the status changes (a sign of progress) and stops entirely on terminal.
  const pollsRef = useRef(0);
  const lastStatusRef = useRef<string | undefined>(undefined);

  const { data: job } = useSWR<Job>(`/jobs/${jobId}`, fetcher, {
    refreshInterval: (latest) => {
      if (latest && isTerminal(latest.status)) return 0;
      return Math.min(1500 * Math.pow(1.5, pollsRef.current++), 12000);
    },
    revalidateOnFocus: true,
    onSuccess: (d) => {
      if (d.status !== lastStatusRef.current) {
        pollsRef.current = 0;
        lastStatusRef.current = d.status;
      }
    },
  });

  const status = job?.status ?? "QUEUED";
  const pct = STATUS_STEPS[status] ?? 0;

  if (status === "DONE") {
    return (
      <Card>
        <CardContent className="flex flex-col gap-3 p-6">
          <p className="font-medium text-center">Your reel is ready!</p>
          <Button className="w-full" onClick={() => downloadReel(jobId, "reel.mp4")}>
            Download MP4
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
