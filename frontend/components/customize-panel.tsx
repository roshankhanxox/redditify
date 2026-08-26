"use client";

import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { DEFAULT_RENDER_SETTINGS, CAPTION_POSITION_Y, type RenderSettings } from "@/lib/types";
import { CAPTION_COLOR_HEX, PhoneFramePreview } from "@/components/create/phone-preview";

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
            "cursor-pointer rounded-md px-2 py-1.5 text-[13px] font-medium transition-colors",
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

export function CustomizePanel({
  value,
  onChange,
  preview = true,
}: {
  value: RenderSettings;
  onChange: (patch: Partial<RenderSettings>) => void;
  /** Render the inline phone-frame mock (off when the wizard owns the rail). */
  preview?: boolean;
}) {
  return (
    <div className="flex flex-col gap-5">
      {preview && (
        <>
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
            <PhoneFramePreview settings={value} />
          </div>
        </>
      )}

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
              <span className="text-[13px] tabular-nums text-muted-foreground">{value.caption_font_size}px</span>
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
              onChange={(v) =>
                // Preset jumps keep the free-drag `caption_y` in sync.
                onChange({ caption_position: v, caption_y: CAPTION_POSITION_Y[v] })
              }
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
              <span className="text-[13px] tabular-nums text-muted-foreground">{value.caption_outline}</span>
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
              <span className="text-[13px] tabular-nums text-muted-foreground">{value.title_scale}%</span>
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
