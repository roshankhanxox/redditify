"use client";

import { useRef } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { GitFork } from "lucide-react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(useGSAP);

const logLines = [
  { kind: "info", text: <>ClipJob <span className="text-brand">a3f9…c12d</span> received</> },
  { kind: "info", text: <>DOWNLOADING  → source.mp4 <span className="text-emerald-400">✓</span></> },
  { kind: "info", text: <>TRANSCRIBING → Whisper base.en, 847 words <span className="text-emerald-400">✓</span></> },
  { kind: "info", text: <>ANALYSING    → gpt-5-mini selected <span className="text-brand">5 clips</span></> },
  { kind: "info", text: <>CLIPPING     → clip 1/5  smart_crop=True <span className="text-emerald-400">✓</span></> },
  { kind: "info", text: <>CLIPPING     → clip 2/5 <span className="text-emerald-400">✓</span></> },
  { kind: "info", text: <>CLIPPING     → clip 3/5 <span className="text-emerald-400">✓</span></> },
  { kind: "info", text: <>CLIPPING     → clip 4/5 <span className="text-emerald-400">✓</span></> },
  { kind: "info", text: <>CLIPPING     → clip 5/5 <span className="text-emerald-400">✓</span></> },
  { kind: "done", text: <>DONE   5/5 clips rendered  <span className="text-muted-foreground">·</span>  <span className="text-brand">04m 32s</span></> },
];

export function Hero({ signedIn }: { signedIn: boolean }) {
  const root = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const tl = gsap.timeline({ defaults: { ease: "power3.out" } });
      tl.from("[data-hero-eyebrow]", { y: 16, opacity: 0, duration: 0.6 })
        .from("[data-hero-line]", { y: 40, opacity: 0, filter: "blur(8px)", duration: 0.9, stagger: 0.1 }, "-=0.3")
        .from("[data-hero-sub]", { y: 20, opacity: 0, duration: 0.7 }, "-=0.5")
        .from("[data-hero-actions]", { y: 16, opacity: 0, duration: 0.6 }, "-=0.4")
        .from("[data-terminal]", { y: 24, opacity: 0, duration: 0.8 }, "-=0.3")
        .from("[data-log-line]", { opacity: 0, x: -8, duration: 0.3, stagger: 0.07 }, "-=0.4");
    },
    { scope: root },
  );

  return (
    <div ref={root} className="relative overflow-hidden pt-36 pb-20 md:pt-44 md:pb-28">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute top-[-20%] left-1/2 h-[52rem] w-[80rem] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--color-brand)_8%,transparent),transparent)] blur-3xl" />
        <div className="bg-noise absolute inset-0 opacity-[0.04]" />
        <div className="absolute inset-x-0 bottom-0 h-48 bg-gradient-to-b from-transparent to-background" />
      </div>

      <section className="mx-auto flex w-full max-w-6xl flex-col items-center px-6 text-center">
        <div
          data-hero-eyebrow
          className="mb-7 inline-flex items-center gap-2 rounded-full border border-brand/25 px-3.5 py-1.5 font-mono text-[11px] font-medium tracking-widest text-brand uppercase"
        >
          <span className="size-1.5 rounded-full bg-brand animate-pulse" />
          open source · self-hosted
        </div>

        <h1 className="font-heading max-w-4xl text-[clamp(2.8rem,5.5vw,4.6rem)] font-semibold leading-[1.06] tracking-tight text-balance">
          <span data-hero-line className="block">Your local</span>
          <span data-hero-line className="block text-brand">AI clip engine.</span>
        </h1>

        <p
          data-hero-sub
          className="mt-5 max-w-lg text-base font-light leading-relaxed text-muted-foreground text-balance md:text-lg"
        >
          Drop a long-form video. The LLM finds the best moments, Whisper transcribes
          every word, and smart crop follows the speaker's face — all on your machine,
          no vendor lock-in.
        </p>

        <div data-hero-actions className="mt-9 flex flex-wrap items-center justify-center gap-3">
          <Button size="lg" asChild className="rounded-lg px-7">
            <Link href={signedIn ? "/dashboard" : "/sign-up"}>
              {signedIn ? "Open dashboard" : "Get started"}
            </Link>
          </Button>
          <Button size="lg" variant="outline" asChild className="rounded-lg border-white/12 bg-white/[0.02] px-7 hover:bg-white/5 gap-2">
            <a href="https://github.com/roshankhanxox/redditify" target="_blank" rel="noopener noreferrer">
              <GitFork className="size-4" />
              View on GitHub
            </a>
          </Button>
        </div>

        {/* Terminal */}
        <div
          data-terminal
          className="relative mt-14 w-full max-w-2xl overflow-hidden rounded-xl border border-white/10 bg-card shadow-2xl md:mt-20"
        >
          <div className="flex items-center gap-1.5 border-b border-white/8 bg-white/[0.03] px-4 py-2.5">
            <span className="size-2.5 rounded-full bg-[#ff5f57]" />
            <span className="size-2.5 rounded-full bg-[#febc2e]" />
            <span className="size-2.5 rounded-full bg-[#28c840]" />
            <span className="ml-3 font-mono text-[11px] text-muted-foreground">clip worker</span>
          </div>
          <div className="px-5 py-4 font-mono text-[12.5px] leading-[1.8] text-muted-foreground text-left">
            {logLines.map((line, i) => (
              <div key={i} data-log-line className="flex gap-3">
                <span className={line.kind === "done" ? "text-emerald-400 shrink-0" : "text-muted-foreground/50 shrink-0"}>
                  {line.kind === "done" ? "DONE" : "INFO"}
                </span>
                <span>{line.text}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
