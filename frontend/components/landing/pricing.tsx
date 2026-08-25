import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Check } from "lucide-react";

const freeFeatures = [
  "3 reels a day, 30 a month",
  "All ten voices and both engines",
  "Word-synced burned-in captions",
  "Every title card style",
];

const adminFeatures = [
  "No generation limits",
  "Gameplay asset library management",
  "User, job and quota oversight",
];

export function Pricing() {
  return (
    <section id="pricing" className="scroll-mt-24 py-32 md:py-48">
      <div className="mx-auto w-full max-w-4xl px-6">
        <div className="mb-14 text-center">
          <h2 className="font-heading text-4xl font-semibold tracking-tight text-balance md:text-5xl">
            Simple pricing.
          </h2>
          <p className="mx-auto mt-4 max-w-md text-sm text-balance text-muted-foreground">
            Start free. Render on the house while you grow your channel.
          </p>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="flex flex-col rounded-2xl border border-white/10 bg-card p-8">
            <p className="text-sm font-medium">Free</p>
            <p className="mt-4 text-5xl font-medium tracking-tighter">$0</p>
            <ul className="mt-8 flex flex-col gap-3">
              {freeFeatures.map((f) => (
                <li key={f} className="flex items-start gap-3 text-sm text-muted-foreground">
                  <Check className="mt-0.5 size-4 shrink-0 text-brand" />
                  {f}
                </li>
              ))}
            </ul>
            <Button className="mt-10 w-full rounded-full" size="lg" asChild>
              <Link href="/sign-up">Start creating</Link>
            </Button>
          </div>

          <div className="flex flex-col rounded-2xl border border-white/8 bg-card/60 p-8">
            <p className="text-sm font-medium">
              Admin
              <span className="ml-3 rounded-full border border-white/10 px-2.5 py-0.5 text-xs text-muted-foreground">
                invite only
              </span>
            </p>
            <p className="mt-4 text-5xl font-medium tracking-tighter">Unlimited</p>
            <ul className="mt-8 flex flex-col gap-3">
              {adminFeatures.map((f) => (
                <li key={f} className="flex items-start gap-3 text-sm text-muted-foreground">
                  <Check className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  {f}
                </li>
              ))}
            </ul>
            <Button
              variant="outline"
              disabled
              className="mt-10 w-full rounded-full border-white/15"
              size="lg"
            >
              Granted by your admin
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
