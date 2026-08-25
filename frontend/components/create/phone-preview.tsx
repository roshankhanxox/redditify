"use client";

import { cn } from "@/lib/utils";
import type { RenderSettings } from "@/lib/types";

export const CAPTION_COLOR_HEX: Record<RenderSettings["caption_color"], string> = {
  white: "#FFFFFF",
  yellow: "#FFE500",
  brand: "#FF452A",
};

const CAPTION_SAMPLE = "SO I QUIT MY JOB";
const PREVIEW_W = 180; // px on screen; represents the 1080px frame width

function TitleCardMock({ s }: { s: RenderSettings }) {
  return (
    <div
      className="absolute left-1/2 -translate-x-1/2 overflow-hidden rounded-sm px-2 py-1"
      style={{
        width: `${s.title_scale}%`,
        top: s.title_position === "top" ? "4%" : undefined,
        bottom: s.title_position === "bottom" ? "6%" : undefined,
        backgroundColor:
          s.title_style === "dark"
            ? "rgba(15,15,15,0.78)"
            : s.title_style === "light"
              ? "rgba(255,255,255,0.78)"
              : "transparent",
      }}
    >
      {s.title_badge && (
        <p className="text-[7px] font-bold leading-tight text-[#FF4500]">r/AskReddit</p>
      )}
      <p
        className={cn(
          "text-center font-semibold leading-snug",
          s.title_style === "light" ? "text-zinc-900" : "text-white",
        )}
        style={{ fontSize: "9px" }}
      >
        AITA for returning my roommate&apos;s vacuum?
      </p>
    </div>
  );
}

function CaptionMock({ s }: { s: RenderSettings }) {
  const px = (s.caption_font_size / 1080) * PREVIEW_W;
  const outlineW = Math.max(0.5, (s.caption_outline / 1080) * PREVIEW_W);
  const pos: React.CSSProperties =
    s.caption_position === "upper"
      ? { top: "22%" }
      : s.caption_position === "center"
        ? { top: "46%" }
        : { bottom: "12%" };
  return (
    <div
      className="absolute inset-x-0 flex justify-center px-1 text-center font-extrabold uppercase"
      style={{
        color: CAPTION_COLOR_HEX[s.caption_color],
        fontSize: `${px}px`,
        lineHeight: 1.05,
        WebkitTextStroke: `${outlineW}px black`,
        paintOrder: "stroke fill",
        ...pos,
      }}
    >
      {CAPTION_SAMPLE.split(" ").slice(0, s.caption_words).join(" ")}
    </div>
  );
}

/** Pure-CSS mock of the final 9:16 frame — WYSIWYG within preview tolerance.
 *  Deliberately exempt from the UI type-scale floor: it renders a video frame,
 *  not interface text. */
export function PhoneFramePreview({
  settings,
  className,
}: {
  settings: RenderSettings;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative aspect-[9/16] w-full max-w-[180px] overflow-hidden rounded-lg border bg-gradient-to-b from-emerald-950 via-zinc-800 to-zinc-900",
        className,
      )}
    >
      {settings.title_enabled && <TitleCardMock s={settings} />}
      {settings.captions_enabled && <CaptionMock s={settings} />}
    </div>
  );
}
