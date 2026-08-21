"use client";

import { useState } from "react";
import { signOut } from "next-auth/react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function ChangePasswordPage() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!current) errs.current = "Current password is required";
    if (next.length < 8) errs.next = "New password must be at least 8 characters";
    if (next !== confirm) errs.confirm = "Passwords do not match";
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setLoading(true);
    try {
      await api.post("/auth/change-password", {
        current_password: current,
        new_password: next,
      });
      await signOut({ callbackUrl: "/sign-in" });
    } catch (err: unknown) {
      type ErrShape = { response?: { data?: { detail?: string } } };
      const detail =
        (err as ErrShape)?.response?.data?.detail || "Could not change password";
      setErrors({ form: String(detail) });
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-xl">Change your password</CardTitle>
          <CardDescription>
            You must set a new password before continuing
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
            <div className="flex flex-col gap-2">
              <Label htmlFor="current">Current Password</Label>
              <Input
                id="current"
                type="password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                aria-invalid={!!errors.current}
              />
              {errors.current && <p className="text-sm text-destructive">{errors.current}</p>}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="next">New Password</Label>
              <Input
                id="next"
                type="password"
                value={next}
                onChange={(e) => setNext(e.target.value)}
                aria-invalid={!!errors.next}
              />
              {errors.next && <p className="text-sm text-destructive">{errors.next}</p>}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="confirm">Confirm New Password</Label>
              <Input
                id="confirm"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                aria-invalid={!!errors.confirm}
              />
              {errors.confirm && <p className="text-sm text-destructive">{errors.confirm}</p>}
            </div>
            {errors.form && <p className="text-sm text-destructive">{errors.form}</p>}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Saving..." : "Save & Sign Out"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
