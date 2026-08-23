import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

export function FooterCta({ signedIn }: { signedIn: boolean }) {
  const ctaHref = signedIn ? "/dashboard" : "/sign-up";

  return (
    <>
      <section className="relative overflow-hidden py-32 md:py-48">
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute bottom-[-40%] left-1/2 h-[50rem] w-[70rem] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(255,255,255,0.06),transparent)] blur-2xl" />
          <div className="bg-noise absolute inset-0 opacity-[0.04]" />
        </div>
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center px-6 text-center">
          <h2 className="max-w-5xl text-[clamp(3rem,8vw,7rem)] leading-[1.02] font-medium tracking-tighter text-balance">
            Make your first reel.
          </h2>
          <Link
            href={ctaHref}
            className="group mt-12 inline-flex items-center gap-2 rounded-full bg-primary px-8 py-4 text-lg font-semibold text-primary-foreground transition-transform duration-300 hover:scale-[1.03]"
          >
            {signedIn ? "Open dashboard" : "Get started free"}
            <ArrowUpRight className="size-5 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </Link>
          <p className="mt-6 text-sm text-muted-foreground">
            No credit card. Three renders a day, on us.
          </p>
        </div>
      </section>

      <footer className="border-t border-white/5">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-10 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">© 2026 ReelBot. All rights reserved.</p>
          <nav className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
            <a href="#features" className="transition-colors hover:text-foreground">
              Features
            </a>
            <a href="#pipeline" className="transition-colors hover:text-foreground">
              Pipeline
            </a>
            <a href="#pricing" className="transition-colors hover:text-foreground">
              Pricing
            </a>
            {signedIn ? (
              <Link href="/dashboard" className="transition-colors hover:text-foreground">
                Dashboard
              </Link>
            ) : (
              <>
                <Link href="/sign-in" className="transition-colors hover:text-foreground">
                  Sign in
                </Link>
                <Link href="/sign-up" className="transition-colors hover:text-foreground">
                  Sign up
                </Link>
              </>
            )}
            <a
              href="https://www.reddit.com"
              target="_blank"
              rel="noreferrer"
              className="transition-colors hover:text-foreground"
            >
              Reddit
            </a>
          </nav>
        </div>
      </footer>
    </>
  );
}
