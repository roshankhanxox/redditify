import { VOICES, TTS_PROVIDERS } from "@/lib/voices";

export function VoiceMarquee() {
  const items = [...VOICES.map((v) => v.label), ...TTS_PROVIDERS.map((p) => p.label)];

  return (
    <section
      aria-label="Voices and speech engines"
      className="marquee overflow-hidden border-y border-white/5 py-6"
    >
      <div className="marquee-track flex w-max items-center gap-10">
        {[0, 1].map((copy) => (
          <div key={copy} aria-hidden={copy === 1} className="flex items-center gap-10">
            {items.map((label) => (
              <span
                key={`${copy}-${label}`}
                className="flex items-center gap-10 text-sm whitespace-nowrap text-muted-foreground"
              >
                {label}
                <span aria-hidden className="size-1 rounded-full bg-brand/70" />
              </span>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
