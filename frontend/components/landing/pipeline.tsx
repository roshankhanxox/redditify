"use client";

import { useRef } from "react";
import Link from "next/link";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(ScrollTrigger, useGSAP);

const steps = [
  {
    name: "Voiceover",
    detail:
      "Your text is narrated by ElevenLabs or a free local engine. Auto picks the best available voice and falls back silently.",
    tech: "ElevenLabs · edge-tts",
  },
  {
    name: "Transcription",
    detail:
      "A local Whisper model time-aligns every spoken word for frame-accurate captions — no cloud calls.",
    tech: "Whisper · offline",
  },
  {
    name: "Title card",
    detail:
      "A cover frame is painted in dark, light or minimal style, complete with your subreddit label.",
    tech: "Pillow",
  },
  {
    name: "Gameplay loop",
    detail:
      "A vertical clip from your asset library is picked, trimmed and looped to the exact voiceover length.",
    tech: "Asset pool",
  },
  {
    name: "Composite and upload",
    detail:
      "FFmpeg merges audio, burned captions and footage into a 1080×1920 MP4, ready to download and post.",
    tech: "FFmpeg · libass",
  },
];

function ScrubCopy() {
  const text =
    "Drop your text, pick a narrator, hit render. ReelBot writes the voiceover, times every caption, paints the cover, loops the gameplay and cuts the final file. You just download and post.";
  return (
    <p data-pipeline-copy className="mt-8 max-w-md text-lg leading-relaxed">
      {text.split(" ").map((word, i) => (
        <span key={i} data-word className="inline-block whitespace-pre">
          {word}
          {i < text.split(" ").length - 1 ? "\u00A0" : ""}
        </span>
      ))}
    </p>
  );
}

export function Pipeline({ signedIn }: { signedIn: boolean }) {
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
      gsap.fromTo(
        "[data-word]",
        { opacity: 0.12 },
        {
          opacity: 1,
          stagger: 0.05,
          ease: "none",
          scrollTrigger: {
            trigger: "[data-pipeline-copy]",
            start: "top 78%",
            end: "bottom 45%",
            scrub: true,
          },
        },
      );
    },
    { scope: root },
  );

  return (
    <div ref={root} id="pipeline" className="scroll-mt-24 py-32 md:py-48">
      <section className="mx-auto grid w-full max-w-6xl gap-16 px-6 lg:grid-cols-2 lg:gap-24">
        <div data-pipeline-left className="lg:self-start">
          <h2 className="text-4xl font-medium tracking-tighter text-balance md:text-5xl">
            From paste to post, hands-free.
          </h2>
          <ScrubCopy />
          <Link
            href={signedIn ? "/dashboard" : "/sign-up"}
            className="group mt-10 inline-flex items-center gap-2 text-sm font-medium"
          >
            Try it with your own story
            <span className="transition-transform duration-300 group-hover:translate-x-1">→</span>
          </Link>
        </div>

        <ol className="flex flex-col">
          {steps.map((step, i) => (
            <li key={step.name} className="border-t border-white/8 py-10 first:border-t-0 lg:first:pt-0">
              <p className="font-mono text-xs tracking-widest text-brand">0{i + 1}</p>
              <h3 className="mt-3 text-xl font-semibold tracking-tight">{step.name}</h3>
              <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
                {step.detail}
              </p>
              <p className="mt-3 font-mono text-[11px] tracking-wider text-muted-foreground/70 uppercase">
                {step.tech}
              </p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
