"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import useSWR from "swr";
import { toast } from "sonner";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronRight,
  Download,
  Loader2,
  Play,
  Scissors,
  TriangleAlert,
  X,
} from "lucide-react";
import { api, downloadClip } from "@/lib/api";
import type { Clip, ClipJob, ClipType } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const fetcher = (url: string) => api.get(url).then((r) => r.data);

// ── Pipeline progress ────────────────────────────────────────────────────────

const STAGES = [
  "DOWNLOADING",
  "EXTRACTING_AUDIO",
  "TRANSCRIBING",
  "ANALYSING",
  "CLIPPING",
  "DONE",
] as const;

const STAGE_LABELS: Record<string, string> = {
  DOWNLOADING: "Downloading",
  EXTRACTING_AUDIO: "Extracting audio",
  TRANSCRIBING: "Transcribing",
  ANALYSING: "Analysing",
  CLIPPING: "Clipping",
  DONE: "Done",
  FAILED: "Failed",
};

function PipelineProgress({
  status,
  clipCount,
}: {
  status: string;
  clipCount: number;
}) {
  if (status === "QUEUED") {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Waiting in queue…
      </div>
    );
  }

  if (status === "FAILED") {
    return (
      <div className="flex items-center gap-2 text-sm text-destructive">
        <TriangleAlert className="size-4" />
        Processing failed
      </div>
    );
  }

  const currentIdx = STAGES.indexOf(status as (typeof STAGES)[number]);

  return (
    <div className="flex flex-wrap items-center gap-1 text-sm">
      {STAGES.map((stage, idx) => {
        const done = idx < currentIdx || status === "DONE";
        const active = idx === currentIdx && status !== "DONE";
        const future = idx > currentIdx;

        return (
          <div key={stage} className="flex items-center gap-1">
            {idx > 0 && (
              <ChevronRight className="size-3 text-muted-foreground/40" />
            )}
            <span
              className={cn(
                "flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors",
                done &&
                  "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
                active && "bg-primary/10 text-primary",
                future && "text-muted-foreground/50",
              )}
            >
              {done && <Check className="size-3" />}
              {active && <Loader2 className="size-3 animate-spin" />}
              {stage === "CLIPPING" && active
                ? `Clipping (${clipCount}/10)`
                : STAGE_LABELS[stage]}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Clip type labels + colours ───────────────────────────────────────────────

const CLIP_TYPE_META: Record<
  string,
  { label: string; className: string }
> = {
  opinion_bomb: {
    label: "Opinion bomb",
    className: "bg-rose-500/10 text-rose-500 dark:text-rose-400",
  },
  story_peak: {
    label: "Story peak",
    className: "bg-violet-500/10 text-violet-500 dark:text-violet-400",
  },
  value_drop: {
    label: "Value drop",
    className: "bg-sky-500/10 text-sky-500 dark:text-sky-400",
  },
  pattern_interrupt: {
    label: "Pattern interrupt",
    className: "bg-amber-500/10 text-amber-500 dark:text-amber-400",
  },
  quotable_moment: {
    label: "Quotable",
    className: "bg-emerald-500/10 text-emerald-500 dark:text-emerald-400",
  },
  emotional_peak: {
    label: "Emotional peak",
    className: "bg-pink-500/10 text-pink-500 dark:text-pink-400",
  },
};

function ClipTypeChip({ type }: { type: string }) {
  const meta = CLIP_TYPE_META[type] ?? {
    label: type.replace(/_/g, " "),
    className: "bg-muted text-muted-foreground",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
        meta.className,
      )}
    >
      {meta.label}
    </span>
  );
}

function EngagementScore({ score }: { score: number }) {
  const colour =
    score >= 8
      ? "text-emerald-500"
      : score >= 5
        ? "text-amber-500"
        : "text-rose-500";
  return (
    <span
      className={cn(
        "inline-flex h-7 w-7 items-center justify-center rounded-full bg-muted text-xs font-bold tabular-nums",
        colour,
      )}
      title={`Engagement score: ${score}/10`}
    >
      {score}
    </span>
  );
}

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatTimestamp(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

// ── Clip card ────────────────────────────────────────────────────────────────

const DISMISS_DELAY_MS = 5000;

function ClipCard({
  clip,
  jobId,
  rank,
  onDeleted,
}: {
  clip: Clip;
  jobId: string;
  rank: number;
  onDeleted: (clipId: string) => void;
}) {
  const [downloading, setDownloading] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function handleDownload() {
    setDownloading(true);
    try {
      await downloadClip(jobId, clip.id, clip.index);
    } catch {
      toast.error("Download failed");
    } finally {
      setDownloading(false);
    }
  }

  function handleDismiss() {
    setDismissed(true);
    // Show undo toast — if user doesn't undo within DISMISS_DELAY_MS, delete for real
    const toastId = toast("Clip removed", {
      duration: DISMISS_DELAY_MS,
      action: {
        label: "Undo",
        onClick: () => {
          if (timerRef.current) clearTimeout(timerRef.current);
          setDismissed(false);
          toast.dismiss(toastId);
        },
      },
    });
    timerRef.current = setTimeout(async () => {
      try {
        await api.delete(`/clip-jobs/${jobId}/clips/${clip.id}`);
        onDeleted(clip.id);
      } catch {
        // Silently fail — clip already gone from UI
      }
    }, DISMISS_DELAY_MS);
  }

  if (dismissed) return null;

  return (
    <div className="group relative flex flex-col overflow-hidden rounded-xl border border-border/60 bg-card transition-colors hover:border-border">
      {/* Thumbnail / preview area */}
      <div className="relative aspect-[9/16] w-full overflow-hidden bg-muted/40">
        {clip.status === "pending" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted-foreground">
            <Loader2 className="size-6 animate-spin" />
            <span className="text-xs">Processing…</span>
          </div>
        )}
        {clip.status === "failed" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-destructive/70">
            <TriangleAlert className="size-6" />
            <span className="text-xs">Failed</span>
          </div>
        )}
        {clip.status === "done" && (
          <>
            {clip.thumbnail_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={clip.thumbnail_url}
                alt={`Clip ${clip.index + 1} thumbnail`}
                className="absolute inset-0 h-full w-full object-cover"
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-muted to-muted/30">
                <Scissors className="size-8 text-muted-foreground/30" />
              </div>
            )}
            {/* Play overlay */}
            <div className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-all group-hover:bg-black/30 group-hover:opacity-100">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/90 shadow-lg">
                <Play className="size-5 fill-current text-black" />
              </div>
            </div>
          </>
        )}

        {/* Rank badge */}
        <div className="absolute left-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-xs font-bold text-white backdrop-blur-sm">
          {rank}
        </div>

        {/* Engagement score */}
        <div className="absolute right-2 top-2">
          <EngagementScore score={clip.engagement_score} />
        </div>

        {/* Duration badge */}
        {clip.duration_seconds != null && (
          <div className="absolute bottom-2 right-2 rounded-md bg-black/60 px-1.5 py-0.5 text-[11px] font-medium text-white backdrop-blur-sm">
            {formatDuration(clip.duration_seconds)}
          </div>
        )}

        {/* Timestamp range */}
        <div className="absolute bottom-2 left-2 rounded-md bg-black/60 px-1.5 py-0.5 text-[11px] text-white/80 backdrop-blur-sm">
          {formatTimestamp(clip.start_seconds)} →{" "}
          {formatTimestamp(clip.end_seconds)}
        </div>
      </div>

      {/* Content */}
      <div className="flex flex-1 flex-col gap-3 p-4">
        {/* Clip type */}
        <ClipTypeChip type={clip.clip_type} />

        {/* Hook */}
        <p className="line-clamp-3 text-sm font-medium leading-snug">
          {clip.hook || "—"}
        </p>

        {/* Reason */}
        {clip.reason && (
          <p className="line-clamp-2 text-xs text-muted-foreground leading-relaxed">
            {clip.reason}
          </p>
        )}

        {/* Footer actions */}
        <div className="mt-auto flex items-center justify-between gap-2 pt-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
            onClick={handleDismiss}
            title="Remove this clip (5 s undo)"
          >
            <X className="size-3" />
            Dismiss
          </Button>

          {clip.status === "done" && (
            <Button
              size="sm"
              className="h-7 gap-1.5 px-3 text-xs"
              onClick={handleDownload}
              disabled={downloading}
            >
              {downloading ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Download className="size-3" />
              )}
              Download
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

const TERMINAL = ["DONE", "FAILED"];

export default function ClipJobPage() {
  const { jobId } = useParams<{ jobId: string }>();

  const { data: job, isLoading } = useSWR<ClipJob>(
    jobId ? `/clip-jobs/${jobId}` : null,
    fetcher,
    {
      refreshInterval: (data) =>
        data && !TERMINAL.includes(data.status) ? 3000 : 0,
    },
  );

  if (isLoading) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-8 md:px-8 space-y-6">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-10 w-64" />
        <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {Array.from({ length: 10 }).map((_, i) => (
            <Skeleton key={i} className="aspect-[9/16] rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (!job) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-8 md:px-8">
        <p className="text-muted-foreground">Clip job not found.</p>
        <Button variant="ghost" size="sm" asChild className="mt-4">
          <Link href="/dashboard/clips">
            <ArrowLeft className="size-4" />
            Back to Clip Engine
          </Link>
        </Button>
      </div>
    );
  }

  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());

  function handleClipDeleted(clipId: string) {
    setDeletedIds((prev) => new Set([...prev, clipId]));
  }

  const visibleClips = job.clips.filter((c) => !deletedIds.has(c.id));
  const doneClips = visibleClips.filter((c) => c.status === "done");
  const pendingClips = visibleClips.filter((c) => c.status === "pending");
  const failedClips = visibleClips.filter((c) => c.status === "failed");

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 md:px-8">
      {/* Breadcrumb */}
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <Link href="/dashboard/clips">
          <ArrowLeft className="size-4" />
          Clip Engine
        </Link>
      </Button>

      {/* Job header */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {job.source_label || "Untitled"}
            </h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {new Date(job.created_at).toLocaleDateString("en-GB", {
                weekday: "short",
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </p>
          </div>

          {job.status === "DONE" && (
            <div className="flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1.5 text-sm font-medium text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="size-4" />
              {job.clip_count} clips ready
            </div>
          )}
        </div>

        {/* Pipeline progress */}
        <PipelineProgress status={job.status} clipCount={job.clip_count} />

        {/* Error */}
        {job.error_message && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {job.error_message}
          </div>
        )}
      </div>

      {/* Clips grid */}
      {job.clips.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
              Clips — ranked by engagement
            </h2>
            {failedClips.length > 0 && (
              <span className="text-xs text-destructive/70">
                {failedClips.length} failed to render
              </span>
            )}
          </div>

          <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {visibleClips.map((clip, i) => (
              <ClipCard key={clip.id} clip={clip} jobId={job.id} rank={i + 1} onDeleted={handleClipDeleted} />
            ))}
          </div>
        </div>
      )}

      {/* Waiting for clips to appear */}
      {job.clips.length === 0 && !TERMINAL.includes(job.status) && (
        <div className="flex flex-col items-center gap-3 py-20 text-center text-muted-foreground">
          <Loader2 className="size-8 animate-spin" />
          <p className="text-sm">
            {job.status === "ANALYSING"
              ? "AI is selecting the best moments…"
              : job.status === "TRANSCRIBING"
                ? "Transcribing your video…"
                : "Processing…"}
          </p>
        </div>
      )}
    </div>
  );
}
