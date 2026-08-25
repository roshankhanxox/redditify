"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { ArrowRight, Clapperboard, Film, Hourglass } from "lucide-react";
import { api } from "@/lib/api";
import type { JobList, StatsMe } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

const fetcher = (url: string) => api.get(url).then((r) => r.data);

const STATUS_VARIANT: Record<string, "default" | "destructive" | "secondary"> = {
  DONE: "default",
  FAILED: "destructive",
};

function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function formatMinutes(totalSeconds: number): string {
  const m = Math.round(totalSeconds / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "Up late";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function Thumb({ job }: { job: JobList["items"][number] }) {
  const [failed, setFailed] = useState(false);
  if (!job.thumbnail_url || failed) {
    return (
      <div className="flex aspect-[9/16] items-center justify-center bg-muted">
        <Film className="size-6 text-muted-foreground/50" />
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

function RecentReelCard({ job }: { job: JobList["items"][number] }) {
  return (
    <Link
      href="/dashboard/reels"
      className="group overflow-hidden rounded-lg border bg-card transition-colors hover:border-ring"
    >
      <Thumb job={job} />
      <div className="flex flex-col gap-1.5 p-3">
        <p className="truncate text-sm font-medium">{job.title || "Untitled reel"}</p>
        <div className="flex items-center gap-2 text-[13px] tabular-nums text-muted-foreground">
          <Badge variant={STATUS_VARIANT[job.status] ?? "secondary"}>{job.status}</Badge>
          {job.duration_seconds ? (
            <span>{Math.round(job.duration_seconds)}s</span>
          ) : null}
          <span className="ml-auto">{timeAgo(job.created_at)}</span>
        </div>
      </div>
    </Link>
  );
}

function StatCard({
  label,
  value,
  hint,
  children,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-2 p-5">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        <p className="text-3xl font-semibold tracking-tight tabular-nums">{value}</p>
        {children}
        {hint ? <p className="text-[13px] text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}

export default function HomePage() {
  // Time-dependent text: computed once per environment; hydration delta is
  // expected and suppressed (SSG bakes build-time hour, client uses real one).
  const [hello] = useState(greeting);

  const { data: stats } = useSWR<StatsMe>("/stats/me", fetcher);
  const { data: recent } = useSWR<JobList>("/jobs?page=1&per_page=8", fetcher, {
    refreshInterval: (latest) =>
      latest?.items.some((j) => !["DONE", "FAILED"].includes(j.status)) ? 4000 : 30000,
  });

  const quotaLeft = stats
    ? stats.unlimited
      ? null
      : Math.max(0, stats.daily_limit - stats.daily_used)
    : null;

  return (
    <div className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-3xl font-semibold tracking-tight" suppressHydrationWarning>
            {hello}
          </h1>
          <p className="mt-1 text-base text-muted-foreground">
            Turn any story into a short-form vertical video.
          </p>
        </div>
        <Button asChild size="lg">
          <Link href="/dashboard/create">
            <Clapperboard />
            New Reel
          </Link>
        </Button>
      </header>

      {/* Stat strip */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {!stats ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="flex flex-col gap-3 p-5">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-9 w-14" />
              </CardContent>
            </Card>
          ))
        ) : (
          <>
            <StatCard
              label="Videos left today"
              value={quotaLeft === null ? "∞" : quotaLeft}
              hint={
                stats.unlimited
                  ? "Unlimited plan"
                  : `${stats.daily_used}/${stats.daily_limit} used today`
              }
            >
              {!stats.unlimited && (
                <Progress
                  value={(stats.daily_used / Math.max(1, stats.daily_limit)) * 100}
                  className="h-1.5"
                />
              )}
            </StatCard>
            <StatCard
              label="This month"
              value={stats.unlimited ? "∞" : stats.monthly_used}
              hint={
                stats.unlimited
                  ? "No monthly cap"
                  : `of ${stats.monthly_limit} on ${stats.plan}`
              }
            />
            <StatCard label="Total reels" value={stats.total_reels} />
            <StatCard
              label="Watch time created"
              value={formatMinutes(stats.total_seconds)}
              hint={<span className="inline-flex items-center gap-1"><Hourglass className="size-3" />all finished reels</span>}
            />
          </>
        )}
      </div>

      {/* Recent reels */}
      <section className="mt-10">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-heading text-lg font-semibold tracking-tight">
            Recent reels
          </h2>
          {recent && recent.total > recent.items.length && (
            <Link
              href="/dashboard/reels"
              className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              View all ({recent.total})
              <ArrowRight className="size-3.5" />
            </Link>
          )}
        </div>

        {!recent ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="overflow-hidden rounded-lg border">
                <Skeleton className="aspect-[9/16] rounded-none" />
                <div className="flex flex-col gap-2 p-3">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : recent.items.length === 0 ? (
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
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {recent.items.map((j) => (
              <RecentReelCard key={j.id} job={j} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
