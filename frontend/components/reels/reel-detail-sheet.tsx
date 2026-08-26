"use client";

import { ArrowLeftRight, Download, Trash2 } from "lucide-react";
import Link from "next/link";
import { downloadReel } from "@/lib/api";
import type { Job } from "@/lib/types";
import { VOICES } from "@/lib/voices";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ExpiryBadge, STATUS_VARIANT } from "@/components/reels/reel-card";
import { SCENE_LABELS } from "@/lib/scenes";

interface Props {
  job: Job | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDelete: (job: Job) => void;
}

export function ReelDetailSheet({ job, open, onOpenChange, onDelete }: Props) {
  if (!job) return null;
  const playable = job.status === "DONE" && !!job.result_url;
  const st = (job.settings ?? {}) as Record<string, unknown>;
  const voiceLabel = VOICES.find((v) => v.id === st.voice)?.label ?? String(st.voice ?? "—");
  // Regenerate must land back in the template the reel was made with.
  const regenerateHref = `/dashboard/create/${st.template === "meme" ? "meme" : "story"}?from=${job.id}`;
  const captionSummary = st.captions_enabled
    ? `${st.caption_mode === "static" ? "Static · typed" : "Synced"} · ${String(st.caption_font_size ?? 96)}px · ${String(st.caption_color ?? "white")}`
    : "Off";
  const isMeme = st.template === "meme";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-y-auto sm:max-w-md">
        <SheetHeader className="gap-1 text-left">
          <SheetTitle className="pr-8 font-heading text-xl font-semibold tracking-tight">
            {job.title || "Untitled reel"}
          </SheetTitle>
          <SheetDescription>
            Created {new Date(job.created_at).toLocaleString()}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-5 px-4 pb-6">
          {/* Player */}
          <div className="overflow-hidden rounded-lg border bg-black">
            {playable ? (
              <video
                key={job.id}
                controls
                preload="metadata"
                playsInline
                src={`/api/proxy/jobs/${job.id}/download?inline=1`}
                className="mx-auto aspect-[9/16] max-h-[55vh] w-auto max-w-full"
              />
            ) : (
              <div className="flex aspect-[9/16] items-center justify-center text-sm text-muted-foreground">
                {job.status === "FAILED" ? "Render failed" : "Still rendering…"}
              </div>
            )}
          </div>

          {/* Status row */}
          <div className="flex items-center gap-2">
            <Badge variant={STATUS_VARIANT[job.status] ?? "outline"}>{job.status}</Badge>
            {playable && job.retention === "ephemeral" && job.result_expires_at && (
              <ExpiryBadge iso={job.result_expires_at} />
            )}
          </div>

          {/* Settings summary */}
          <dl className="overflow-hidden rounded-lg border text-sm">
            <MetaRow label="Voice">{voiceLabel}</MetaRow>
            <MetaRow label="Engine">{String(st.tts_provider ?? "auto")}</MetaRow>
            <MetaRow label="Speed">
              {typeof st.speed === "number" ? `${st.speed.toFixed(2)}×` : "—"}
            </MetaRow>
            <MetaRow label="Captions">{captionSummary}</MetaRow>
            {isMeme ? (
              <MetaRow label="Scene">
                {SCENE_LABELS[String(st.scene_id ?? "")] ?? String(st.scene_id ?? "—")}
                {Array.isArray(st.characters) && st.characters.length > 0
                  ? ` · ${st.characters.length} character${st.characters.length > 1 ? "s" : ""}`
                  : ""}
              </MetaRow>
            ) : (
              <MetaRow label="Background">
                {st.gameplay_source === "user"
                  ? "My footage"
                  : `Library · ${String(st.gameplay_category ?? "any")}`}
              </MetaRow>
            )}
            <MetaRow label="Duration">
              {job.duration_seconds ? `${Math.round(job.duration_seconds)}s` : "—"}
            </MetaRow>
          </dl>

          {job.status === "FAILED" && job.error_message && (
            <p className="break-words rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-[13px] text-destructive">
              {job.error_message}
            </p>
          )}

          {/* Actions */}
          <div className="mt-auto flex flex-wrap gap-2">
            <Button
              disabled={!playable}
              onClick={() => downloadReel(job.id, `${job.title || "reel"}.mp4`)}
            >
              <Download />
              Download
            </Button>
            <Button variant="outline" asChild>
              <Link href={regenerateHref}>
                <ArrowLeftRight />
                Regenerate
              </Link>
            </Button>
            <Button variant="destructive" onClick={() => onDelete(job)}>
              <Trash2 />
              Delete
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-3 border-b px-3.5 py-2 last:border-b-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words tabular-nums">{children}</dd>
    </div>
  );
}
