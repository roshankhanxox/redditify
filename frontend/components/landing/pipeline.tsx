"use client";

import { useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(ScrollTrigger, useGSAP);

const steps = [
  {
    name: "Download",
    detail: "Source video pulled from object storage. MinIO in dev, any S3-compatible backend in prod.",
    tech: "s3 · local adapter",
  },
  {
    name: "Transcribe",
    detail: "Whisper extracts word-level timestamps locally. Results are cached on retry when DEV_STEP_CACHE is on.",
    tech: "whisper · offline · cacheable",
  },
  {
    name: "Analyse",
    detail: "LLM reads the timestamped transcript and ranks clip windows by engagement. Also cached on retry.",
    tech: "anthropic · openai · groq · cacheable",
  },
  {
    name: "Smart crop",
    detail: "Per-frame speaker detection via LR-ASD. The 9:16 crop window follows the highest-scoring face each frame.",
    tech: "lr-asd · s3fd · pytorch",
  },
  {
    name: "Render & upload",
    detail: "FFmpeg encodes the final 9:16 MP4 with captions burned in via libass, then uploads back to storage.",
    tech: "ffmpeg · libass · s3",
  },
];

const clips = [
  { hook: '"I quit my job on the spot"',           range: "0:14 – 1:42 · 88s", score: 94, caption: "karaoke" },
  { hook: '"No one told me it would feel like this"', range: "2:05 – 3:11 · 66s", score: 87, caption: "karaoke" },
  { hook: '"That\'s when everything clicked"',      range: "4:20 – 5:44 · 84s", score: 81, caption: "standard" },
  { hook: '"She looked at me and just said…"',      range: "6:02 – 7:08 · 66s", score: 78, caption: "karaoke" },
  { hook: '"I\'ve never been more terrified"',      range: "8:14 – 9:22 · 68s", score: 74, caption: "standard" },
];

export function Pipeline({ signedIn: _signedIn }: { signedIn: boolean }) {
  const root = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const mm = gsap.matchMedia();
      mm.add("(min-width: 1024px)", () => {
        ScrollTrigger.create({
          trigger: root.current,
          start: "top top",
          end: "bottom bottom",
          pin: "[data-pipeline-left]",
          pinSpacing: false,
        });
      });
      gsap.utils.toArray<HTMLElement>("[data-step]").forEach((el) => {
        gsap.from(el, {
          opacity: 0, x: -16, duration: 0.6, ease: "power3.out",
          scrollTrigger: { trigger: el, start: "top 88%" },
        });
      });
    },
    { scope: root },
  );

  return (
    <div ref={root} id="pipeline" className="scroll-mt-20 border-y border-white/8 bg-card/40 py-24 md:py-36">
      <section className="mx-auto grid w-full max-w-6xl gap-16 px-6 lg:grid-cols-2 lg:gap-24">
        {/* left — sticky */}
        <div data-pipeline-left className="lg:self-start">
          <p className="font-mono text-[11px] font-medium tracking-[0.1em] text-muted-foreground uppercase mb-4">
            How it runs
          </p>
          <h2 className="font-heading text-[clamp(1.9rem,3.2vw,2.6rem)] font-semibold tracking-tight leading-tight text-balance">
            Five stages,<br />one background task.
          </h2>
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground max-w-sm">
            Every clip job follows the same pipeline. Each stage is checkpointed — fail halfway and resume from where it broke, without re-running the expensive steps.
          </p>

          {/* job card mockup */}
          <div className="mt-10 overflow-hidden rounded-xl border border-white/10 bg-card shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/8 bg-white/[0.025] px-4 py-3">
              <span className="font-mono text-[12px] text-muted-foreground">clip_job / a3f9c12d</span>
              <span className="rounded font-mono text-[10px] font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-400 px-2.5 py-1">
                Done
              </span>
            </div>
            <div className="divide-y divide-white/5 px-4 py-2">
              {clips.map((c) => (
                <div key={c.hook} className="flex items-center gap-3 py-2.5">
                  <div className="h-14 w-8 shrink-0 rounded bg-muted/40 border border-white/8" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] font-medium">{c.hook}</p>
                    <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">{c.range} · {c.caption}</p>
                  </div>
                  <span className="shrink-0 font-mono text-[12px] font-bold text-brand tabular-nums">{c.score}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* right — steps */}
        <ol className="flex flex-col">
          {steps.map((step, i) => (
            <li
              key={step.name}
              data-step
              className="border-t border-white/8 py-9 first:border-t-0 lg:first:pt-0"
            >
              <p className="font-mono text-[13px] font-bold tracking-wider text-brand tabular-nums">0{i + 1}</p>
              <h3 className="font-heading mt-3 text-xl font-semibold tracking-tight">{step.name}</h3>
              <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">{step.detail}</p>
              <p className="mt-3 font-mono text-[11px] tracking-wider text-muted-foreground/60 uppercase">{step.tech}</p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
