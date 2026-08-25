"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { toast } from "sonner";
import { Clapperboard, LayoutGrid, List } from "lucide-react";
import type { JobList } from "@/lib/types";
import { api } from "@/lib/api";
import type { Job } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { ReelCard, ReelRow } from "@/components/reels/reel-card";
import { ReelDetailSheet } from "@/components/reels/reel-detail-sheet";
import { cn } from "@/lib/utils";

const fetcher = (url: string) => api.get(url).then((r) => r.data);

const TERMINAL = ["DONE", "FAILED"];

const FILTERS = [
  { id: "all", label: "All", match: () => true },
  { id: "processing", label: "Processing", match: (s: string) => !TERMINAL.includes(s) },
  { id: "done", label: "Done", match: (s: string) => s === "DONE" },
  { id: "failed", label: "Failed", match: (s: string) => s === "FAILED" },
] as const;

type FilterId = (typeof FILTERS)[number]["id"];
type ViewMode = "grid" | "list";

export default function ReelsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Arriving from the wizard with ?highlight=<jobId> — surface once, clean URL.
  useEffect(() => {
    if (searchParams.get("highlight")) {
      toast.info("Rendering started — track progress below");
      router.replace("/dashboard/reels");
    }
  }, [searchParams, router]);

  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(12);
  const [filter, setFilter] = useState<FilterId>("all");
  const [view, setView] = useState<ViewMode>("grid");

  const { data, mutate } = useSWR<JobList>(
    `/jobs?page=${page}&per_page=${perPage}`,
    fetcher,
    {
      refreshInterval: (latest) =>
        latest?.items.some((j) => !TERMINAL.includes(j.status)) ? 4000 : 0,
    },
  );

  const items = useMemo(() => data?.items ?? [], [data]);
  const visible = useMemo(() => {
    const f = FILTERS.find((x) => x.id === filter) ?? FILTERS[0];
    return items.filter((j) => f.match(j.status));
  }, [items, filter]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.per_page)) : 1;

  const [detailJob, setDetailJob] = useState<Job | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Job | null>(null);

  function remove(id: string) {
    api
      .delete(`/jobs/${id}`)
      .then(() => {
        toast.success("Reel deleted");
        setDeleteTarget(null);
        if (detailJob?.id === id) setDetailJob(null);
        mutate();
      })
      .catch((err) => toast.error(err?.response?.data?.detail || "Delete failed"));
  }

  const actions = {
    onOpen: (j: Job) => setDetailJob(j),
    onDelete: (j: Job) => setDeleteTarget(j),
  };

  return (
    <div className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-3xl font-semibold tracking-tight">My Reels</h1>
          <p className="mt-1 text-base text-muted-foreground">
            {data ? `${data.total} reel${data.total === 1 ? "" : "s"} total` : "…"}
          </p>
        </div>
        <Button asChild>
          <Link href="/dashboard/create">
            <Clapperboard />
            New Reel
          </Link>
        </Button>
      </header>

      {/* Controls */}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Tabs value={filter} onValueChange={(v) => setFilter(v as FilterId)}>
          <TabsList>
            {FILTERS.map((f) => (
              <TabsTrigger key={f.id} value={f.id}>
                {f.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <Select value={String(perPage)} onValueChange={(v) => { setPerPage(Number(v)); setPage(1); }}>
          <SelectTrigger className="w-[110px]" aria-label="Rows per page">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[12, 24, 48].map((n) => (
              <SelectItem key={n} value={String(n)}>{n} / page</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="ml-auto flex items-center rounded-lg border bg-muted/50 p-1">
          {(
            [
              { id: "grid", icon: LayoutGrid, label: "Grid view" },
              { id: "list", icon: List, label: "List view" },
            ] as const
          ).map((v) => (
            <button
              key={v.id}
              type="button"
              aria-label={v.label}
              aria-pressed={view === v.id}
              onClick={() => setView(v.id)}
              className={cn(
                "cursor-pointer rounded-md p-1.5 transition-colors",
                view === v.id
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <v.icon className="size-4" />
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      {!data ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="overflow-hidden rounded-lg border">
              <Skeleton className="aspect-[9/16] rounded-none" />
              <div className="flex flex-col gap-2 p-3">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Clapperboard />
            </EmptyMedia>
            <EmptyTitle>No reels yet</EmptyTitle>
            <EmptyDescription>
              Create your first reel — paste a story and ReelBot handles the rest.
            </EmptyDescription>
          </EmptyHeader>
          <Button asChild>
            <Link href="/dashboard/create">Create your first reel</Link>
          </Button>
        </Empty>
      ) : visible.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted-foreground">
          No reels match this filter.
        </p>
      ) : view === "grid" ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {visible.map((j) => (
            <ReelCard key={j.id} job={j} actions={actions} />
          ))}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border bg-card">
          {visible.map((j) => (
            <ReelRow key={j.id} job={j} actions={actions} />
          ))}
        </div>
      )}

      {/* Pagination */}
      {data && totalPages > 1 && (
        <Pagination className="mt-6">
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  setPage((p) => Math.max(1, p - 1));
                }}
                aria-disabled={page === 1}
                className={page === 1 ? "pointer-events-none opacity-50" : ""}
              />
            </PaginationItem>
            <PaginationItem>
              <span className="px-4 text-sm tabular-nums text-muted-foreground">
                Page {page} of {totalPages}
              </span>
            </PaginationItem>
            <PaginationItem>
              <PaginationNext
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  setPage((p) => Math.min(totalPages, p + 1));
                }}
                aria-disabled={page === totalPages}
                className={page === totalPages ? "pointer-events-none opacity-50" : ""}
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      )}

      {/* Detail player */}
      <ReelDetailSheet
        job={detailJob}
        open={!!detailJob}
        onOpenChange={(o) => !o && setDetailJob(null)}
        onDelete={(j) => {
          setDetailJob(null);
          setDeleteTarget(j);
        }}
      />

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this reel?</AlertDialogTitle>
            <AlertDialogDescription>
              Permanently removes &ldquo;{deleteTarget?.title}&rdquo; and its video file. This
              cannot be undone.
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
