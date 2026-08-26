"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Pencil, Trash2, Type } from "lucide-react";
import useSWR from "swr";
import { api } from "@/lib/api";
import {
  clamp01,
  clampScale,
  LAYER_LIMITS,
  type CharacterPlacement,
  type TextPlacement,
} from "@/lib/placement";
import type { CaptionColor, CaptionLayout, CaptionMode, CaptionPosition } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Segmented } from "@/components/customize-panel";
import { CAPTION_COLOR_HEX } from "@/components/create/phone-preview";
import { cn } from "@/lib/utils";

export interface FontOption {
  id: string;
  label: string;
}

/** Captions preview wiring: the toggle flips `captions_enabled` on the job,
 *  and when ON the canvas shows a demo caption ghost — draggable vertically —
 *  styled with the same knobs the ASS renderer will burn in (`y` maps to
 *  MarginV as (1-y)*1920 on the backend). Mode: synced = Whisper word-synced;
 *  static = user text evenly sliced across the voiceover, no transcription. */
export interface CaptionPreview {
  enabled: boolean;
  y: number;
  fontSize: number;
  color: CaptionColor;
  outline: number;
  words: 1 | 2 | 3;
  position: CaptionPosition;
  mode?: CaptionMode;
  layout?: CaptionLayout;
  text?: string;
  onChange?: (enabled: boolean) => void;
  onYChange?: (y: number) => void;
  onModeChange?: (mode: CaptionMode) => void;
  onLayoutChange?: (layout: CaptionLayout) => void;
  onTextChange?: (text: string) => void;
}

const TEXT_COLORS = ["#ffffff", "#000000", "#ff4500", "#ffe500", "#00e5ff"];
const MAX_LAYERS = 3;
const CAPTION_SAMPLE = "SO I QUIT MY JOB";

const fetcher = (url: string) => api.get(url).then((r) => r.data);

/** Inject @font-face rules pointing at the render's own TTFs so the editor
 *  preview and the Pillow renderer share one source of typographic truth. */
function useFontFaces(fonts: FontOption[] | undefined) {
  useEffect(() => {
    if (!fonts?.length) return;
    const css = fonts
      .map(
        (f) =>
          `@font-face{font-family:'${f.id}';src:url('/api/proxy/fonts/${f.id}/file') format('truetype');font-display:block;}`,
      )
      .join("\n");
    let tag = document.getElementById("layer-fonts") as HTMLStyleElement | null;
    if (!tag) {
      tag = document.createElement("style");
      tag.id = "layer-fonts";
      document.head.appendChild(tag);
    }
    tag.textContent = css;
  }, [fonts]);
}

interface Selection {
  kind: "char" | "text";
  index: number;
}

type HandleId = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

interface DragState {
  mode: "drag" | "resize" | "rotate";
  kind: "char" | "text";
  index: number;
  // drag mode
  startX?: number;
  startY?: number;
  origX?: number;
  origY?: number;
  // resize mode — geometry measured at pointer-down, in canvas px.
  anchorX?: number; // fixed point (opposite corner / edge midpoint)
  anchorY?: number;
  dx0?: number; // signed vector anchor → live edge at start
  dy0?: number;
  dirX?: 0 | 1 | -1; // which way the center moves as the box grows
  dirY?: 0 | 1 | -1;
  boxW?: number;
  boxH?: number;
  cx0?: number;
  cy0?: number;
  origScale?: number;
  // rotate mode (characters)
  ccx?: number; // rotation center, canvas px
  ccy?: number;
  startAngle?: number; // pointer angle vs center at press
  origRotation?: number;
}

