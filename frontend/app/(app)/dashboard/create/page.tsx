import Link from "next/link";
import { ArrowRight, ImageIcon, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { TEMPLATES } from "@/lib/wizard";

function StoryThumb() {
  return (
    <div className="relative aspect-[9/16] w-20 overflow-hidden rounded-md border bg-zinc-900">
      <div className="absolute inset-x-1.5 top-1.5 rounded-sm bg-black/70 px-1 py-0.5">
        <p className="text-[6px] font-semibold text-white">r/AskReddit</p>
        <div className="mt-0.5 h-0.5 w-3/4 rounded-full bg-zinc-600" />
      </div>
      <p className="absolute inset-x-0 bottom-2 text-center text-[8px] font-extrabold tracking-tight text-white">
        SO I QUIT MY JOB
      </p>
    </div>
  );
}

function MemeThumb() {
  return (
    <div className="relative aspect-[9/16] w-20 overflow-hidden rounded-md border bg-gradient-to-b from-fuchsia-500 via-orange-400 to-yellow-300">
      <div className="absolute left-1/2 top-1/2 size-7 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-black/60 bg-white/90 p-0.5">
        <div className="size-full rounded-full bg-zinc-800" />
      </div>
      <p className="absolute inset-x-0 bottom-2 text-center text-[8px] font-black uppercase italic text-white [text-shadow:_0_1px_2px_rgb(0_0_0_/_60%)]">
        POV:
      </p>
    </div>
  );
}

function ImageThumb() {
  return (
    <div className="relative aspect-[9/16] w-20 overflow-hidden rounded-md border bg-muted">
      <ImageIcon className="absolute left-1/2 top-1/2 size-5 -translate-x-1/2 -translate-y-1/2 text-muted-foreground/50" />
      <div className="absolute inset-x-1 bottom-1.5 h-1.5 rounded-sm bg-background/85 px-0.5" />
    </div>
  );
}

const THUMBS = {
  story: <StoryThumb />,
  meme: <MemeThumb />,
  image: <ImageThumb />,
} as const;

export default function CreatePage() {
  return (
    <div className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
      <header className="mb-8">
        <h1 className="font-heading text-3xl font-semibold tracking-tight">
          Create a reel
        </h1>
        <p className="mt-1 text-base text-muted-foreground">
          Pick a format to get started — you can fine-tune everything after.
        </p>
      </header>

      <div className="grid gap-6 md:grid-cols-3">
        {TEMPLATES.map((t) => {
          const live = t.status === "live";
          const body = (
            <>
              <div className="flex aspect-[4/3] items-center justify-center rounded-lg border bg-muted/40">
                {THUMBS[t.id]}
              </div>
              <div className="flex flex-col gap-1.5 p-5 pt-4">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="font-heading text-lg font-semibold tracking-tight">
                    {t.name}
                  </h2>
                  {!live && (
                    <Badge variant="outline" className="text-xs">
                      Coming soon
                    </Badge>
                  )}
                </div>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {t.tagline}
                </p>
                {live && (
                  <span className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-brand">
                    Start creating
                    <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                  </span>
                )}
              </div>
            </>
          );

          const cardClass = live
            ? "group cursor-pointer transition-colors hover:border-brand/50"
            : "cursor-not-allowed opacity-55";

          return live ? (
            <Card key={t.id} className={`overflow-hidden ${cardClass}`}>
              <Link href={`/dashboard/create/${t.id}`} className="block outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {body}
              </Link>
            </Card>
          ) : (
            <Card key={t.id} className={`overflow-hidden ${cardClass}`} aria-disabled>
              {body}
            </Card>
          );
        })}
      </div>

      <p className="mt-8 flex items-center gap-2 text-[13px] text-muted-foreground">
        <Sparkles className="size-3.5 text-brand" />
        New formats ship regularly — Meme Studio and Custom Image are next.
      </p>
    </div>
  );
}
