"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeftRight, Download, MoreVertical, Trash2 } from "lucide-react";
import { downloadReel } from "@/lib/api";
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
  return (
    <Badge variant={STATUS_VARIANT[status] ?? "outline"}>{status}</Badge>
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

function Thumb({ job }: { job: Job }) {
  const [failed, setFailed] = useState(false);
  if (!job.thumbnail_url || failed || job.status !== "DONE") {
    return (
      <div className="flex aspect-[9/16] items-center justify-center bg-muted text-[13px] text-muted-foreground/60">
        {job.status === "DONE" ? "no preview" : job.status}
      </div>
    );
  }
  return (
    <img
      src={job.thumbnail_url}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
      className="aspect-[9/16] w-full object-cover"
    />
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

export function ReelCard({ job, actions }: { job: Job; actions: ReelActions }) {
  return (
    <div className="group relative overflow-hidden rounded-lg border bg-card transition-colors hover:border-ring">
      <button
        type="button"
        aria-label={`Open ${job.title}`}
        onClick={() => playable(job) && actions.onOpen(job)}
        className="block w-full cursor-pointer text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Thumb job={job} />
      </button>
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
      <div className="absolute right-1.5 top-1.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 rounded-md bg-background/80 backdrop-blur">
        <ActionMenu job={job} actions={actions} />
      </div>
    </div>
  );
}

export function ReelRow({ job, actions }: { job: Job; actions: ReelActions }) {
  return (
    <div className="flex items-center gap-4 border-b px-3 py-2.5 last:border-b-0">
      <div className="w-9 shrink-0 overflow-hidden rounded border bg-muted">
        <Thumb job={job} />
      </div>
      <div className="min-w-0 flex-1">
        <button
          type="button"
          className="block max-w-full cursor-pointer truncate text-left text-sm font-medium hover:underline"
          onClick={() => playable(job) && actions.onOpen(job)}
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

function playable(job: Job) {
  return job.status === "DONE" && !!job.result_url;
}

function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
