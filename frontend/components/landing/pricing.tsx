import Link from "next/link";
import { Button } from "@/components/ui/button";
import { GitFork } from "lucide-react";

const points = [
  "Swap the LLM provider in a single env var",
  "Whisper runs offline — no transcription costs",
  "Smart crop model weights cached locally after first run",
  "Store clips on local disk or any S3-compatible backend",
];

const envLines = [
  { comment: true,  text: "# LLM provider — swap freely" },
  { key: "LLM_PROVIDER",       val: "openai",          kind: "str" },
  { key: "LLM_MODEL_OPENAI",   val: "gpt-5-mini",      kind: "str" },
  { comment: true,  text: "# Or use Anthropic" },
  { comment: true,  text: "# LLM_PROVIDER=anthropic" },
  { comment: true,  text: "# LLM_MODEL_ANTHROPIC=claude-sonnet-4-6" },
  { comment: true,  text: "# Cache expensive steps in dev" },
  { key: "DEV_STEP_CACHE",     val: "true",            kind: "bool" },
  { comment: true,  text: "# Storage: local or s3" },
  { key: "STORAGE_BACKEND",    val: "local",           kind: "str" },
  { key: "LOCAL_STORAGE_PATH", val: "./outputs",       kind: "str" },
  { comment: true,  text: "# Smart crop (vendor submodule)" },
  { comment: true,  text: "# git submodule update --init" },
];

export function Pricing() {
  return (
    <section id="self-host" className="scroll-mt-20 border-y border-white/8 bg-card/40 py-24 md:py-36">
      <div className="mx-auto w-full max-w-6xl px-6">
        <div className="grid gap-16 lg:grid-cols-2 lg:gap-24 items-center">
          {/* left */}
          <div>
            <p className="font-mono text-[11px] font-medium tracking-[0.1em] text-muted-foreground uppercase mb-4">
              Open source
            </p>
            <h2 className="font-heading text-[clamp(1.9rem,3.2vw,2.6rem)] font-semibold tracking-tight leading-tight text-balance">
              Run it on your own machine.<br />Keep your data.
            </h2>
            <p className="mt-5 text-sm leading-relaxed text-muted-foreground max-w-sm">
              No monthly bill, no API key required to get started, no videos uploaded
              to a third-party service. Everything runs locally — the LLM provider is
              the only external call, and that&apos;s configurable.
            </p>
            <ul className="mt-6 flex flex-col gap-3">
              {points.map((p) => (
                <li key={p} className="flex items-start gap-2.5 text-sm text-muted-foreground">
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brand" />
                  {p}
                </li>
              ))}
            </ul>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild className="rounded-lg gap-2">
                <a href="https://github.com/roshankhanxox/redditify" target="_blank" rel="noopener noreferrer">
                  <GitFork className="size-4" />
                  Star on GitHub
                </a>
              </Button>
              <Button variant="outline" asChild className="rounded-lg border-white/12 hover:bg-white/5">
                <Link href="/sign-in">Open local instance</Link>
              </Button>
            </div>
          </div>

          {/* right — .env block */}
          <div className="overflow-hidden rounded-xl border border-white/10 bg-background">
            <div className="flex items-center justify-between border-b border-white/8 bg-white/[0.025] px-4 py-2.5">
              <span className="font-mono text-[11px] text-muted-foreground">backend/.env</span>
              <span className="font-mono text-[11px] text-muted-foreground/50">config</span>
            </div>
            <div className="px-5 py-5 font-mono text-[12.5px] leading-[1.85]">
              {envLines.map((line, i) =>
                "comment" in line ? (
                  <div key={i} className="text-muted-foreground/40">{line.text}</div>
                ) : (
                  <div key={i}>
                    <span className="text-muted-foreground">{line.key}</span>
                    <span className="text-muted-foreground/50">=</span>
                    <span className={line.kind === "bool" ? "text-brand" : "text-emerald-400/80"}>
                      {line.val}
                    </span>
                  </div>
                )
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
