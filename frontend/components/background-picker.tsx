"use client";

import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { api, uploadBackground } from "@/lib/api";
import type { UserBackgroundList } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const fetcher = (url: string) => api.get(url).then((r) => r.data);

interface Props {
  value: string | undefined;
  onChange: (backgroundId: string) => void;
}

/**
 * "My footage" panel: pick an uploaded background, upload new footage with
 * per-part progress, preview via short-lived presigned URLs (held in memory
 * only), and delete.
 */
export function UserBackgroundPanel({ value, onChange }: Props) {
  const { data, mutate } = useSWR<UserBackgroundList>("/backgrounds", fetcher, {
    refreshInterval: (latest) =>
      latest?.items.some((b) => b.status === "pending" || b.status === "processing") ? 3000 : 0,
  });

  const items = data?.items ?? [];
  const ready = items.filter((b) => b.status === "ready");
  const busy = items.some((b) => b.status === "pending" || b.status === "processing");

  const [phase, setPhase] = useState<"idle" | "uploading" | "processing">("idle");
  const [progress, setProgress] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const videoUrlRef = useRef<string | null>(null);

  // Presigned preview URLs are revoked whenever they are replaced or unmounted.
  function releasePreview() {
    if (videoUrlRef.current) {
      URL.revokeObjectURL(videoUrlRef.current);
      videoUrlRef.current = null;
    }
  }
  useEffect(() => releasePreview, []);

  async function startUpload(file: File | undefined) {
    if (!file) return;
    setProgress(0);
    try {
      const bg = await uploadBackground(file, {
        onProgress: setProgress,
        onPhase: setPhase,
      });
      if (bg.status === "ready") toast.success("Footage ready");
      else toast.error(bg.error_message || "Processing failed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setPhase("idle");
      setProgress(0);
      if (inputRef.current) inputRef.current.value = "";
      mutate();
    }
  }

  async function preview(bgId: string) {
    try {
      releasePreview();
      const { url } = await api
        .get<{ url: string; expires_in: number }>(`/backgrounds/${bgId}/preview-url`)
        .then((r) => r.data);
      videoUrlRef.current = url;
      window.open(url, "_blank", "noopener");
    } catch {
      toast.error("Preview unavailable");
    }
  }

  async function remove(bgId: string) {
    try {
      await api.delete(`/backgrounds/${bgId}`);
      if (value === bgId) onChange("");
      mutate();
    } catch {
      toast.error("Delete failed");
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
      {busy && (
        <p className="text-[13px] text-muted-foreground">
          {phase === "uploading"
            ? `Uploading footage... ${Math.round(progress * 100)}%`
            : phase === "processing"
              ? "Transcoding footage..."
              : "Processing uploads..."}
        </p>
      )}

      {ready.length > 0 ? (
        <Select value={value ?? undefined} onValueChange={onChange}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Choose your footage" />
          </SelectTrigger>
          <SelectContent>
            {ready.map((bg) => (
              <SelectItem key={bg.id} value={bg.id}>
                {bg.label}
                {bg.duration_seconds ? ` · ${Math.round(bg.duration_seconds)}s` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        !busy && (
          <p className="text-[13px] text-muted-foreground">
            No footage yet — upload a vertical clip (30 s to 10 min).
          </p>
        )
      )}

      {items
        .filter((b) => b.status === "failed")
        .slice(0, 2)
        .map((b) => (
          <p key={b.id} className="truncate text-[13px] text-destructive" title={b.error_message ?? ""}>
            {b.label}: {b.error_message}
          </p>
        ))}

      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          accept="video/mp4,video/quicktime,video/webm"
          className="hidden"
          onChange={(e) => startUpload(e.target.files?.[0])}
          disabled={phase !== "idle"}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={phase !== "idle"}
          onClick={() => inputRef.current?.click()}
        >
          Upload clip
        </Button>
        {value && (
          <>
            <Button type="button" size="sm" variant="ghost" onClick={() => preview(value)}>
              Preview
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={() => remove(value)}
            >
              Delete
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
