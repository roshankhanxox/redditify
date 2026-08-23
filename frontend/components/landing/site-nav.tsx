import Link from "next/link";
import { Button } from "@/components/ui/button";

export function SiteNav({ signedIn }: { signedIn: boolean }) {
  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-white/5 bg-background/70 backdrop-blur-md">
      <nav className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-6">
        <Link href="/" className="text-base font-semibold tracking-tight">
          Reel<span className="text-brand">Bot</span>
        </Link>
        <div className="hidden items-center gap-8 text-sm text-muted-foreground md:flex">
          <a href="#features" className="transition-colors hover:text-foreground">
            Features
          </a>
          <a href="#pipeline" className="transition-colors hover:text-foreground">
            Pipeline
          </a>
          <a href="#pricing" className="transition-colors hover:text-foreground">
            Pricing
          </a>
        </div>
        <div className="flex items-center gap-2">
          {!signedIn && (
            <Button variant="ghost" size="sm" asChild className="rounded-full">
              <Link href="/sign-in">Sign in</Link>
            </Button>
          )}
          <Button size="sm" asChild className="rounded-full">
            <Link href={signedIn ? "/dashboard" : "/sign-up"}>
              {signedIn ? "Open dashboard" : "Get started"}
            </Link>
          </Button>
        </div>
      </nav>
    </header>
  );
}
