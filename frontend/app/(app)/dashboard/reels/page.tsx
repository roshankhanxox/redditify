"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { toast } from "sonner";
import type { JobList } from "@/lib/types";
import { api, downloadReel } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const fetcher = (url: string) => api.get(url).then((r) => r.data);

/** Live countdown for an ephemeral reel's remaining lifetime. */
function ExpiryBadge({ iso }: { iso: string }) {
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

const STATUS_VARIANT: Record<string, "secondary" | "default" | "destructive" | "outline"> = {
  DONE: "default",
  FAILED: "destructive",
  QUEUED: "outline",
};

export default function JobsPage() {
  const [page, setPage] = useState(1);
  const { data, mutate } = useSWR<JobList>(`/jobs?page=${page}&per_page=10`, fetcher, {
    refreshInterval: (latest) =>
      latest?.items.some((j) => !["DONE", "FAILED"].includes(j.status)) ? 4000 : 0,
  });

  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  function remove(id: string) {
    api
      .delete(`/jobs/${id}`)
      .then(() => {
        toast.success("Job deleted");
        setDeleteTarget(null);
        mutate();
      })
      .catch((err) => toast.error(err?.response?.data?.detail || "Delete failed"));
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.per_page)) : 1;

  return (
    <>
      <div className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
        <header className="mb-6 flex items-center justify-between">
          <h1 className="font-heading text-3xl font-semibold tracking-tight">My Jobs</h1>
        </header>

      {!data ? null : data.items.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-lg border border-dashed border-border py-24 text-center">
          <p className="text-base text-muted-foreground">You haven&rsquo;t generated any reels yet.</p>
          <Button asChild>
            <Link href="/dashboard/create">Create your first reel</Link>
          </Button>
        </div>
      ) : (
        <>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((j) => (
                  <TableRow key={j.id}>
                    <TableCell className="max-w-xs truncate font-medium">{j.title}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <Badge
                          variant={STATUS_VARIANT[j.status] ?? "secondary"}
                          title={j.error_message || undefined}
                        >
                          {j.status === "DONE" && !j.result_url && j.retention !== "retain"
                            ? "Expired"
                            : j.status}
                        </Badge>
                        {j.status === "DONE" && j.result_url && j.retention === "ephemeral" && j.result_expires_at && (
                          <ExpiryBadge iso={j.result_expires_at} />
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {j.duration_seconds ? `${Math.round(j.duration_seconds)}s` : "—"}
                    </TableCell>
                    <TableCell className="text-[13px] tabular-nums text-muted-foreground">
                      {new Date(j.created_at).toLocaleString()}
                    </TableCell>
                    <TableCell className="space-x-2 text-right">
                      {j.status === "DONE" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => downloadReel(j.id, `${j.title || "reel"}.mp4`)}
                        >
                          Download
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => setDeleteTarget(j.id)}>
                        Delete
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {totalPages > 1 && (
            <Pagination className="mt-4">
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
                  <span className="px-4 text-sm text-muted-foreground">
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
        </>
      )}

      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this job?</DialogTitle>
            <DialogDescription>
              This permanently removes the job and its video file. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => deleteTarget && remove(deleteTarget)}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </div>
    </>
  );
}
