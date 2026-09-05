"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { toast } from "sonner";
import {
  ArrowRight,
  Clapperboard,
  Loader2,
  Plus,
  Scissors,
  Trash2,
} from "lucide-react";
import { api } from "@/lib/api";
import type { ClipJob, ClipJobList } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { NewClipJobDialog } from "@/components/clips/new-clip-job-dialog";

const fetcher = (url: string) => api.get(url).then((r) => r.data);

const TERMINAL = ["DONE", "FAILED"];

const STAGE_LABELS: Record<string, string> = {
  QUEUED: "Queued",
  DOWNLOADING: "Downloading",
  EXTRACTING_AUDIO: "Extracting audio",
  TRANSCRIBING: "Transcribing",
  ANALYSING: "Analysing",
  CLIPPING: "Clipping",
  DONE: "Done",
  FAILED: "Failed",
};

function StatusBadge({ status }: { status: string }) {
  const processing = !TERMINAL.includes(status);
  const variant =
    status === "DONE"
      ? "default"
      : status === "FAILED"
        ? "destructive"
        : "secondary";
  return (
    <Badge variant={variant} className={processing ? "gap-1.5" : ""}>
      {processing && <Loader2 className="size-3 animate-spin" />}
      {STAGE_LABELS[status] ?? status}
    </Badge>
  );
}

function ClipJobCard({
  job,
  onDelete,
}: {
  job: ClipJob;
  onDelete: (id: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const isTerminal = TERMINAL.includes(job.status);

  return (
    <>
      <div className="group relative flex flex-col gap-4 rounded-xl border border-border/60 bg-card p-5 transition-colors hover:border-border">
        {/* Header row */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium leading-snug">
              {job.source_label || "Untitled"}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {new Date(job.created_at).toLocaleDateString("en-GB", {
                day: "numeric",
                month: "short",
                year: "numeric",
              })}
            </p>
          </div>
          <StatusBadge status={job.status} />
        </div>

        {/* Stats row */}
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Scissors className="size-3.5" />
            {job.status === "DONE"
              ? `${job.clip_count} clip${job.clip_count !== 1 ? "s" : ""}`
              : job.status === "CLIPPING"
                ? `${job.clip_count} of 10 clips done`
                : "—"}
          </span>
        </div>

        {/* Error */}
        {job.error_message && (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {job.error_message}
          </p>
        )}

        {/* Actions */}
        <div className="flex items-center justify-between gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => setConfirming(true)}
          >
            <Trash2 className="size-3.5" />
            Delete
          </Button>
          {isTerminal && job.status === "DONE" && (
            <Button variant="outline" size="sm" asChild>
              <Link href={`/dashboard/clips/${job.id}`}>
                View clips
                <ArrowRight className="size-3.5" />
              </Link>
            </Button>
          )}
          {!isTerminal && (
            <Button variant="outline" size="sm" asChild>
              <Link href={`/dashboard/clips/${job.id}`}>
                Track progress
                <ArrowRight className="size-3.5" />
              </Link>
            </Button>
          )}
        </div>
      </div>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete clip job?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete all {job.clip_count} clips. This
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                setConfirming(false);
                onDelete(job.id);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default function ClipsPage() {
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data, isLoading, mutate } = useSWR<ClipJobList>(
    "/clip-jobs?per_page=20",
    fetcher,
    {
      refreshInterval: (data) => {
        const hasActive = data?.items.some((j) => !TERMINAL.includes(j.status));
        return hasActive ? 4000 : 0;
      },
    },
  );

  async function handleDelete(id: string) {
    try {
      await api.delete(`/clip-jobs/${id}`);
      toast.success("Clip job deleted");
      mutate();
    } catch {
      toast.error("Failed to delete clip job");
    }
  }

  async function handleCreated(jobId: string) {
    setDialogOpen(false);
    toast.success("Analysis started — your clips will be ready shortly");
    mutate();
  }

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-4 py-8 md:px-8">
      {/* Page header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Clip Engine</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Upload a video, let AI pick the best moments, get 10 ready-to-post
            clips.
          </p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="size-4" />
          New Analysis
        </Button>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-44 rounded-xl" />
          ))}
        </div>
      ) : !data?.items.length ? (
        <Empty>
          <EmptyMedia>
            <Scissors className="size-8 text-muted-foreground" />
          </EmptyMedia>
          <EmptyHeader>
            <EmptyTitle>No clip jobs yet</EmptyTitle>
            <EmptyDescription>
              Upload a long-form video and the AI will pull out the 10 most
              engaging moments as short-form clips.
            </EmptyDescription>
          </EmptyHeader>
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="size-4" />
            Start your first analysis
          </Button>
        </Empty>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.items.map((job) => (
            <ClipJobCard key={job.id} job={job} onDelete={handleDelete} />
          ))}
        </div>
      )}

      <NewClipJobDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onCreated={handleCreated}
      />
    </div>
  );
}
