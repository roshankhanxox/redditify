"use client";

import { useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import {
  Captions,
  Mic,
  Clapperboard,
  Gamepad2,
  Activity,
  Gauge,
  Play,
} from "lucide-react";

gsap.registerPlugin(ScrollTrigger, useGSAP);

const statuses = ["Queued", "Voice", "Transcribe", "Cover", "Composite", "Done"];

export function Bento() {
  const root = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      gsap.utils.toArray<HTMLElement>("[data-bento-card]").forEach((el) => {
        gsap.from(el, {
          y: 32,
          opacity: 0,
          duration: 0.8,
          ease: "power3.out",
          scrollTrigger: { trigger: el, start: "top 88%" },
        });
      });
      gsap.utils.toArray<HTMLElement>("[data-scroll-img]").forEach((el) => {
        gsap
          .timeline({
            scrollTrigger: { trigger: el, start: "top bottom", end: "bottom top", scrub: true },
          })
          .fromTo(
            el,
            { scale: 0.82, opacity: 0.35, filter: "brightness(0.6)" },
            { scale: 1, opacity: 1, filter: "brightness(1)", ease: "none", duration: 0.5 },
          )
          .to(el, { scale: 1.06, opacity: 0.25, filter: "brightness(0.5)", ease: "none", duration: 0.5 });
      });
    },
    { scope: root },
  );

  return (
    <div ref={root} id="features" className="scroll-mt-24 py-32 md:py-48">
      <section className="mx-auto w-full max-w-6xl px-6">
        <div className="mb-14 flex flex-col justify-between gap-6 md:flex-row md:items-end">
          <h2 className="max-w-xl text-4xl font-medium tracking-tighter text-balance md:text-5xl">
            Everything between paste and post.
          </h2>
          <p className="max-w-sm text-sm leading-relaxed text-muted-foreground md:text-right">
            Six systems run on every render — narration, captions, artwork, footage,
            queueing and quotas — without a single manual edit.
          </p>
        </div>

        <div className="grid grid-flow-dense grid-cols-1 gap-3 md:grid-cols-2 lg:auto-rows-[230px] lg:grid-cols-4">
          <article
            data-bento-card
            className="group relative flex min-h-[320px] flex-col justify-end overflow-hidden rounded-2xl border border-white/8 bg-card p-6 md:min-h-0 lg:col-span-2 lg:row-span-2"
          >
            <div data-scroll-img className="absolute inset-0 will-change-transform">
              <img
                src="https://picsum.photos/seed/city-rain/1200/1200"
                alt=""
                loading="lazy"
                decoding="async"
                className="h-full w-full object-cover grayscale contrast-125"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/40 to-black/30" />
            </div>
            <div className="relative z-10 transition-transform duration-700 ease-out group-hover:-translate-y-1">
              <Captions className="mb-3 size-5 text-white/70" />
              <h3 className="text-lg font-semibold tracking-tight">Word-synced captions</h3>
              <p className="mt-1 max-w-sm text-sm leading-relaxed text-white/60">
                Whisper aligns every word locally; libass burns shorts-style subtitles
                straight into the pixels.
              </p>
              <p className="mt-5 inline-block rounded-lg bg-black/60 px-3 py-2 text-xl leading-tight font-extrabold backdrop-blur [text-shadow:_0_2px_10px_rgb(0_0_0_/_60%)]">
                then it <span className="text-brand">clicked</span>
              </p>
            </div>
          </article>

          <article
            data-bento-card
            className="group flex flex-col justify-between gap-6 overflow-hidden rounded-2xl border border-white/8 bg-card p-6 lg:col-span-2"
          >
            <div>
              <Mic className="mb-3 size-5 text-muted-foreground" />
              <h3 className="text-lg font-semibold tracking-tight">Narration on tap</h3>
              <p className="mt-1 max-w-sm text-sm leading-relaxed text-muted-foreground">
                Ten voices across two engines, with playback speed from 0.8× to 1.5×.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground">
                Auto
              </span>
              <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-muted-foreground transition-colors group-hover:border-white/20">
                ElevenLabs
              </span>
              <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-muted-foreground transition-colors group-hover:border-white/20">
                Local TTS
              </span>
              <span className="ml-auto font-mono text-xs text-muted-foreground">speed 1.15×</span>
            </div>
          </article>

          <article
            data-bento-card
            className="group flex flex-col justify-between gap-6 rounded-2xl border border-white/8 bg-card p-6"
          >
            <div>
              <Clapperboard className="mb-3 size-5 text-muted-foreground" />
              <h3 className="text-base font-semibold tracking-tight">Cover frames</h3>
            </div>
            <div className="flex gap-2">
              <span className="h-12 flex-1 rounded-md border border-white/10 bg-neutral-900" />
              <span className="h-12 flex-1 rounded-md border border-black/10 bg-neutral-200" />
              <span className="h-12 flex-1 rounded-md border border-white/10 bg-gradient-to-b from-neutral-900 to-neutral-800" />
            </div>
            <p className="text-xs text-muted-foreground">dark · light · minimal</p>
          </article>

          <article
            data-bento-card
            className="group relative flex min-h-[240px] flex-col justify-end overflow-hidden rounded-2xl border border-white/8 bg-card p-6"
          >
            <div data-scroll-img className="absolute inset-0 will-change-transform">
              <img
                src="https://picsum.photos/seed/retro-console/800/800"
                alt=""
                loading="lazy"
                decoding="async"
                className="h-full w-full object-cover grayscale contrast-125"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent" />
            </div>
            <Gamepad2 className="relative z-10 mb-auto size-5 text-white/80" />
            <span className="absolute top-1/2 left-1/2 z-10 flex size-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/25 bg-black/40 backdrop-blur transition-transform duration-500 group-hover:scale-110">
              <Play className="ml-0.5 size-4 fill-white text-white" />
            </span>
            <div className="relative z-10">
              <h3 className="text-base font-semibold tracking-tight">Gameplay loops</h3>
              <p className="mt-1 text-xs text-muted-foreground">Auto-looped to voiceover length</p>
            </div>
          </article>

          <article
            data-bento-card
            className="group flex flex-col justify-between gap-6 overflow-hidden rounded-2xl border border-white/8 bg-card p-6 lg:col-span-2"
          >
            <div>
              <Activity className="mb-3 size-5 text-muted-foreground" />
              <h3 className="text-lg font-semibold tracking-tight">Live job tracking</h3>
              <p className="mt-1 max-w-sm text-sm leading-relaxed text-muted-foreground">
                Every stage is visible in real time, with backoff polling until the file lands.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {statuses.map((s, i) => (
                <span key={s} className="flex items-center gap-1.5">
                  <span
                    className={
                      i === statuses.length - 1
                        ? "rounded-full bg-brand/15 px-2.5 py-1 font-mono text-[10px] tracking-wider text-brand uppercase"
                        : "rounded-full border border-white/10 px-2.5 py-1 font-mono text-[10px] tracking-wider text-muted-foreground uppercase"
                    }
                  >
                    {s}
                  </span>
                  {i < statuses.length - 1 && (
                    <span aria-hidden className="text-[10px] text-muted-foreground">→</span>
                  )}
                </span>
              ))}
            </div>
          </article>

          <article
            data-bento-card
            className="group flex flex-col justify-between gap-6 overflow-hidden rounded-2xl border border-white/8 bg-card p-6 lg:col-span-2"
          >
            <div>
              <Gauge className="mb-3 size-5 text-muted-foreground" />
              <h3 className="text-lg font-semibold tracking-tight">Quotas that scale</h3>
              <p className="mt-1 max-w-sm text-sm leading-relaxed text-muted-foreground">
                Free accounts render on a fair-use meter; admins are uncapped.
              </p>
            </div>
            <div className="flex items-end gap-8">
              <p className="text-4xl font-medium tracking-tighter">
                3<span className="mx-1.5 text-lg text-muted-foreground">/</span>
                <span className="text-lg text-muted-foreground">day</span>
              </p>
              <p className="text-4xl font-medium tracking-tighter">
                30<span className="mx-1.5 text-lg text-muted-foreground">/</span>
                <span className="text-lg text-muted-foreground">month</span>
              </p>
            </div>
          </article>
        </div>
      </section>
    </div>
  );
}