const HANDLES: { id: HandleId; className: string }[] = [
  { id: "nw", className: "size-3 -left-1.5 -top-1.5 cursor-nwse-resize" },
  { id: "n", className: "left-1/2 h-2 w-5 -top-1.5 -translate-x-1/2 cursor-ns-resize rounded-[3px]" },
  { id: "ne", className: "size-3 -right-1.5 -top-1.5 cursor-nesw-resize" },
  { id: "e", className: "-right-1.5 top-1/2 h-5 w-2 -translate-y-1/2 cursor-ew-resize rounded-[3px]" },
  { id: "se", className: "size-3 -bottom-1.5 -right-1.5 cursor-nwse-resize" },
  { id: "s", className: "left-1/2 h-2 w-5 -bottom-1.5 -translate-x-1/2 cursor-ns-resize rounded-[3px]" },
  { id: "sw", className: "size-3 -bottom-1.5 -left-1.5 cursor-nesw-resize" },
  { id: "w", className: "-left-1.5 top-1/2 h-5 w-2 -translate-y-1/2 cursor-ew-resize rounded-[3px]" },
];

/** Module-level so React keeps the same component type across renders — an
 *  inline definition would remount (and drop active pointer capture / swallow
 *  clicks) on every state tick. */
function SelectionChrome({
  kind,
  index,
  active,
  editing,
  below,
  onResizeStart,
  onRotateStart,
  onEdit,
  onDelete,
}: {
  kind: "char" | "text";
  index: number;
  active: boolean;
  editing: boolean;
  below: boolean;
  onResizeStart: (e: React.PointerEvent, kind: "char" | "text", index: number, handle: HandleId) => void;
  onRotateStart?: (e: React.PointerEvent, kind: "char" | "text", index: number) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  if (!active || (editing && kind === "text")) return null;
  return (
    <>
      {/* floating toolbar — pinned top-LEFT so the rotate stem owns top-center */}
      <div
        className="absolute left-0 z-20 flex items-center gap-1 rounded-md border bg-background/95 p-1 shadow-sm"
        style={{ top: below ? undefined : "-2.25rem", bottom: below ? "-2.25rem" : undefined }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {kind === "text" && (
          <button
            type="button"
            aria-label="Edit text"
            className="cursor-pointer rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
          >
            <Pencil className="size-3.5" />
          </button>
        )}
        <button
          type="button"
          aria-label="Delete layer"
          className="cursor-pointer rounded p-1 text-destructive hover:bg-destructive/10"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
      {/* rotation stem + knob (characters) */}
      {kind === "char" && onRotateStart && (
        <>
          <span
            aria-hidden
            className="pointer-events-none absolute -top-[26px] left-1/2 h-5 w-0.5 -translate-x-1/2 bg-brand/50"
          />
          <span
            role="button"
            aria-label="Rotate character"
            onPointerDown={(e) => onRotateStart(e, kind, index)}
            className="absolute -top-9 left-1/2 z-10 block size-4 -translate-x-1/2 cursor-grab touch-none rounded-full border-2 border-background bg-brand shadow-sm active:cursor-grabbing"
          />
        </>
      )}
      {/* corner + edge resize handles */}
      {HANDLES.map((h) => (
        <span
          key={h.id}
          role="button"
          aria-label={`Resize layer ${h.id}`}
          onPointerDown={(e) => onResizeStart(e, kind, index, h.id)}
          className={cn(
            "absolute z-10 block touch-none rounded-full border-2 border-background bg-brand shadow-sm",
            h.className,
          )}
        />
      ))}
    </>
  );
}

/** Draggable demo-caption ghost. Vertical only — libass centers captions
 *  horizontally and MarginV is what we expose. Deltas are measured against
 *  the CANVAS height (1px ≈ 0.19% of frame), never the ghost's own box. */
function CaptionGhost({
  y,
  fontSize,
  color,
  outline,
  words,
  sample,
  draggable,
  onYChange,
  canvasRef,
}: {
  y: number;
  fontSize: number;
  color: CaptionColor;
  outline: number;
  words: 1 | 2 | 3;
  sample?: string;
  draggable: boolean;
  onYChange?: (y: number) => void;
  canvasRef: React.RefObject<HTMLDivElement | null>;
}) {
  const dragRef = useRef<{ startY: number; origY: number; height: number } | null>(null);

  // Release-anywhere safety net — a missed pointerup must never leave the
  // drag armed (that read as "captions teleport on any mouse move").
  useEffect(() => {
    if (!draggable) return;
    const clear = () => {
      dragRef.current = null;
    };
    window.addEventListener("pointerup", clear);
    window.addEventListener("pointercancel", clear);
    return () => {
      window.removeEventListener("pointerup", clear);
      window.removeEventListener("pointercancel", clear);
    };
  }, [draggable]);

  function onPointerDown(e: React.PointerEvent) {
    if (!draggable || !onYChange || e.button !== 0) return;
    e.stopPropagation();
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragRef.current = { startY: e.clientY, origY: y, height: Math.max(rect.height, 1) };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d || !onYChange) return;
    e.stopPropagation();
    const dy = (e.clientY - d.startY) / d.height;
    onYChange(Math.min(0.95, Math.max(0.05, d.origY + dy)));
  }
  function onPointerUp() {
    dragRef.current = null;
  }

  const sizeCqw = ((fontSize / 1080) * 100).toFixed(3);
  const strokeCqw = ((outline / 1080) * 100).toFixed(3);
  return (
    <div
      className="absolute left-1/2 z-20 -translate-x-1/2 -translate-y-1/2"
      style={{ top: `${y * 100}%` }}
    >
      <div
        aria-hidden={!draggable}
        role={draggable ? "button" : undefined}
        aria-label={draggable ? "Captions placeholder — drag to position" : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className={cn(
          "relative w-max max-w-[92cqw]",
          draggable ? "cursor-grab touch-none active:cursor-grabbing" : "pointer-events-none",
        )}
      >
        <span className="absolute -top-4 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-black/65 px-1.5 py-px text-[8px] font-semibold uppercase tracking-wider text-white/75">
          captions · drag to place
        </span>
        <span
          className="block whitespace-nowrap text-center font-extrabold uppercase leading-tight outline outline-1 outline-dashed outline-white/35"
          style={{
            color: CAPTION_COLOR_HEX[color],
            fontSize: `calc(${sizeCqw} * 1cqw)`,
            WebkitTextStroke: `calc(${strokeCqw} * 1cqw) black`,
            paintOrder: "stroke fill",
          }}
        >
          {sample ?? CAPTION_SAMPLE.split(" ").slice(0, words).join(" ")}
        </span>
      </div>
    </div>
  );
}

export function LayerEditor({
  sceneId,
  characters,
  texts,
  captions,
  onCharactersChange,
  onTextsChange,
}: {
  sceneId: string;
  characters: CharacterPlacement[];
  texts: TextPlacement[];
  captions?: CaptionPreview;
  onCharactersChange: (next: CharacterPlacement[]) => void;
  onTextsChange: (next: TextPlacement[]) => void;
}) {
  const { data: fonts } = useSWR<FontOption[]>("/fonts", fetcher);
  useFontFaces(fonts);

  const canvasRef = useRef<HTMLDivElement>(null);
  const layerEls = useRef(new Map<string, HTMLElement>());
  const setLayerEl =
    (key: string) =>
    (el: HTMLElement | null): void => {
      if (el) layerEls.current.set(key, el);
      else layerEls.current.delete(key);
    };

  const [selected, setSelected] = useState<Selection | null>(null);
  const [editing, setEditing] = useState(false);
  const dragRef = useRef<DragState>(null);

  // Safety net: release anywhere guarantees a lost capture can never leave a
  // stale resize armed (the "hover shrinks the box" bug).
  useEffect(() => {
    const clear = () => {
      dragRef.current = null;
    };
    window.addEventListener("pointerup", clear);
    window.addEventListener("pointercancel", clear);
    return () => {
      window.removeEventListener("pointerup", clear);
      window.removeEventListener("pointercancel", clear);
    };
  }, []);

  const charFiles = useMemo(
    () => new Map(characters.map((c) => [c.asset_id, `/api/proxy/characters/${c.asset_id}/file`])),
    [characters],
  );

  function setChar(i: number, patch: Partial<CharacterPlacement>) {
    const safe =
      patch.scale !== undefined ? { ...patch, scale: clampScale(patch.scale, "char") } : patch;
    onCharactersChange(characters.map((c, k) => (k === i ? { ...c, ...safe } : c)));
  }
  function setText(i: number, patch: Partial<TextPlacement>) {
    const safe =
      patch.scale !== undefined ? { ...patch, scale: clampScale(patch.scale, "text") } : patch;
    onTextsChange(texts.map((t, k) => (k === i ? { ...t, ...safe } : t)));
  }

  // ------------------------------------------------------------- interactions

  function startDrag(e: React.PointerEvent, kind: "char" | "text", index: number) {
    if (editing && kind === "text" && selected?.kind === "text" && selected.index === index) {
      return; // typing inside the layer — don't hijack
    }
    e.stopPropagation();
    setSelected({ kind, index });
    setEditing(false);
    const cur = kind === "char" ? characters[index] : texts[index];
    if (!cur || !canvasRef.current) return;
    dragRef.current = {
      mode: "drag",
      kind,
      index,
      startX: e.clientX,
      startY: e.clientY,
      origX: cur.x,
      origY: cur.y,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function startResize(e: React.PointerEvent, kind: "char" | "text", index: number, handle: HandleId) {
    e.stopPropagation();
    setSelected({ kind, index });
    setEditing(false);
    const el = layerEls.current.get(`${kind}:${index}`);
    const canvas = canvasRef.current;
    const cur = kind === "char" ? characters[index] : texts[index];
    if (!el || !canvas || !cur) return;

    const crect = canvas.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const l = r.left - crect.left;
    const t = r.top - crect.top;
    const w = Math.max(r.width, 1);
    const h = Math.max(r.height, 1);

    const liveX = handle.includes("w")
      ? l
      : handle.includes("e")
        ? l + w
        : 0;
    const liveY = handle.includes("n")
      ? t
      : handle.includes("s")
        ? t + h
        : 0;
    const hasX = handle.includes("w") || handle.includes("e");
    const hasY = handle.includes("n") || handle.includes("s");

    // The opposite side/corner stays pinned; the grabbed handle tracks the finger.
    const anchorX = hasX ? (handle.includes("w") ? l + w : l) : l + w / 2;
    const anchorY = hasY ? (handle.includes("n") ? t + h : t) : t + h / 2;
    const dx0 = hasX ? liveX - anchorX : 0;
    const dy0 = hasY ? liveY - anchorY : 0;

    dragRef.current = {
      mode: "resize",
      kind,
      index,
      anchorX,
      anchorY,
      dx0,
      dy0,
      dirX: dx0 === 0 ? 0 : dx0 > 0 ? 1 : -1,
      dirY: dy0 === 0 ? 0 : dy0 > 0 ? 1 : -1,
      boxW: w,
      boxH: h,
      cx0: l + w / 2,
      cy0: t + h / 2,
      origScale: cur.scale > 0 ? cur.scale : 0.1,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function startRotate(e: React.PointerEvent, kind: "char" | "text", index: number) {
    e.stopPropagation();
    setSelected({ kind, index });
    setEditing(false);
    const el = layerEls.current.get(`char:${index}`);
    const canvas = canvasRef.current;
    const cur = characters[index];
    if (kind !== "char" || !el || !canvas || !cur) return;

    const crect = canvas.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const ccx = r.left - crect.left + r.width / 2;
    const ccy = r.top - crect.top + r.height / 2;
    dragRef.current = {
      mode: "rotate",
      kind: "char",
      index,
      ccx,
      ccy,
      startAngle: Math.atan2(e.clientY - crect.top - ccy, e.clientX - crect.left - ccx),
      origRotation: cur.rotation ?? 0,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function applyMove(d: DragState | null, e: React.PointerEvent) {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!d || !rect) return;

    if (d.mode === "drag") {
      const dx = (e.clientX - (d.startX ?? 0)) / rect.width;
      const dy = (e.clientY - (d.startY ?? 0)) / rect.height;
      const x = clamp01((d.origX ?? 0.5) + dx);
      const y = clamp01((d.origY ?? 0.5) + dy);
      if (d.kind === "char") setChar(d.index, { x, y });
      else setText(d.index, { x, y });
      return;
    }

    if (d.mode === "rotate") {
      // Track the angle between the rotation center and the pointer; Shift
      // snaps to 15° steps. Wrapped to [-180, 180].
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const ang = Math.atan2(py - (d.ccy ?? 0), px - (d.ccx ?? 0));
      let deg = (d.origRotation ?? 0) + ((ang - (d.startAngle ?? 0)) * 180) / Math.PI;
      if (e.shiftKey) deg = Math.round(deg / 15) * 15;
      deg = ((deg % 360) + 540) % 360 - 180;
      setChar(d.index, { rotation: Math.round(deg * 10) / 10 });
      return;
    }

    // Resize: scale the box proportionally around the anchored opposite side so
    // the dragged handle follows the pointer exactly — outward grows, inward shrinks.
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    let factor: number;
    if ((d.dx0 ?? 0) !== 0 && (d.dy0 ?? 0) !== 0) {
      factor =
        Math.hypot(px - (d.anchorX ?? 0), py - (d.anchorY ?? 0)) /
        Math.max(Math.hypot(d.dx0 ?? 1, d.dy0 ?? 1), 1);
    } else if ((d.dx0 ?? 0) !== 0) {
      factor = Math.abs(px - (d.anchorX ?? 0)) / Math.max(Math.abs(d.dx0 ?? 1), 1);
    } else if ((d.dy0 ?? 0) !== 0) {
      factor = Math.abs(py - (d.anchorY ?? 0)) / Math.max(Math.abs(d.dy0 ?? 1), 1);
    } else {
      return;
    }
    if (!Number.isFinite(factor) || factor < 0.02 || factor > 30) return;

    const scale = clampScale((d.origScale ?? 0.5) * factor, d.kind);
    const f = scale / (d.origScale ?? 0.5);
    if (!Number.isFinite(f) || f <= 0) return;

    const w = (d.boxW ?? 0) * f;
    const h = (d.boxH ?? 0) * f;
    const cx = (d.dirX ?? 0) !== 0 ? (d.anchorX ?? 0) + (d.dirX ?? 0) * (w / 2) : (d.cx0 ?? 0);
    const cy = (d.dirY ?? 0) !== 0 ? (d.anchorY ?? 0) + (d.dirY ?? 0) * (h / 2) : (d.cy0 ?? 0);
    const patch = { x: clamp01(cx / rect.width), y: clamp01(cy / rect.height), scale };
    if (d.kind === "char") setChar(d.index, patch);
    else setText(d.index, patch);
  }

  function onLayerPointerMove(e: React.PointerEvent) {
    applyMove(dragRef.current, e);
  }

  function endDrag() {
    dragRef.current = null;
  }

  function removeAt(kind: "char" | "text", index: number) {
    if (kind === "char") onCharactersChange(characters.filter((_, k) => k !== index));
    else onTextsChange(texts.filter((_, k) => k !== index));
    setSelected(null);
    setEditing(false);
  }

  // Keyboard nudge / delete for the selected layer.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement;
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable) return;
      if (!selected) return;
      const step = e.shiftKey ? 0.05 : 0.01;
      const cur = selected.kind === "char" ? characters[selected.index] : texts[selected.index];
      if (!cur) return;
      const bump = (dx: number, dy: number) => {
        e.preventDefault();
        if (selected.kind === "char") setChar(selected.index, { x: clamp01(cur.x + dx), y: clamp01(cur.y + dy) });
        else setText(selected.index, { x: clamp01(cur.x + dx), y: clamp01(cur.y + dy) });
      };
      switch (e.key) {
        case "ArrowLeft": bump(-step, 0); break;
        case "ArrowRight": bump(step, 0); break;
        case "ArrowUp": bump(0, -step); break;
        case "ArrowDown": bump(0, step); break;
        case "Enter":
          if (selected.kind === "text") {
            e.preventDefault();
            setEditing(true);
          }
          break;
        case "Delete":
        case "Backspace":
          e.preventDefault();
          removeAt(selected.kind, selected.index);
          break;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, characters, texts, editing]);

  function addText() {
    if (texts.length >= MAX_LAYERS) return;
    const next: TextPlacement = {
      text: "YOUR TEXT",
      font_id: fonts?.[0]?.id ?? "anton",
      x: 0.5,
      y: Math.max(0.12, 0.15 + texts.length * 0.1),
      scale: 0.28, // ≈ 67px @1080 — readable meme size out of the box
      color: "#ffffff",
      align: "center",
    };
    onTextsChange([...texts, next]);
    setSelected({ kind: "text", index: texts.length });
    setEditing(true); // straight into typing
  }

  const sel =
    selected?.kind === "char"
      ? characters[selected.index]
      : selected?.kind === "text"
        ? texts[selected.index]
        : null;

  // Selection toolbar flips below the layer when it hugs the top edge.
  const toolbarBelow = sel ? sel.y < 0.14 : false;

  return (
    <div className="flex flex-col gap-4">
      {/* Canvas */}
      <div className="flex justify-center">
        <div
          ref={canvasRef}
          role="application"
          aria-label="Reel layer canvas"
          tabIndex={0}
          onPointerDown={() => {
            setSelected(null);
            setEditing(false);
          }}
          className="relative aspect-[9/16] w-full max-w-[300px] touch-none select-none overflow-hidden rounded-xl border bg-zinc-900 outline-none [container-type:inline-size] focus-visible:ring-2 focus-visible:ring-ring"
        >
          <img
            src={`/api/proxy/scenes/${sceneId}/preview`}
            alt=""
            draggable={false}
            className="absolute inset-0 size-full object-cover"
          />

          {characters.map((c, i) => (
            <div
              key={`char-${i}`}
              ref={setLayerEl(`char:${i}`)}
              role="button"
              tabIndex={-1}
              aria-label={`Character ${i + 1}`}
              onPointerDown={(e) => startDrag(e, "char", i)}
              onPointerMove={onLayerPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              style={{
                left: `${c.x * 100}%`,
                top: `${c.y * 100}%`,
                width: `${c.scale * 100}%`,
                transform: `translate(-50%,-50%) scaleX(${c.flip ? -1 : 1}) rotate(${c.rotation ?? 0}deg)`,
              }}
              className={cn(
                "absolute cursor-move touch-none",
                selected?.kind === "char" && selected.index === i &&
                  "outline outline-2 outline-brand",
              )}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={charFiles.get(c.asset_id)} alt="" draggable={false} className="w-full" />
              <SelectionChrome
                kind="char"
                index={i}
                active={selected?.kind === "char" && selected.index === i}
                editing={editing}
                below={toolbarBelow}
                onResizeStart={startResize}
                onRotateStart={startRotate}
                onEdit={() => {}}
                onDelete={() => removeAt("char", i)}
              />
            </div>
          ))}

          {texts.map((t, i) => {
            const isSel = selected?.kind === "text" && selected.index === i;
            const isEditing = isSel && editing;
            return (
              <div
                key={`text-${i}`}
                ref={setLayerEl(`text:${i}`)}
                role="button"
                tabIndex={-1}
                aria-label={`Text ${i + 1}`}
                onPointerDown={(e) => {
                  if (isEditing) { e.stopPropagation(); return; }
                  startDrag(e, "text", i);
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  setSelected({ kind: "text", index: i });
                  setEditing(true);
                }}
                onPointerMove={onLayerPointerMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                style={{
                  left: `${t.x * 100}%`,
                  top: `${t.y * 100}%`,
                  fontFamily: `'${t.font_id}', sans-serif`,
                  color: t.color,
                  textAlign: t.align,
                  fontSize: `calc(${t.scale} * 22.2cqw)`,
                  textShadow: "0 2px 6px rgb(0 0 0 / 45%)",
                  lineHeight: 1.1,
                  whiteSpace: "nowrap",
                }}
                className={cn(
                  "absolute max-w-[95cqw] -translate-x-1/2 -translate-y-1/2 cursor-move px-1 font-bold uppercase",
                  isSel && "outline outline-2 outline-brand",
                )}
              >
                {isEditing ? (
                  <input
                    autoFocus
                    value={t.text}
                    maxLength={140}
                    onChange={(e) => setText(i, { text: e.target.value })}
                    onPointerDown={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === "Escape") {
                        e.stopPropagation();
                        setEditing(false);
                      }
                    }}
                    style={{
                      fontFamily: "inherit",
                      fontSize: "inherit",
                      fontWeight: "inherit",
                      lineHeight: "inherit",
                      textTransform: "inherit",
                      color: "inherit",
                      width: `${Math.min(24, Math.max(6, t.text.length + 1))}ch`,
                    }}
                    className="rounded border bg-background/85 py-0 pl-1 pr-1 shadow-sm outline-none"
                  />
                ) : (
                  t.text || " "
                )}
                <SelectionChrome
                  kind="text"
                  index={i}
                  active={!!isSel}
                  editing={editing}
                  below={toolbarBelow}
                  onResizeStart={startResize}
                  onEdit={() => setEditing(true)}
                  onDelete={() => removeAt("text", i)}
                />
              </div>
            );
          })}

          {/* Demo captions ghost — mirrors what the ASS burner will render. */}
          {captions?.enabled && (
            <CaptionGhost
              y={captions.y}
              fontSize={captions.fontSize}
              color={captions.color}
              outline={captions.outline}
              words={captions.words}
              sample={
                captions.mode === "static" && (captions.text ?? "").trim()
                  ? (captions.layout ?? "chunks") === "block"
                    ? (captions.text ?? "").trim()
                    : (captions.text ?? "").trim().split(/\s+/).slice(0, captions.words * 2).join(" ")
                  : undefined
              }
              draggable={!!captions.onYChange}
              onYChange={captions.onYChange}
              canvasRef={canvasRef}
            />
          )}
        </div>
      </div>

      {/* Captions toggle + mode */}
      {captions && (
        <div className="flex flex-col gap-3 rounded-lg border bg-card px-3 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-col">
              <Label>Captions</Label>
              <p className="text-[13px] text-muted-foreground">
                {captions.mode === "static"
                  ? "Your text, evenly timed across the voiceover."
                  : "Auto word-synced captions on the voiceover."}
              </p>
            </div>
            <Switch
              checked={captions.enabled}
              disabled={!captions.onChange}
              onCheckedChange={(v) => captions.onChange?.(v)}
            />
          </div>
          {captions.enabled && captions.onModeChange && (
            <>
              <Segmented
                value={captions.mode ?? "synced"}
                onChange={(v) => captions.onModeChange?.(v as CaptionMode)}
                options={[
                  { value: "synced", label: "Synced (auto)" },
                  { value: "static", label: "Static (typed)" },
                ]}
              />
              {captions.mode === "static" && (
                <div className="flex flex-col gap-1">
                  {captions.onLayoutChange && (
                    <Segmented
                      value={captions.layout ?? "chunks"}
                      onChange={(v) => captions.onLayoutChange?.(v as CaptionLayout)}
                      options={[
                        { value: "chunks", label: "Timed chunks" },
                        { value: "block", label: "Full screen" },
                      ]}
                    />
                  )}
                  <Textarea
                    rows={3}
                    maxLength={600}
                    value={captions.text ?? ""}
                    placeholder={"Caption text — shown in chunks.\ne.g. WAIT FOR IT...\nNOBODY EXPECTED THIS"}
                    onChange={(e) => captions.onTextChange?.(e.target.value)}
                    className="text-sm"
                  />
                  <p className="text-[13px] text-muted-foreground">
                    {(captions.layout ?? "chunks") === "block"
                      ? `Whole text on one auto-fitted screen — ${captions.words} words per line.`
                      : `Auto-split into ${captions.words}-word chunks, evenly timed.`}
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      )}

      <div className="flex flex-col items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => addText()}
          disabled={texts.length >= MAX_LAYERS}
        >
          <Type />
          Add text
        </Button>
        <p className="text-[13px] text-muted-foreground">
          drag to move · corners &amp; edges resize · top knob rotates (Shift = 15° steps) · double-click text to edit · Del removes
        </p>
      </div>

      {/* Inspector */}
      {sel && selected && (
        <div className="flex flex-col gap-3 rounded-lg border bg-card p-4">
          {selected.kind === "text" && (() => {
            const t = texts[selected.index];
            if (!t) return null;
            return (
              <>
                <Row label="Text">
                  <Input value={t.text} onChange={(e) => setText(selected.index, { text: e.target.value })} maxLength={140} />
                </Row>
                <Row label="Font">
                  <Select value={t.font_id} onValueChange={(v) => setText(selected.index, { font_id: v })}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(fonts ?? []).map((f) => (
                        <SelectItem key={f.id} value={f.id}>{f.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Row>
                <Row label="Color">
                  <div className="flex gap-3">
                    {TEXT_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        aria-label={`color ${c}`}
                        onClick={() => setText(selected.index, { color: c })}
                        className={cn(
                          "size-7 cursor-pointer rounded-full border-2 transition-all",
                          t.color === c ? "scale-110 border-brand" : "border-transparent opacity-70 hover:opacity-100",
                        )}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                </Row>
                <Row label="Align">
                  <Segmented
                    value={t.align}
                    onChange={(v) => setText(selected.index, { align: v })}
                    options={[
                      { value: "left", label: "Left" },
                      { value: "center", label: "Center" },
                      { value: "right", label: "Right" },
                    ]}
                  />
                </Row>
                <Row label="Size" hint={`${Math.round(t.scale * 100)}%`}>
                  <Slider
                    min={LAYER_LIMITS.textScaleMin}
                    max={LAYER_LIMITS.textScaleMax}
                    step={0.01}
                    value={[t.scale]}
                    onValueChange={([v]) => setText(selected.index, { scale: v })}
                  />
                </Row>
                <Button type="button" variant="destructive" size="sm" onClick={() => removeAt("text", selected.index)}>
                  <Trash2 />
                  Remove text
                </Button>
              </>
            );
          })()}
          {selected.kind === "char" && (() => {
            const c = characters[selected.index];
            if (!c) return null;
            return (
              <>
                <Row label="Flip horizontally">
                  <Button type="button" variant="outline" size="sm" onClick={() => setChar(selected.index, { flip: !c.flip })}>
                    Flip
                  </Button>
                </Row>
                <Row label="Rotation" hint={`${Math.round(c.rotation ?? 0)}°`}>
                  <Slider
                    min={-180}
                    max={180}
                    step={1}
                    value={[c.rotation ?? 0]}
                    onValueChange={([v]) => setChar(selected.index, { rotation: v })}
                  />
                </Row>
                <Row label="Bobbing animation">
                  <Segmented
                    value={c.bob ? "on" : "off"}
                    onChange={(v) => setChar(selected.index, { bob: v === "on" })}
                    options={[
                      { value: "off", label: "Static" },
                      { value: "on", label: "Bob" },
                    ]}
                  />
                </Row>
                <Row label="Size" hint={`${Math.round(c.scale * 100)}%`}>
                  <Slider
                    min={LAYER_LIMITS.charScaleMin}
                    max={LAYER_LIMITS.charScaleMax}
                    step={0.01}
                    value={[c.scale]}
                    onValueChange={([v]) => setChar(selected.index, { scale: v })}
                  />
                </Row>
                <Button type="button" variant="destructive" size="sm" onClick={() => removeAt("char", selected.index)}>
                  <Trash2 />
                  Remove character
                </Button>
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}

function Row({ label, children, hint }: { label: string; children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <Label>{label}</Label>
        {hint ? <span className="text-[13px] tabular-nums text-muted-foreground">{hint}</span> : null}
      </div>
      {children}
    </div>
  );
}
