"use client";

import { useState } from "react";
import useSWR from "swr";
import { Loader2, Upload, Video } from "lucide-react";
import { api, uploadBackground } from "@/lib/api";
import type { UserBackground, UserBackgroundList } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const fetcher = (url: string) => api.get(url).then((r) => r.data);

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (jobId: string) => void;
}

type Phase = "select" | "uploading" | "processing" | "starting";

function formatSize(bytes: number | null) {
  if (!bytes) return "";
  const mb = bytes / 1024 / 1024;
  return mb >= 1000 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(0)} MB`;
}

function formatDuration(seconds: number | null) {
  if (!seconds) return "";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function NewClipJobDialog({ open, onOpenChange, onCreated }: Props) {
  const [phase, setPhase] = useState<Phase>("select");
  const [selected, setSelected] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadPhase, setUploadPhase] = useState<"uploading" | "processing">("uploading");
  const [captionsEnabled, setCaptionsEnabled] = useState(true);

  const { data: bgData } = useSWR<UserBackgroundList>(
    open ? "/backgrounds?kind=video&per_page=50" : null,
    fetcher,
  );

  const readyBackgrounds = (bgData?.items ?? []).filter(
    (b) => b.status === "ready",
  );

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setPhase("uploading");
    setUploadProgress(0);

    try {
      const bg = await uploadBackground(file, {
        onPhase: (p) => {
          setUploadPhase(p);
          if (p === "processing") setPhase("processing");
        },
        onProgress: (fraction) => setUploadProgress(Math.round(fraction * 100)),
      });

      if (bg.status !== "ready") {
        throw new Error(bg.status === "failed" ? "Processing failed" : "Processing timed out");
      }

      setSelected(bg.id);
      setPhase("select");
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Upload failed");
      setPhase("select");
    }
  }

  async function handleStart() {
    if (!selected) return;
    setPhase("starting");
    try {
      const { data } = await api.post<{ clip_job_id: string }>("/clip-jobs", {
        background_id: selected,
        settings: { captions_enabled: captionsEnabled },
      });
      onCreated(data.clip_job_id);
      // Reset state for next open
      setSelected(null);
      setPhase("select");
    } catch {
      alert("Failed to start analysis");
      setPhase("select");
    }
  }

  function handleClose() {
    if (phase === "uploading" || phase === "processing") return;
    onOpenChange(false);
    setTimeout(() => {
      setSelected(null);
      setPhase("select");
    }, 300);
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New clip analysis</DialogTitle>
          <DialogDescription>
            Pick a video from your library or upload a new one. The AI will
            analyse it and generate up to 10 short-form clips.
          </DialogDescription>
        </DialogHeader>

        {phase === "uploading" && (
          <div className="space-y-3 py-4">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Uploading…</span>
              <span className="font-medium tabular-nums">{uploadProgress}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all duration-200"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
          </div>
        )}

        {phase === "processing" && (
          <div className="flex items-center gap-3 py-6 text-sm text-muted-foreground">
            <Loader2 className="size-5 animate-spin shrink-0" />
            Transcoding video for analysis… this takes a moment.
          </div>
        )}

        {(phase === "select" || phase === "starting") && (
          <div className="space-y-4">
            {/* Upload new */}
            <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-border/60 px-4 py-6 text-center transition-colors hover:border-primary/50 hover:bg-muted/30">
              <Upload className="size-6 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Upload a new video</p>
                <p className="text-xs text-muted-foreground">MP4, MOV up to 500 MB</p>
              </div>
              <input
                type="file"
                accept="video/*"
                className="sr-only"
                onChange={handleFileUpload}
              />
            </label>

            {/* Or pick from library */}
            {readyBackgrounds.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Or pick from your library
                </p>
                <div className="max-h-52 space-y-1.5 overflow-y-auto pr-1">
                  {readyBackgrounds.map((bg) => (
                    <button
                      key={bg.id}
                      type="button"
                      onClick={() => setSelected(selected === bg.id ? null : bg.id)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
                        selected === bg.id
                          ? "border-primary/60 bg-primary/5"
                          : "border-border/60 hover:border-border hover:bg-muted/30",
                      )}
                    >
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted">
                        <Video className="size-4 text-muted-foreground" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{bg.label || "Untitled"}</p>
                        <p className="text-xs text-muted-foreground">
                          {[
                            bg.duration_seconds ? formatDuration(bg.duration_seconds) : null,
                            bg.file_size_bytes ? formatSize(bg.file_size_bytes) : null,
                            bg.resolution,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      </div>
                      {selected === bg.id && (
                        <div className="h-4 w-4 shrink-0 rounded-full bg-primary" />
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Caption toggle */}
            <div className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2.5">
              <div>
                <p className="text-sm font-medium">Captions</p>
                <p className="text-xs text-muted-foreground">
                  Burn synced subtitles onto each clip
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCaptionsEnabled((v) => !v)}
                className={cn(
                  "relative h-5 w-9 rounded-full transition-colors",
                  captionsEnabled ? "bg-primary" : "bg-muted",
                )}
              >
                <span
                  className={cn(
                    "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
                    captionsEnabled ? "translate-x-4" : "translate-x-0.5",
                  )}
                />
              </button>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={handleClose} disabled={phase === "uploading" || phase === "processing"}>
            Cancel
          </Button>
          <Button
            onClick={handleStart}
            disabled={!selected || phase === "starting" || phase === "uploading" || phase === "processing"}
          >
            {phase === "starting" && <Loader2 className="size-4 animate-spin" />}
            Start analysis
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
