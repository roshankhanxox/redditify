"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeftRight, CheckCircle2, Download, Loader2, MoreVertical, Trash2 } from "lucide-react";
import { downloadReel } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { Job } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const TERMINAL = ["DONE", "FAILED"];

export const STATUS_VARIANT: Record<string, "default" | "destructive" | "secondary" | "outline"> = {
  DONE: "default",
  FAILED: "destructive",
  QUEUED: "outline",
  GENERATING_VOICEOVER: "secondary",
  TRANSCRIBING: "secondary",
  RENDERING_TITLE_CARD: "secondary",
  PICKING_GAMEPLAY: "secondary",
  COMPOSITING_VIDEO: "secondary",
  UPLOADING: "secondary",
};

function StatusBadge({ status }: { status: string }) {
  const processing = !TERMINAL.includes(status);
  return (
    <Badge variant={STATUS_VARIANT[status] ?? "outline"} className={processing ? "gap-1" : undefined}>
      {processing && <Loader2 className="size-3 animate-spin" />}
      {status === "GENERATING_VOICEOVER"
        ? "Voiceover"
        : status === "TRANSCRIBING"
          ? "Captions"
          : status === "RENDERING_TITLE_CARD"
            ? "Title card"
            : status === "PICKING_GAMEPLAY"
              ? "Background"
              : status === "COMPOSITING_VIDEO"
                ? "Rendering"
                : status === "UPLOADING"
                  ? "Finishing"
                  : status}
    </Badge>
  );
}

