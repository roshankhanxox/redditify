"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Type } from "lucide-react";
import useSWR from "swr";
import { api } from "@/lib/api";
import {
  clamp01,
  clampScale,
  pointerToNormalized,
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
  const dragRef = useRef<{ kind: "char" | "text"; index: number; dx: number; dy: number } | null>(null);
  const resizeRef = useRef<{ kind: "char" | "text"; index: number; startX: number; startScale: number; centerX: number } | null>(null);

  const charFiles = useMemo(() => {
    // asset display urls are stable per id — proxied through auth
    return new Map(characters.map((c) => [c.asset_id, `/api/proxy/characters/${c.asset_id}/file`]));
  }, [characters]);

  function setChar(i: number, patch: Partial<CharacterPlacement>) {
    const next = characters.map((c, k) => (k === i ? { ...c, ...patch } : c));
    onCharactersChange(next);
  }
  function setText(i: number, patch: Partial<TextPlacement>) {
    const next = texts.map((t, k) => (k === i ? { ...t, ...patch } : t));
    onTextsChange(next);
  }

  function onLayerPointerDown(
    e: React.PointerEvent,
    kind: "char" | "text",
    index: number,
  ) {
    e.stopPropagation();
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    setSelected({ kind, index });
    const pos = pointerToNormalized(e, rect);
    const cur =
      kind === "char"
        ? characters[index]
        : texts[index];
    if (!cur) return;
    dragRef.current = {
      kind,
      index,
      dx: pos.x - cur.x,
      dy: pos.y - cur.y,
    };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onCanvasPointerMove(e: React.PointerEvent) {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    if (dragRef.current) {
      const { kind, index, dx, dy } = dragRef.current;
      const pos = pointerToNormalized(e, rect);
      if (kind === "char") setChar(index, { x: clamp01(pos.x - dx), y: clamp01(pos.y - dy) });
      else setText(index, { x: clamp01(pos.x - dx), y: clamp01(pos.y - dy) });
      return;
    }

    if (resizeRef.current) {
      const r = resizeRef.current;
      const delta = (r.startX - e.clientX) / rect.width;
      const scale = clampScale(r.startScale + delta * 2, r.kind);
      if (r.kind === "char") setChar(r.index, { scale });
      else setText(r.index, { scale });
    }
  }

  function endPointer() {
    dragRef.current = null;
    resizeRef.current = null;
  }

  // Keyboard nudge / delete for the selected layer.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
      if (!selected) return;
      const step = e.shiftKey ? 0.05 : 0.01;
      const bump = (dx: number, dy: number) => {
        e.preventDefault();
        if (selected.kind === "char") {
          const c = characters[selected.index];
          if (c) setChar(selected.index, { x: clamp01(c.x + dx), y: clamp01(c.y + dy) });
        } else {
          const t = texts[selected.index];
          if (t) setText(selected.index, { x: clamp01(t.x + dx), y: clamp01(t.y + dy) });
        }
      };
      switch (e.key) {
        case "ArrowLeft": bump(-step, 0); break;
        case "ArrowRight": bump(step, 0); break;
        case "ArrowUp": bump(0, -step); break;
        case "ArrowDown": bump(0, step); break;
        case "Delete":
        case "Backspace":
          e.preventDefault();
          removeSelected();
          break;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, characters, texts]);

  function removeSelected() {
    if (!selected) return;
    if (selected.kind === "char") {
      onCharactersChange(characters.filter((_, k) => k !== selected.index));
    } else {
      onTextsChange(texts.filter((_, k) => k !== selected.index));
    }
    setSelected(null);
  }

  function addText() {
    const next: TextPlacement = {
      text: "YOUR TEXT",
      font_id: fonts?.[0]?.id ?? "anton",
      x: 0.5,
      y: Math.max(0.12, 0.15 + texts.length * 0.1),
      scale: 0.7,
      color: "#ffffff",
      align: "center",
    };
    onTextsChange([...texts, next].slice(0, 3));
    setSelected({ kind: "text", index: texts.length });
  }

  const sel =
    selected?.kind === "char"
      ? characters[selected.index]
      : selected?.kind === "text"
        ? texts[selected.index]
        : null;

  return (
    <div className="flex flex-col gap-4">
      {/* Canvas */}
      <div className="flex justify-center">
        <div
          ref={canvasRef}
          role="application"
          aria-label="Reel layer canvas"
          tabIndex={0}
          onPointerMove={onCanvasPointerMove}
          onPointerUp={endPointer}
          onPointerLeave={endPointer}
          onClick={() => setSelected(null)}
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
              aria-label={`Character ${i + 1}`}
              onPointerDown={(e) => onLayerPointerDown(e, "char", i)}
              style={{
                left: `${c.x * 100}%`,
                top: `${c.y * 100}%`,
                width: `${c.scale * 100}%`,
                transform: `translate(-50%,-50%) scaleX(${c.flip ? -1 : 1})`,
              }}
              className={cn(
                "absolute cursor-move",
                selected?.kind === "char" && selected.index === i && "outline-2 outline-brand",
              )}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={charFiles.get(c.asset_id)} alt="" draggable={false} className="w-full" />
            </div>
          ))}

          {texts.map((t, i) => (
            <div
              key={i}
              role="button"
              aria-label={`Text ${i + 1}`}
              onPointerDown={(e) => onLayerPointerDown(e, "text", i)}
              style={{
                left: `${t.x * 100}%`,
                top: `${t.y * 100}%`,
                width: `${Math.max(20, t.scale * 100)}%`,
                fontFamily: `'${t.font_id}', sans-serif`,
                color: t.color,
                textAlign: t.align,
                fontSize: `calc(${t.scale} * 3.4cqw)`,
                textShadow: "0 2px 6px rgb(0 0 0 / 45%)",
                lineHeight: 1.1,
              }}
              className={cn(
                "absolute -translate-x-1/2 -translate-y-1/2 cursor-move whitespace-pre-wrap px-1 font-bold uppercase",
                selected?.kind === "text" && selected.index === i && "outline-2 outline-brand",
              )}
            >
              {t.text}
            </div>
          ))}

          {/* Selected-layer resize handle */}
          {sel && (
            <button
              type="button"
              aria-label="Resize layer"
              onPointerDown={(e) => {
                e.stopPropagation();
                if (!selected || !canvasRef.current) return;
                const rect = canvasRef.current.getBoundingClientRect();
                resizeRef.current = {
                  kind: selected.kind,
                  index: selected.index,
                  startX: e.clientX,
                  startScale:
                    selected.kind === "char"
                      ? characters[selected.index]?.scale ?? 0.3
                      : texts[selected.index]?.scale ?? 0.5,
                  centerX: rect.left + rect.width / 2,
                };
                (e.target as HTMLElement).setPointerCapture(e.pointerId);
              }}
              style={{
                left: `${sel.x * 100}%`,
                top: `${sel.y * 100}%`,
                width: `${sel.scale * 100}%`,
              }}
              className="absolute -translate-x-1/2 translate-y-1/2"
            >
              <span className="absolute bottom-0 right-0 block size-3 rounded-full border-2 border-background bg-brand shadow-sm" />
            </button>
          )}
        </div>
      </div>

      {/* Add buttons */}
      <div className="flex items-center justify-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={addText}>
          <Type />
          Add text
        </Button>
        <p className="text-[13px] text-muted-foreground">
          <Plus className="mr-1 inline size-3" />
          add characters below, then drag here · arrows nudge · Del removes
        </p>
      </div>

      {/* Inspector */}
      {sel && (
        <div className="flex flex-col gap-3 rounded-lg border bg-card p-4">
          {selected?.kind === "text" && (() => {
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
                <Button type="button" variant="destructive" size="sm" onClick={removeSelected}>Remove text</Button>
              </>
            );
          })()}
          {selected?.kind === "char" && (() => {
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
                <Button type="button" variant="destructive" size="sm" onClick={removeSelected}>Remove character</Button>
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
