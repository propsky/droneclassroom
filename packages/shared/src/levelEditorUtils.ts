// 關卡編輯器共用：座標吸附、範圍限制、視角投影（零 runtime 依賴）。
export const EDITOR_WORLD = 30;
export const EDITOR_HALF = EDITOR_WORLD / 2;

/** 任務圈預設尺寸（與 apps/simulator render/levelMeshes 一致） */
export const DEFAULT_RING_DIAMETER = 3;
export const DEFAULT_RING_THICKNESS = 0.24;

export type EditorViewMode = 'top' | 'iso' | 'side';

/** 將世界座標吸附到格點；step=0 表示只四捨五入到 0.1m */
export function snapWorld(v: number, step: number): number {
  if (step <= 0) return Math.round(v * 10) / 10;
  return Math.round(v / step) * step;
}

export function clampWorld(v: number, half = EDITOR_HALF): number {
  return Math.max(-half, Math.min(half, v));
}

export function snapClampXZ(
  x: number,
  z: number,
  step: number,
): { x: number; z: number } {
  return {
    x: snapWorld(clampWorld(x), step),
    z: snapWorld(clampWorld(z), step),
  };
}

/** 編輯器高度上限（與模擬器教室空間一致） */
export const EDITOR_MAX_Y = 8;

/** 俯視標記依高度著色：低=藍、高=紅 */
export function heightHueColor(y: number, alpha = 0.85): string {
  const t = Math.max(0, Math.min(1, y / EDITOR_MAX_Y));
  const hue = 220 - t * 220;
  return `hsla(${hue}, 75%, 55%, ${alpha})`;
}

export function ringDiameter(ring: { diameter?: number } | undefined): number {
  const d = ring?.diameter;
  return d != null && d > 0 ? d : DEFAULT_RING_DIAMETER;
}

export function ringThickness(ring: { thickness?: number } | undefined): number {
  const t = ring?.thickness;
  return t != null && t > 0 ? t : DEFAULT_RING_THICKNESS;
}

/** 穿圈判定半徑（模擬器 core/level 用） */
export function ringPassRadius(ring: { diameter?: number } | undefined): number {
  return ringDiameter(ring) / 2;
}

const ISO_COS = Math.SQRT1_2;
const ISO_SIN = Math.SQRT1_2;

function canvasScale(w: number): number {
  return w / (EDITOR_WORLD + 4);
}

/** 俯視：世界 XZ → canvas 像素 */
export function topWorldToCanvas(x: number, z: number, w: number, h: number): [number, number] {
  return [((x + EDITOR_HALF) / EDITOR_WORLD) * w, ((z + EDITOR_HALF) / EDITOR_WORLD) * h];
}

export function topCanvasToWorld(
  px: number,
  py: number,
  w: number,
  h: number,
  step: number,
): { x: number; z: number } {
  const rawX = (px / w) * EDITOR_WORLD - EDITOR_HALF;
  const rawZ = (py / h) * EDITOR_WORLD - EDITOR_HALF;
  return snapClampXZ(rawX, rawZ, step);
}

/** 2.5D 等距：Y 越大畫面越往上浮 */
export function isoWorldToCanvas(
  x: number,
  z: number,
  y: number,
  w: number,
  h: number,
): [number, number] {
  const scale = canvasScale(w);
  const cx = w / 2;
  const cy = h * 0.58;
  const isoX = (x - z) * ISO_COS * scale;
  const groundZ = (x + z) * ISO_SIN * scale;
  const lift = y * scale * 1.15;
  return [cx + isoX, cy + groundZ - lift];
}

export function isoCanvasToWorld(
  px: number,
  py: number,
  w: number,
  h: number,
  placeY: number,
  step: number,
): { x: number; z: number } {
  const scale = canvasScale(w);
  const cx = w / 2;
  const cy = h * 0.58;
  const isoX = px - cx;
  const groundZ = py - cy + placeY * scale * 1.15;
  const x = (isoX / (ISO_COS * scale) + groundZ / (ISO_SIN * scale)) / 2;
  const z = (groundZ / (ISO_SIN * scale) - isoX / (ISO_COS * scale)) / 2;
  return snapClampXZ(x, z, step);
}

/** 側視：X 水平、Y 垂直 */
export function sideWorldToCanvas(x: number, y: number, w: number, h: number): [number, number] {
  const px = ((x + EDITOR_HALF) / EDITOR_WORLD) * w;
  const py = h - 10 - (y / EDITOR_MAX_Y) * (h - 24);
  return [px, py];
}