/** Live countdown for an ephemeral reel's remaining lifetime. */
export function ExpiryBadge({ iso }: { iso: string }) {
  const [label, setLabel] = useState("");

  useEffect(() => {
    const tick = () => {
      const ms = new Date(iso).getTime() - Date.now();
      if (ms <= 0) return setLabel("expired");
      const m = Math.floor(ms / 60000);
      const s = Math.floor((ms % 60000) / 1000);
      setLabel(`${m}:${String(s).padStart(2, "0")} left`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [iso]);

  return <Badge variant="outline">{label}</Badge>;
}

/**
 * Media box mirroring the reel's real 9:16 shape. Processing jobs get a
 * brand-tinted loader; finished ones show the poster frame via a persistent
 * <video preload="metadata"> that plays on hover (same mechanism as Library).
 * A processing→DONE transition flashes a brief success ring — page reloads
 * render plain cards.
 */
function Media({ job }: { job: Job }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [vidFailed, setVidFailed] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);

  if (job.status === "FAILED") {
    return (
      <div className="flex aspect-[9/16] items-center justify-center bg-destructive/5">
        <span className="text-[13px] text-destructive/70">Failed</span>
      </div>
    );
  }

  if (!TERMINAL.includes(job.status)) {
    return (
      <div className="flex aspect-[9/16] flex-col items-center justify-center gap-2 bg-brand/[0.06]">
        <Loader2 className="size-6 animate-spin text-brand" />
        <span className="text-[13px] text-muted-foreground">Rendering…</span>
      </div>
    );
  }

  if (job.preview_url && !vidFailed) {
    return (
      <video
        ref={videoRef}
        src={job.preview_url}
        poster={job.thumbnail_url ?? undefined}
        muted
        loop
        playsInline
        preload="metadata"
        onError={() => setVidFailed(true)}
        onMouseEnter={() => void videoRef.current?.play()}
        onMouseLeave={() => {
          const v = videoRef.current;
          if (v) {
            v.pause();
            v.currentTime = 0;
          }
        }}
        className="aspect-[9/16] w-full object-cover"
      />
    );
  }

  if (job.thumbnail_url && !imgFailed) {
    return (
      <img
        src={job.thumbnail_url}
        alt=""
        loading="lazy"
        onError={() => setImgFailed(true)}
        className="aspect-[9/16] w-full object-cover"
      />
    );
  }

  return (
    <div className="flex aspect-[9/16] items-center justify-center bg-muted">
      <span className="text-[13px] text-muted-foreground/60">no preview</span>
    </div>
  );
}

interface ReelActions {
  onOpen: (job: Job) => void;
  onDelete: (job: Job) => void;
}

function ActionMenu({ job, actions }: { job: Job; actions: ReelActions }) {
  const playable = job.status === "DONE" && !!job.result_url;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Actions for ${job.title}`}
          onClick={(e) => e.preventDefault()}
        >
          <MoreVertical />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem disabled={!playable} onSelect={() => actions.onOpen(job)}>
          Open player
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!playable}
          onSelect={() => downloadReel(job.id, `${job.title || "reel"}.mp4`)}
        >
          <Download />
          Download MP4
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={`/dashboard/create/story?from=${job.id}`}>
            <ArrowLeftRight />
            Regenerate
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={() => actions.onDelete(job)}>
          <Trash2 />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function useDoneFlash(status: string): boolean {
  const prev = useRef<string | null>(null);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    const before = prev.current;
    prev.current = status;
    // No memory across mounts: a fresh page load starts with prev=null and
    // renders an ordinary card regardless of status.
    if (!before || before === status) return;
    if (!TERMINAL.includes(before) && status === "DONE") {
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 5000);
      return () => clearTimeout(t);
    }
  }, [status]);

  return flash;
}

export function ReelCard({ job, actions }: { job: Job; actions: ReelActions }) {
  const justFinished = useDoneFlash(job.status);
  const processing = !TERMINAL.includes(job.status);

  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-lg border bg-card transition-colors hover:border-ring",
        processing && "border-brand/40",
        justFinished && "ring-2 ring-emerald-500/70 border-emerald-500/50",
      )}
    >
      <button
        type="button"
        aria-label={`Open ${job.title}`}
        onClick={() =>
          job.status === "DONE" && !!job.result_url && actions.onOpen(job)
        }
        className="block w-full cursor-pointer text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Media job={job} />
      </button>

      {justFinished && (
        <div className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-emerald-500 px-2 py-0.5 text-xs font-medium text-white shadow-sm">
          <CheckCircle2 className="size-3.5" />
          Done
        </div>
      )}

      <div className="flex flex-col gap-1.5 p-3">
        <p className="truncate text-sm font-medium" title={job.title}>
          {job.title || "Untitled reel"}
        </p>
        <div className="flex items-center gap-2 text-[13px] tabular-nums text-muted-foreground">
          <StatusBadge status={job.status} />
          {job.duration_seconds ? <span>{Math.round(job.duration_seconds)}s</span> : null}
          {job.status === "DONE" && job.result_url && job.retention === "ephemeral" && job.result_expires_at && (
            <ExpiryBadge iso={job.result_expires_at} />
          )}
          <span className="ml-auto whitespace-nowrap">{timeAgo(job.created_at)}</span>
        </div>
      </div>

      {!processing && (
        <div className="absolute right-1.5 top-1.5 rounded-md bg-background/80 opacity-0 backdrop-blur transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          <ActionMenu job={job} actions={actions} />
        </div>
      )}
    </div>
  );
}

export function ReelRow({ job, actions }: { job: Job; actions: ReelActions }) {
  const justFinished = useDoneFlash(job.status);
  const playableJob = job.status === "DONE" && !!job.result_url;
  return (
    <div
      className={cn(
        "flex items-center gap-4 border-b px-3 py-2.5 last:border-b-0 transition-colors",
        justFinished && "bg-emerald-500/5",
      )}
    >
      <div className="w-9 shrink-0 overflow-hidden rounded border bg-muted">
        <Media job={job} />
      </div>
      <div className="min-w-0 flex-1">
        <button
          type="button"
          className="block max-w-full cursor-pointer truncate text-left text-sm font-medium hover:underline"
          onClick={() => playableJob && actions.onOpen(job)}
        >
          {job.title || "Untitled reel"}
        </button>
        <p className="text-[13px] tabular-nums text-muted-foreground">{timeAgo(job.created_at)}</p>
      </div>
      <StatusBadge status={job.status} />
      <span className="hidden w-12 text-right text-sm tabular-nums text-muted-foreground sm:block">
        {job.duration_seconds ? `${Math.round(job.duration_seconds)}s` : "—"}
      </span>
      {job.status === "DONE" && job.result_url && job.retention === "ephemeral" && job.result_expires_at && (
        <ExpiryBadge iso={job.result_expires_at} />
      )}
      <ActionMenu job={job} actions={actions} />
    </div>
  );
}

// ------------------------------------------------------------------ helpers

function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
