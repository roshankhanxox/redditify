/**
 * Layer placement contract (mirrored by backend `_sanitize_layers_*`):
 * - x, y: normalized [0..1] frame coordinates, CENTER-anchored
 * - scale: fraction of FRAME WIDTH that the layer occupies
 * - flip/bob: character-only presentation flags
 *
 * The editor canvas is proportional to the real 1080x1920 frame, so CSS
 * percentages here and ffmpeg's x=W*x-w/2 math are the same function.
 */

export interface CharacterPlacement {
  asset_id: string;
  x: number;
  y: number;
  scale: number;
  flip: boolean;
  bob: boolean;
}

export interface TextPlacement {
  text: string;
  font_id: string;
  x: number;
  y: number;
  scale: number;
  color: string;
  align: "left" | "center" | "right";
}

export const LAYER_LIMITS = {
  maxLayersPerKind: 3,
  xMin: 0,
  xMax: 1,
  yMin: 0,
  yMax: 1,
  charScaleMin: 0.05,
  charScaleMax: 0.9,
  textScaleMin: 0.1,
  textScaleMax: 0.95,
} as const;

export function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

export function clampScale(v: number, kind: "char" | "text"): number {
  const [lo, hi] =
    kind === "char"
      ? [LAYER_LIMITS.charScaleMin, LAYER_LIMITS.charScaleMax]
      : [LAYER_LIMITS.textScaleMin, LAYER_LIMITS.textScaleMax];
  return Math.min(hi, Math.max(lo, v));
}

/** Convert a pointer event position into normalized canvas coords. */
export function pointerToNormalized(
  e: PointerEvent | React.PointerEvent,
  rect: DOMRect,
): { x: number; y: number } {
  return {
    x: clamp01((e.clientX - rect.left) / rect.width),
    y: clamp01((e.clientY - rect.top) / rect.height),
  };
}
