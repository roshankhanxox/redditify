import Link from "next/link";
import { GitFork } from "lucide-react";
import { Button } from "@/components/ui/button";

export function FooterCta({ signedIn }: { signedIn: boolean }) {
  return (
    <>
      <section className="relative overflow-hidden py-28 md:py-40">
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute bottom-[-30%] left-1/2 h-[48rem] w-[70rem] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--color-brand)_7%,transparent),transparent)] blur-3xl" />
          <div className="bg-noise absolute inset-0 opacity-[0.04]" />
        </div>
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center px-6 text-center">
          <h2 className="font-heading max-w-4xl text-[clamp(2.6rem,7vw,6rem)] font-semibold leading-[1.04] tracking-tight text-balance">
            Your clips, your machine.
          </h2>
          <p className="mt-5 max-w-md text-base font-light text-muted-foreground">
            Self-hosted, open source, no vendor lock-in. Clone it, configure it, run it.
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
            <Button size="lg" asChild className="rounded-lg gap-2">
              <Link href={signedIn ? "/dashboard" : "/sign-up"}>
                {signedIn ? "Open dashboard" : "Get started"}
              </Link>
            </Button>
            <Button size="lg" variant="outline" asChild className="rounded-lg border-white/12 bg-white/[0.02] hover:bg-white/5 gap-2">
              <a href="https://github.com/roshankhanxox/redditify" target="_blank" rel="noopener noreferrer">
                <GitFork className="size-4" />
                GitHub
              </a>
            </Button>
          </div>
        </div>
      </section>

      <footer className="border-t border-white/5">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-8">
          <span className="font-mono text-sm font-bold text-muted-foreground">redditify</span>
          <nav className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
            <a href="#features" className="transition-colors hover:text-foreground">Features</a>
            <a href="#pipeline" className="transition-colors hover:text-foreground">Pipeline</a>
            <a href="#self-host" className="transition-colors hover:text-foreground">Self-host</a>
            <a href="https://github.com/roshankhanxox/redditify" target="_blank" rel="noopener noreferrer" className="transition-colors hover:text-foreground">GitHub</a>
            {signedIn ? (
              <Link href="/dashboard" className="transition-colors hover:text-foreground">Dashboard</Link>
            ) : (
              <Link href="/sign-in" className="transition-colors hover:text-foreground">Sign in</Link>
            )}
          </nav>
          <span className="font-mono text-xs text-muted-foreground/50">MIT License</span>
        </div>
      </footer>
    </>
  );
}
