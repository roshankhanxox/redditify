"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Pencil, Plus, Trash2, Type } from "lucide-react";
import useSWR from "swr";
import { api } from "@/lib/api";
import {
  clamp01,
  clampScale,
  type CharacterPlacement,
  type TextPlacement,
} from "@/lib/placement";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Segmented } from "@/components/customize-panel";
import { cn } from "@/lib/utils";

export interface FontOption {
  id: string;
  label: string;
}

const TEXT_COLORS = ["#ffffff", "#000000", "#ff4500", "#ffe500", "#00e5ff"];
const MAX_LAYERS = 3;

const TEXT_PRESETS: { label: string; patch: Partial<TextPlacement> }[] = [
  { label: "NOBODY:", patch: { text: "NOBODY:", font_id: "anton", scale: 0.55 } },
  { label: "POV:", patch: { text: "POV:", font_id: "bebasneue", scale: 0.7 } },
  { label: "WAIT FOR IT", patch: { text: "WAIT FOR IT", font_id: "patrickhand", scale: 0.5, color: "#ffe500" } },
  { label: "NOT ME…", patch: { text: "NOT ME…", font_id: "caveat", scale: 0.45 } },
];

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

type DragState =
  | { mode: "drag"; kind: "char" | "text"; index: number; startX: number; startY: number; origX: number; origY: number }
  | { mode: "resize"; kind: "char" | "text"; index: number; startX: number; origScale: number }
  | null;

export function LayerEditor({
  sceneId,
  characters,
  texts,
  onCharactersChange,
  onTextsChange,
}: {
  sceneId: string;
  characters: CharacterPlacement[];
  texts: TextPlacement[];
  onCharactersChange: (next: CharacterPlacement[]) => void;
  onTextsChange: (next: TextPlacement[]) => void;
}) {
  const { data: fonts } = useSWR<FontOption[]>("/fonts", fetcher);
  useFontFaces(fonts);

  const canvasRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<Selection | null>(null);
  const [editing, setEditing] = useState(false);
  const dragRef = useRef<DragState>(null);

  const charFiles = useMemo(
    () => new Map(characters.map((c) => [c.asset_id, `/api/proxy/characters/${c.asset_id}/file`])),
    [characters],
  );

  function setChar(i: number, patch: Partial<CharacterPlacement>) {
    onCharactersChange(characters.map((c, k) => (k === i ? { ...c, ...patch } : c)));
  }
  function setText(i: number, patch: Partial<TextPlacement>) {
    onTextsChange(texts.map((t, k) => (k === i ? { ...t, ...patch } : t)));
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

  function startResize(e: React.PointerEvent, kind: "char" | "text", index: number) {
    e.stopPropagation();
    setSelected({ kind, index });
    const cur = kind === "char" ? characters[index] : texts[index];
    if (!cur) return;
    dragRef.current = {
      mode: "resize",
      kind,
      index,
      startX: e.clientX,
      origScale: cur.scale,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onLayerPointerMove(e: React.PointerEvent) {
    const d = dragRef.current;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!d || !rect) return;
    if (d.mode === "drag") {
      const dx = (e.clientX - d.startX) / rect.width;
      const dy = (e.clientY - d.startY) / rect.height;
      const x = clamp01(d.origX + dx);
      const y = clamp01(d.origY + dy);
      if (d.kind === "char") setChar(d.index, { x, y });
      else setText(d.index, { x, y });
    } else {
      // Right edge of the box is the grip: drag outward to grow.
      const delta = ((e.clientX - d.startX) / rect.width) * 2;
      const scale = clampScale(d.origScale + delta, d.kind);
      if (d.kind === "char") setChar(d.index, { scale });
      else setText(d.index, { scale });
    }
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

  function addText(patch: Partial<TextPlacement> = {}) {
    if (texts.length >= MAX_LAYERS) return;
    const next: TextPlacement = {
      text: "YOUR TEXT",
      font_id: fonts?.[0]?.id ?? "anton",
      x: 0.5,
      y: Math.max(0.12, 0.15 + texts.length * 0.1),
      scale: 0.5,
      color: "#ffffff",
      align: "center",
      ...patch,
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

  function SelectionChrome({ kind, index }: { kind: "char" | "text"; index: number }) {
    const isSel = selected?.kind === kind && selected.index === index;
    if (!isSel) return null;
    return (
      <>
        {/* floating toolbar */}
        <div
          className="absolute -top-9 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-md border bg-background/95 p-1 shadow-sm"
          style={{ top: toolbarBelow ? undefined : "-2.25rem", bottom: toolbarBelow ? "-2.25rem" : undefined }}
        >
          {kind === "text" && (
            <button
              type="button"
              aria-label="Edit text"
              className="cursor-pointer rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={(e) => {
                e.stopPropagation();
                setEditing(true);
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
              removeAt(kind, index);
            }}
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
        {/* resize grip */}
        <span
          role="button"
          aria-label="Resize layer"
          onPointerDown={(e) => startResize(e, kind, index)}
          onPointerMove={onLayerPointerMove}
          onPointerUp={endDrag}
          className="absolute -bottom-1.5 -right-1.5 block size-4 cursor-nwse-resize rounded-full border-2 border-background bg-brand shadow-sm"
        />
      </>
    );
  }

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
              key={c.asset_id + i}
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
                transform: `translate(-50%,-50%) scaleX(${c.flip ? -1 : 1})`,
              }}
              className={cn(
                "absolute cursor-move touch-none",
                selected?.kind === "char" && selected.index === i &&
                  "outline outline-2 outline-brand",
              )}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={charFiles.get(c.asset_id)} alt="" draggable={false} className="w-full" />
              <SelectionChrome kind="char" index={i} />
            </div>
          ))}

          {texts.map((t, i) => {
            const isEditing = editing && selected?.kind === "text" && selected.index === i;
            return (
              <div
                key={`${i}-${t.text.slice(0, 8)}`}
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
                  fontSize: `calc(${t.scale} * 3.4cqw)`,
                  textShadow: "0 2px 6px rgb(0 0 0 / 45%)",
                  lineHeight: 1.1,
                  whiteSpace: "nowrap",
                }}
                className={cn(
                  "absolute max-w-[95cqw] -translate-x-1/2 -translate-y-1/2 cursor-move px-1 font-bold uppercase",
                  selected?.kind === "text" && selected.index === i && "outline outline-2 outline-brand",
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
                    className="w-40 rounded border bg-background/95 px-1 py-0.5 text-xs font-semibold normal-case text-foreground shadow-sm outline-none"
                  />
                ) : (
                  t.text || " "
                )}
                <SelectionChrome kind="text" index={i} />
              </div>
            );
          })}
        </div>
      </div>

      {/* Presets + add */}
      <div className="flex flex-col items-center gap-2">
        <div className="flex flex-wrap items-center justify-center gap-1.5">
          {TEXT_PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              disabled={texts.length >= MAX_LAYERS}
              onClick={() => addText({ y: 0.18 + Math.random() * 0.08, ...p.patch })}
              className="cursor-pointer rounded-full border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-brand/50 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            >
              {p.label}
            </button>
          ))}
        </div>
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
          drag to move · grip to resize · double-click text to edit · Del removes
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
                  <Slider min={10} max={95} step={1} value={[t.scale]} onValueChange={([v]) => setText(selected.index, { scale: v })} />
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
                  <Slider min={5} max={90} step={1} value={[c.scale]} onValueChange={([v]) => setChar(selected.index, { scale: v })} />
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
