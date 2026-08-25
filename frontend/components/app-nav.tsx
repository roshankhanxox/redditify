"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";

const baseLinks = [
  { href: "/dashboard", label: "Create" },
  { href: "/jobs", label: "My Jobs" },
];

export function AppNav() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === "admin";
  const links = isAdmin ? [...baseLinks, { href: "/admin", label: "Admin" }] : baseLinks;

  return (
    <header className="sticky top-0 z-40 border-b border-white/5 bg-background/70 backdrop-blur-md">
      <nav className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-4 px-6">
        <div className="flex items-center gap-8">
          <Link href="/" className="text-base font-semibold tracking-tight">
            Reel<span className="text-brand">Bot</span>
          </Link>
          <div className="flex items-center gap-6">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                aria-current={pathname === l.href ? "page" : undefined}
                className={
                  pathname === l.href
                    ? "text-sm font-medium text-foreground"
                    : "text-sm text-muted-foreground transition-colors hover:text-foreground"
                }
              >
                {l.label}
              </Link>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-3">
          {session?.user?.email && (
            <span className="hidden max-w-[200px] truncate text-[13px] text-muted-foreground md:block">
              {session.user.email}
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            className="rounded-full border-white/15"
            onClick={() => signOut({ redirectTo: "/" })}
          >
            Sign out
          </Button>
        </div>
      </nav>
    </header>
  );
}
