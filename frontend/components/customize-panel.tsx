"use client";

import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { DEFAULT_RENDER_SETTINGS, type RenderSettings } from "@/lib/types";

const CAPTION_COLOR_HEX: Record<RenderSettings["caption_color"], string> = {
  white: "#FFFFFF",
  yellow: "#FFE500",
  brand: "#FF452A",
};

const CAPTION_SAMPLE = "SO I QUIT MY JOB";
const PREVIEW_W = 180; // px on screen; represents the 1080px frame width

interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

const SEGMENTED_COLS: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-4",
};

/** Button-style segmented control — equal columns, perfectly centered labels. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      className={cn(
        "grid gap-1 rounded-lg border bg-muted/50 p-1",
        SEGMENTED_COLS[options.length] ?? "grid-cols-2",
        className,
      )}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "cursor-pointer rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
            value === o.value
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

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

export function CustomizePanel({
  value,
  onChange,
}: {
  value: RenderSettings;
  onChange: (patch: Partial<RenderSettings>) => void;
}) {
  return (
    <div className="flex flex-col gap-5">
      {/* Live preview — pure client-side mock of the 9:16 frame */}
      <div className="flex items-center justify-between">
        <Label>Live preview</Label>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 cursor-pointer text-muted-foreground"
          onClick={() => onChange(DEFAULT_RENDER_SETTINGS)}
        >
          <RotateCcw className="size-3.5" />
          Reset
        </Button>
      </div>

      <div className="flex justify-center">
        <div className="relative aspect-[9/16] w-full max-w-[180px] overflow-hidden rounded-lg border bg-gradient-to-b from-emerald-950 via-zinc-800 to-zinc-900">
          {value.title_enabled && <TitleCardMock s={value} />}
          {value.captions_enabled && <CaptionMock s={value} />}
        </div>
      </div>

      {/* Captions */}
      <div className="flex items-center justify-between">
        <Label>Captions</Label>
        <Switch
          checked={value.captions_enabled}
          onCheckedChange={(v) => onChange({ captions_enabled: v })}
        />
      </div>

      {value.captions_enabled && (
        <>
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label className="text-muted-foreground">Font size</Label>
              <span className="text-sm text-muted-foreground">{value.caption_font_size}px</span>
            </div>
            <Slider
              min={48}
              max={140}
              step={2}
              value={[value.caption_font_size]}
              onValueChange={([v]) => onChange({ caption_font_size: v })}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label className="text-muted-foreground">Position</Label>
            <Segmented
              value={value.caption_position}
              onChange={(v) => onChange({ caption_position: v })}
              options={[
                { value: "lower", label: "Lower" },
                { value: "center", label: "Center" },
                { value: "upper", label: "Upper" },
              ]}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label className="text-muted-foreground">Color</Label>
            <div className="flex justify-center gap-3">
              {(Object.keys(CAPTION_COLOR_HEX) as RenderSettings["caption_color"][]).map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`${c} captions`}
                  aria-pressed={value.caption_color === c}
                  onClick={() => onChange({ caption_color: c })}
                  className={cn(
                    "size-7 cursor-pointer rounded-full border-2 transition-all",
                    value.caption_color === c
                      ? "scale-110 border-primary"
                      : "border-transparent opacity-70 hover:opacity-100",
                  )}
                  style={{ backgroundColor: CAPTION_COLOR_HEX[c] }}
                />
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label className="text-muted-foreground">Outline</Label>
              <span className="text-sm text-muted-foreground">{value.caption_outline}</span>
            </div>
            <Slider
              min={0}
              max={12}
              step={1}
              value={[value.caption_outline]}
              onValueChange={([v]) => onChange({ caption_outline: v })}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label className="text-muted-foreground">Words per screen</Label>
            <Segmented
              value={String(value.caption_words) as "1" | "2" | "3"}
              onChange={(v) => onChange({ caption_words: Number(v) as 1 | 2 | 3 })}
              options={[
                { value: "1", label: "1 word" },
                { value: "2", label: "2 words" },
                { value: "3", label: "3 words" },
              ]}
            />
          </div>
        </>
      )}

      {/* Title card */}
      <div className="flex items-center justify-between">
        <Label>Title card</Label>
        <Switch
          checked={value.title_enabled}
          onCheckedChange={(v) => onChange({ title_enabled: v })}
        />
      </div>

      {value.title_enabled && (
        <>
          <div className="flex flex-col gap-2">
            <Label className="text-muted-foreground">Card position</Label>
            <Segmented
              value={value.title_position}
              onChange={(v) => onChange({ title_position: v })}
              options={[
                { value: "top", label: "Top" },
                { value: "bottom", label: "Bottom" },
              ]}
            />
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label className="text-muted-foreground">Card size</Label>
              <span className="text-sm text-muted-foreground">{value.title_scale}%</span>
            </div>
            <Slider
              min={60}
              max={130}
              step={5}
              value={[value.title_scale]}
              onValueChange={([v]) => onChange({ title_scale: v })}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label className="text-muted-foreground">Style</Label>
            <Segmented
              value={value.title_style}
              onChange={(v) => onChange({ title_style: v })}
              options={[
                { value: "dark", label: "Dark" },
                { value: "light", label: "Light" },
                { value: "minimal", label: "Minimal" },
              ]}
            />
          </div>

          <div className="flex items-center justify-between">
            <Label className="text-muted-foreground">Subreddit badge</Label>
            <Switch
              checked={value.title_badge}
              onCheckedChange={(v) => onChange({ title_badge: v })}
            />
          </div>
        </>
      )}
    </div>
  );
}
