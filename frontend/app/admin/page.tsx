"use client";

import { useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import type { AdminJob, AdminUser, AssetList, JobList } from "@/lib/types";
import { api } from "@/lib/api";
import { AppNav } from "@/components/app-nav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const fetcher = (url: string) => api.get(url).then((r) => r.data);

export default function AdminPage() {
  return (
    <>
      <AppNav />
      <div className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
        <header className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight">Admin</h1>
        </header>
      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="assets">Assets</TabsTrigger>
          <TabsTrigger value="jobs">Jobs</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="mt-6">
          <OverviewTab />
        </TabsContent>
        <TabsContent value="users" className="mt-6">
          <UsersTab />
        </TabsContent>
        <TabsContent value="assets" className="mt-6">
          <AssetsTab />
        </TabsContent>
        <TabsContent value="jobs" className="mt-6">
          <AllJobsTab />
        </TabsContent>
      </Tabs>
      </div>
    </>
  );
}

function OverviewTab() {
  const { data: stats } = useSWR<{
    total_jobs: number;
    jobs_today: number;
    total_users: number;
    storage_bytes: number;
  }>("/admin/stats", fetcher, { refreshInterval: 10000 });

  const cards = [
    { title: "Total Jobs", value: stats?.total_jobs ?? "—" },
    { title: "Jobs Today", value: stats?.jobs_today ?? "—" },
    { title: "Total Users", value: stats?.total_users ?? "—" },
    {
      title: "Clip Storage",
      value:
        stats != null ? `${(stats.storage_bytes / 1024 ** 3).toFixed(2)} GB` : "—",
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((c) => (
        <Card key={c.title}>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {c.title}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{c.value}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function UsersTab() {
  const [page, setPage] = useState(1);
  const { data, mutate } = useSWR<{ items: AdminUser[]; total: number }>(
    `/admin/users?page=${page}&per_page=10`,
    fetcher,
    { refreshInterval: 15000 },
  );
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [newRole, setNewRole] = useState("free");
  const [newPlan, setNewPlan] = useState("free");

  function saveRole() {
    if (!editing) return;
    api
      .patch(`/admin/users/${editing.id}`, { role: newRole, plan: newPlan })
      .then(() => {
        toast.success(`Updated ${editing.email}`);
        setEditing(null);
        mutate();
      })
      .catch((err) => toast.error(err?.response?.data?.detail || "Update failed"));
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Email</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Today / Month</TableHead>
            <TableHead>Created</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data?.items.map((u) => (
            <TableRow key={u.id}>
              <TableCell className="font-medium">{u.email}</TableCell>
              <TableCell>
                <div className="flex items-center gap-1.5">
                  <Badge variant={u.role === "admin" ? "default" : "secondary"}>{u.role}</Badge>
                  {u.plan === "premium" && <Badge className="bg-brand/15 text-brand">pro</Badge>}
                </div>
              </TableCell>
              <TableCell className="text-muted-foreground">
                {u.quota.daily_used}/{u.quota.daily_limit} · {u.quota.monthly_used}/
                {u.quota.monthly_limit}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {new Date(u.created_at).toLocaleDateString()}
              </TableCell>
              <TableCell className="space-x-2 text-right">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setEditing(u);
                    setNewRole(u.role);
                    setNewPlan(u.plan ?? "free");
                  }}
                >
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    api
                      .patch(`/admin/users/${u.id}`, { reset_quota: true })
                      .then(() => toast.success("Quota reset"))
                      .catch(() => toast.error("Reset failed"))
                  }
                >
                  Reset Quota
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit user — {editing?.email}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <Select value={newRole} onValueChange={setNewRole}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="free">Free</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
            <Select value={newPlan} onValueChange={setNewPlan}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="free">Plan: Free</SelectItem>
                <SelectItem value="premium">Plan: Premium</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={saveRole}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AssetsTab() {
  const { data, mutate } = useSWR<AssetList>("/assets", fetcher);

  function toggle(clipId: string, enabled: boolean) {
    api
      .patch(`/admin/assets/${clipId}?enabled=${enabled}`)
      .then(() => mutate())
      .catch(() => toast.error("Toggle failed"));
  }

  async function upload(file: File) {
    const form = new FormData();
    form.append("file", file);
    try {
      await api.post("/admin/assets?category=other", form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      toast.success("Clip uploaded & registered");
      mutate();
    } catch (err: unknown) {
      type ErrShape = { response?: { data?: { detail?: string } } };
      toast.error((err as ErrShape)?.response?.data?.detail || "Upload failed");
    }
  }

  function remove(clipId: string) {
    api
      .delete(`/admin/assets/${clipId}`)
      .then(() => {
        toast.success("Clip deleted");
        mutate();
      })
      .catch((err) => toast.error(err?.response?.data?.detail || "Delete failed"));
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent">
          Upload Clip
          <input
            type="file"
            accept="video/mp4"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
          />
        </label>
      </div>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Filename</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Resolution</TableHead>
              <TableHead>Duration</TableHead>
              <TableHead>Enabled</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data?.clips.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                  No clips yet — upload a vertical MP4 (30s+) to get started.
                </TableCell>
              </TableRow>
            )}
            {data?.clips.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="max-w-xs truncate font-medium">{c.filename}</TableCell>
                <TableCell>
                  <Badge variant="outline" className="capitalize">
                    {c.category.replace("_", " ")}
                  </Badge>
                </TableCell>
                <TableCell>{c.resolution ?? "—"}</TableCell>
                <TableCell>{c.duration_seconds ? `${Math.round(c.duration_seconds)}s` : "—"}</TableCell>
                <TableCell>
                  <Switch checked={c.enabled} onCheckedChange={(v) => toggle(c.id, v)} />
                </TableCell>
                <TableCell className="text-right">
                  <Button size="sm" variant="ghost" onClick={() => remove(c.id)}>
                    Delete
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function AllJobsTab() {
  const [page, setPage] = useState(1);
  const { data } = useSWR<JobList>(`/admin/jobs?page=${page}&per_page=15`, fetcher, {
    refreshInterval: 5000,
  });

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>User</TableHead>
            <TableHead>Title</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Duration</TableHead>
            <TableHead>Created</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(data?.items as AdminJob[] | undefined)?.map((j) => (
            <TableRow key={j.id}>
              <TableCell className="font-medium">{j.user_email ?? j.user_id.slice(0, 8)}</TableCell>
              <TableCell className="max-w-xs truncate">{j.title}</TableCell>
              <TableCell>
                <Badge variant={j.status === "FAILED" ? "destructive" : j.status === "DONE" ? "default" : "secondary"}>
                  {j.status}
                </Badge>
              </TableCell>
              <TableCell>{j.duration_seconds ? `${Math.round(j.duration_seconds)}s` : "—"}</TableCell>
              <TableCell className="text-muted-foreground">
                {new Date(j.created_at).toLocaleString()}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
