"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { toast } from "sonner";
import {
  ArrowLeftRight,
  FolderOpen,
  ImageIcon,
  Loader2,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { api, uploadBackground } from "@/lib/api";
import type { UserBackground, UserBackgroundList } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreVertical, Play } from "lucide-react";
import { cn } from "@/lib/utils";

const fetcher = (url: string) => api.get(url).then((r) => r.data);

function fmtSize(bytes: number | null): string {
  if (!bytes) return "—";
  const mb = bytes / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(0)} MB`;
}

function StatusBadge({ status }: { status: UserBackground["status"] }) {
  if (status === "ready") return <Badge>Ready</Badge>;
  if (status === "failed") return <Badge variant="destructive">Failed</Badge>;
  return (
    <Badge variant="secondary" className="gap-1">
      <Loader2 className="size-3 animate-spin" />
      {status === "pending" ? "Queued" : "Processing"}
    </Badge>
  );
}

/** Hover-to-preview card. Presigned preview URLs are fetched lazily per clip
 *  and cached for the session; failures just disable the hover preview. */
function BackgroundCard({
  bg,
  onDelete,
}: {
  bg: UserBackground;
  onDelete: (bg: UserBackground) => void;
}) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [hovered, setHovered] = useState(false);

  const loadPreview = useCallback(async () => {
    if (previewUrl || bg.status !== "ready") return;
    try {
      const r = await api.get<{ url: string }>(`/backgrounds/${bg.id}/preview-url`);
      setPreviewUrl(r.data.url);
    } catch {
      /* preview unavailable — card stays static */
    }
  }, [previewUrl, bg.id, bg.status]);

  return (
    <Card className="group overflow-hidden pt-0">
      <div
        className="relative aspect-video w-full bg-muted"
        onMouseEnter={() => {
          setHovered(true);
          void loadPreview();
        }}
        onMouseLeave={() => setHovered(false)}
      >
        {previewUrl && hovered ? (
          <video
            src={previewUrl}
            autoPlay
            muted
            loop
            playsInline
            onError={() => setPreviewUrl(null)}
            className="size-full object-cover"
          />
        ) : (
          <div className="flex size-full items-center justify-center text-muted-foreground/40">
            {bg.status === "ready" ? (
              <Play className="size-6 opacity-0 transition-opacity group-hover:opacity-100" />
            ) : (
              <ImageIcon className="size-5" />
            )}
          </div>
        )}
      </div>
      <CardContent className="flex flex-col gap-2 p-3">
        <div className="flex items-start justify-between gap-2">
          <p className="min-w-0 truncate text-sm font-medium" title={bg.label}>
            {bg.label}
          </p>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${bg.label}`}>
                <MoreVertical />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild disabled={bg.status !== "ready"}>
                <Link href={`/dashboard/create/story?bg=${bg.id}`}>
                  <ArrowLeftRight />
                  Use in reel
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onSelect={() => onDelete(bg)}>
                <Trash2 />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={bg.status} />
          <span className="text-[13px] tabular-nums text-muted-foreground">
            {bg.duration_seconds ? `${Math.round(bg.duration_seconds)}s` : "—"} ·{" "}
            {bg.resolution ?? "—"} · {fmtSize(bg.file_size_bytes)}
          </span>
        </div>
        {bg.status === "failed" && bg.error_message && (
          <p className="line-clamp-2 text-[13px] text-destructive" title={bg.error_message}>
            {bg.error_message}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default function LibraryPage() {
  const { data, mutate } = useSWR<UserBackgroundList>("/backgrounds", fetcher, {
    refreshInterval: (latest) =>
      latest?.items.some((b) => b.status === "pending" || b.status === "processing")
        ? 3000
        : 0,
  });

  const items = data?.items ?? [];
  const readyCount = items.filter((b) => b.status === "ready").length;
  const max = data?.max_backgrounds;

  const [phase, setPhase] = useState<"idle" | "uploading" | "processing">("idle");
  const [progress, setProgress] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const startUpload = useCallback(
    async (file: File | undefined | null) => {
      if (!file || phase !== "idle") return;
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
    },
    [phase, mutate],
  );

  const [deleteTarget, setDeleteTarget] = useState<UserBackground | null>(null);
  function remove(id: string) {
    api
      .delete(`/backgrounds/${id}`)
      .then(() => {
        toast.success("Footage deleted");
        setDeleteTarget(null);
        mutate();
      })
      .catch(() => toast.error("Delete failed"));
  }

  return (
    <div className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
      <header className="mb-6">
        <h1 className="font-heading text-3xl font-semibold tracking-tight">Library</h1>
        <p className="mt-1 text-base text-muted-foreground">
          Your uploaded footage and images, managed in one place.
        </p>
      </header>

      <Tabs defaultValue="footage">
        <TabsList>
          <TabsTrigger value="footage">Footage</TabsTrigger>
          <TabsTrigger value="images">Images</TabsTrigger>
        </TabsList>

        {/* ------------------------------------------------------ footage */}
        <TabsContent value="footage" className="mt-5 flex flex-col gap-5">
          {/* Upload zone */}
          <div
            role="button"
            tabIndex={0}
            aria-label="Upload footage"
            onClick={() => phase === "idle" && inputRef.current?.click()}
            onKeyDown={(e) => e.key === "Enter" && phase === "idle" && inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              void startUpload(e.dataTransfer.files?.[0]);
            }}
            className={cn(
              "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-8 text-center transition-colors",
              dragOver ? "border-brand bg-brand/[0.04]" : "hover:border-ring",
              phase !== "idle" && "pointer-events-none opacity-70",
            )}
          >
            <input
              ref={inputRef}
              type="file"
              accept="video/mp4,video/quicktime,video/webm"
              className="hidden"
              onChange={(e) => void startUpload(e.target.files?.[0])}
              disabled={phase !== "idle"}
            />
            {phase === "uploading" ? (
              <>
                <UploadCloud className="size-5 text-brand" />
                <p className="text-sm font-medium">Uploading… {Math.round(progress * 100)}%</p>
                <Progress value={progress * 100} className="h-1.5 w-48" />
              </>
            ) : phase === "processing" ? (
              <>
                <Loader2 className="size-5 animate-spin text-brand" />
                <p className="text-sm font-medium">Transcoding footage…</p>
              </>
            ) : (
              <>
                <UploadCloud className="size-5 text-muted-foreground" />
                <p className="text-sm font-medium">
                  Drop a vertical clip here, or click to browse
                </p>
                <p className="text-[13px] text-muted-foreground">
                  MP4 / MOV / WebM · 30 s – 10 min recommended · auto-transcoded to 1080×1920
                </p>
              </>
            )}
          </div>

          {/* Quota line */}
          {max !== undefined && (
            <p className="text-[13px] tabular-nums text-muted-foreground">
              {readyCount} of {max} ready clips used
              {readyCount >= max && (
                <span className="text-destructive"> — limit reached, delete one first</span>
              )}
            </p>
          )}

          {/* Grid */}
          {items.length === 0 ? (
            <Empty className="border border-dashed">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <FolderOpen />
                </EmptyMedia>
                <EmptyTitle>No footage yet</EmptyTitle>
                <EmptyDescription>
                  Upload your first gameplay clip above — it becomes available in the
                  create form&rsquo;s &ldquo;My footage&rdquo; picker.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((bg) => (
                <BackgroundCard key={bg.id} bg={bg} onDelete={setDeleteTarget} />
              ))}
            </div>
          )}
        </TabsContent>

        {/* ------------------------------------------------------- images */}
        <TabsContent value="images" className="mt-5">
          <Empty className="border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ImageIcon />
              </EmptyMedia>
              <EmptyTitle>Images land with Meme Studio</EmptyTitle>
              <EmptyDescription>
                Uploading characters and full-bleed images arrives with Dashboard V2
                Phases 7–8, along with automatic background removal.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </TabsContent>
      </Tabs>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this footage?</AlertDialogTitle>
            <AlertDialogDescription>
              Permanently removes &ldquo;{deleteTarget?.label}&rdquo; and its files. Reels
              already rendered with it are unaffected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => deleteTarget && remove(deleteTarget.id)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
