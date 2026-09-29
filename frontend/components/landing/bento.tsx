"use client";

import { useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import { BrainCircuit, Scan, Mic, Captions, FlaskConical, Container } from "lucide-react";

gsap.registerPlugin(ScrollTrigger, useGSAP);

const features = [
  {
    icon: BrainCircuit,
    title: "LLM clip selection",
    body: "Configurable provider — Anthropic, OpenAI, or Groq. The model reads the transcript and ranks clip windows by engagement score.",
    tag: "anthropic · openai · groq",
  },
  {
    icon: Scan,
    title: "Smart crop",
    body: "LR-ASD detects the active speaker face-by-face, per frame. The 9:16 crop window follows whoever is talking.",
    tag: "lr-asd · s3fd · talknet",
  },
  {
    icon: Mic,
    title: "Local transcription",
    body: "Whisper runs entirely offline. Word-level timestamps feed the caption pipeline — no cloud API, no cost per minute.",
    tag: "openai-whisper · offline",
  },
  {
    icon: Captions,
    title: "Karaoke captions",
    body: "Word-by-word highlight mode or standard chunk captions. Configurable font, color, position and outline — burned in via libass.",
    tag: "ffmpeg · libass · ass",
  },
  {
    icon: FlaskConical,
    title: "Dev step cache",
    body: (
      <>
        Set{" "}
        <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">DEV_STEP_CACHE=true</code>{" "}
        and Whisper + LLM results persist across retries. No re-billing the same video.
      </>
    ),
    tag: "~/.cache/reelbot-dev",
  },
  {
    icon: Container,
    title: "Celery task queue",
    body: "Clip jobs run on a dedicated worker. Failed jobs can be re-rendered from CLIPPING — skipping the LLM when clip rows already exist.",
    tag: "celery · redis · postgres",
  },
];

export function Bento() {
  const root = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      gsap.utils.toArray<HTMLElement>("[data-feat-card]").forEach((el) => {
        gsap.from(el, {
          y: 24,
          opacity: 0,
          duration: 0.7,
          ease: "power3.out",
          scrollTrigger: { trigger: el, start: "top 90%" },
        });
      });
    },
    { scope: root },
  );

  return (
    <div ref={root} id="features" className="scroll-mt-20 py-24 md:py-36">
      <section className="mx-auto w-full max-w-6xl px-6">
        <p className="font-mono text-[11px] font-medium tracking-[0.1em] text-muted-foreground uppercase mb-4">
          What&apos;s inside
        </p>
        <h2 className="font-heading text-[clamp(1.9rem,3.5vw,2.8rem)] font-semibold tracking-tight leading-tight text-balance max-w-xl">
          Built on real open-source tooling.<br />Runs on your hardware.
        </h2>

        <div className="mt-12 grid grid-cols-1 gap-px sm:grid-cols-2 lg:grid-cols-3 border border-white/8 rounded-xl overflow-hidden">
          {features.map((f) => (
            <article
              key={f.title}
              data-feat-card
              className="flex flex-col gap-4 bg-card p-6 hover:bg-card/80 transition-colors"
            >
              <div className="flex size-9 items-center justify-center rounded-lg border border-brand/20 bg-brand/10">
                <f.icon className="size-4 text-brand" />
              </div>
              <div className="flex-1">
                <h3 className="text-[15px] font-semibold tracking-tight mb-2">{f.title}</h3>
                <p className="text-[13.5px] leading-relaxed text-muted-foreground">{f.body}</p>
              </div>
              <p className="font-mono text-[11px] tracking-wide text-muted-foreground/60 uppercase border border-white/8 rounded px-2 py-1 self-start">
                {f.tag}
              </p>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
