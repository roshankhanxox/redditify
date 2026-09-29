import Link from "next/link";
import { Button } from "@/components/ui/button";
import { GitFork } from "lucide-react";

export function SiteNav({ signedIn }: { signedIn: boolean }) {
  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-white/5 bg-background/70 backdrop-blur-md">
      <nav className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-6">
        <Link href="/" className="font-mono text-sm font-bold tracking-tight">
          redditify
        </Link>
        <div className="hidden items-center gap-7 text-sm text-muted-foreground md:flex">
          <a href="#features" className="transition-colors hover:text-foreground">Features</a>
          <a href="#pipeline" className="transition-colors hover:text-foreground">Pipeline</a>
          <a href="#self-host" className="transition-colors hover:text-foreground">Self-host</a>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" asChild className="rounded-lg gap-1.5">
            <a href="https://github.com/roshankhanxox/redditify" target="_blank" rel="noopener noreferrer">
              <GitFork className="size-3.5" />
              <span className="hidden sm:inline">GitHub</span>
            </a>
          </Button>
          {!signedIn && (
            <Button variant="ghost" size="sm" asChild className="rounded-lg">
              <Link href="/sign-in">Sign in</Link>
            </Button>
          )}
          <Button size="sm" asChild className="rounded-lg">
            <Link href={signedIn ? "/dashboard" : "/sign-up"}>
              {signedIn ? "Open dashboard" : "Get started"}
            </Link>
          </Button>
        </div>
      </nav>
    </header>
  );
}
