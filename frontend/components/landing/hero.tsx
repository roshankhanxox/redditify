"use client";

import { useRef } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(useGSAP);

const fanSlots = [
  { rotate: -6, x: 64, y: 32 },
  { rotate: 0, x: 0, y: -12 },
  { rotate: 6, x: -64, y: 32 },
];

const waveform = [30, 62, 44, 82, 55, 92, 40, 70, 50, 86, 35, 66, 48, 78];

export function Hero({ signedIn }: { signedIn: boolean }) {
  const root = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const tl = gsap.timeline({ defaults: { ease: "power3.out" } });
      tl.from("[data-hero-line]", {
        y: 48,
        opacity: 0,
        filter: "blur(10px)",
        duration: 1,
        stagger: 0.12,
      })
        .from("[data-hero-fade]", { y: 24, opacity: 0, duration: 0.7, stagger: 0.1 }, "-=0.6")
        .from("[data-hero-pill]", { scaleX: 0, opacity: 0, duration: 0.6, ease: "back.out(2)" }, "-=0.9");
      gsap.utils.toArray<HTMLElement>("[data-fan-card]").forEach((el, i) => {
        const s = fanSlots[i % fanSlots.length];
        tl.from(
          el,
          { x: s.x * 2, y: s.y * 2 + 48, rotate: s.rotate * 2, opacity: 0, duration: 1.1 },
          i === 0 ? "-=0.5" : "<0.12",
        );
      });
    },
    { scope: root },
  );

  return (
    <div ref={root} className="relative overflow-hidden pt-36 pb-24 md:pt-44">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute top-[-25%] left-1/2 h-[60rem] w-[85rem] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(255,255,255,0.07),transparent)] blur-2xl" />
        <div className="bg-noise absolute inset-0 opacity-[0.04]" />
        <div className="absolute inset-x-0 bottom-0 h-56 bg-gradient-to-b from-transparent to-background" />
      </div>

      <section className="mx-auto flex w-full max-w-6xl flex-col items-center px-6 text-center">
        <h1 className="max-w-5xl text-[clamp(2.5rem,6vw,5rem)] leading-[1.05] font-medium tracking-tighter text-balance">
          <span data-hero-line className="block">
            Paste a story.
          </span>
          <span data-hero-line className="block">
            Post a{" "}
            <span
              data-hero-pill
              aria-hidden
              className="mx-1 inline-block h-[0.62em] w-[1.45em] translate-y-[0.06em] rounded-full bg-cover bg-center align-middle ring-1 ring-white/20 contrast-125 saturate-[0.65]"
              style={{ backgroundImage: "url(https://picsum.photos/seed/neon-alley/480/240)" }}
            />{" "}
            reel.
          </span>
        </h1>

        <p
          data-hero-fade
          className="mt-6 max-w-xl text-base text-balance text-muted-foreground md:text-lg"
        >
          ReelBot narrates it with an AI voice, burns word-synced captions into the frame,
          and loops a gameplay background — exporting a 1080×1920 cut ready for Shorts
          and Reels.
        </p>

        <div data-hero-fade className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <Button size="lg" asChild className="rounded-full px-8">
            <Link href={signedIn ? "/dashboard" : "/sign-up"}>
              {signedIn ? "Open dashboard" : "Start creating free"}
            </Link>
          </Button>
          <Button
            size="lg"
            variant="outline"
            asChild
            className="rounded-full border-white/15 px-8 bg-white/[0.02] hover:bg-white/5"
          >
            <a href="#pipeline">See how it works</a>
          </Button>
        </div>

        <div className="relative mt-20 flex w-full max-w-3xl items-end justify-center md:mt-28">
          <div
            data-fan-card
            className="group relative z-10 -mr-8 aspect-[9/16] w-[38%] max-w-[260px] shrink-0 overflow-hidden rounded-2xl border border-white/10 shadow-2xl sm:-mr-12"
          >
            <img
              src="https://picsum.photos/seed/arcade-cabinet/720/1280"
              alt=""
              loading="lazy"
              decoding="async"
              className="absolute inset-0 h-full w-full object-cover brightness-[0.55] grayscale contrast-125 transition-transform duration-700 ease-out group-hover:scale-105"
            />
            <div className="absolute inset-x-0 top-0 flex items-center justify-between p-4 font-mono text-[10px] tracking-widest text-white/70 uppercase">
              <span>00:14</span>
              <span className="flex items-center gap-1.5">
                <span className="size-1.5 rounded-full bg-brand" />
                render
              </span>
            </div>
            <p className="absolute inset-x-4 bottom-6 text-center text-xl leading-tight font-extrabold text-white [text-shadow:_0_2px_12px_rgb(0_0_0_/_80%)]">
              so I quit my job on the spot
            </p>
          </div>

          <div
            data-fan-card
            className="group relative z-20 aspect-[9/16] w-[46%] max-w-[300px] shrink-0 overflow-hidden rounded-2xl border border-white/10 shadow-2xl"
          >
            <div className="absolute inset-0 bg-gradient-to-b from-neutral-900 via-neutral-950 to-black" />
            <div className="absolute inset-x-0 top-0 h-0.5 bg-white/10">
              <div className="h-full w-2/3 bg-brand" />
            </div>
            <div className="relative flex h-full flex-col justify-between p-6 text-left">
              <p className="font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
                r/confessions
              </p>
              <p className="text-lg leading-snug font-semibold tracking-tight">
                I secretly paid off my parents&rsquo; mortgage before their anniversary
              </p>
              <p className="text-[11px] text-muted-foreground">title card · minimal</p>
            </div>
          </div>

          <div
            data-fan-card
            className="group relative z-10 -ml-8 aspect-[9/16] w-[38%] max-w-[260px] shrink-0 overflow-hidden rounded-2xl border border-white/10 shadow-2xl sm:-ml-12"
          >
            <img
              src="https://picsum.photos/seed/game-controller/720/1280"
              alt=""
              loading="lazy"
              decoding="async"
              className="absolute inset-0 h-full w-full object-cover brightness-[0.5] grayscale contrast-125 transition-transform duration-700 ease-out group-hover:scale-105"
            />
            <p className="absolute inset-x-4 bottom-24 text-center text-xl leading-tight font-extrabold text-white [text-shadow:_0_2px_12px_rgb(0_0_0_/_80%)]">
              and then it clicked
            </p>
            <div aria-hidden className="absolute inset-x-6 bottom-8 flex h-10 items-center gap-1">
              {waveform.map((h, i) => (
                <span
                  key={i}
                  className="w-full rounded-full bg-white/70"
                  style={{ height: `${h}%` }}
                />
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
