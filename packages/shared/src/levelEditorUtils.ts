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

/**
 * 2.5D 斜投影布局（2:1 dimetric，Tiled / Unity 等距瓦片常用比例）。
 * 世界 +X → 螢幕右下、+Z → 螢幕左下、+Y → 螢幕向上。
 */
export interface IsoLayout {
  cx: number;
  cy: number;
  /** 世界 1m 在 X 方向的螢幕跨度（經 (x-z) 合成） */
  tileW: number;
  /** 世界 1m 在 Z 深度的螢幕跨度（經 (x+z) 合成），約為 tileW 一半 */
  tileH: number;
  /** 世界 1m 高度對應螢幕向上像素 */
  yLift: number;
}

export function isoLayout(w: number, h: number): IsoLayout {
  const tileW = (w / (EDITOR_WORLD + 4)) * 2.4;
  const tileH = tileW * 0.5;
  return {
    cx: w / 2,
    cy: h * 0.52,
    tileW,
    tileH,
    yLift: tileH * 1.4,
  };
}

/** 繪製排序：越大越靠近觀察者（先畫後方） */
export function isoDepthKey(x: number, z: number, y = 0): number {
  return x + z - y * 0.02;
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

/**
 * 2.5D 斜投影：世界 → 螢幕。
 * 與俯視不同：X/Z 分別沿兩條斜軸散開，Y 僅向上偏移（不混入 X/Z）。
 */
export function isoWorldToCanvas(
  x: number,
  z: number,
  y: number,
  w: number,
  h: number,
): [number, number] {
  const { cx, cy, tileW, tileH, yLift } = isoLayout(w, h);
  const halfW = tileW * 0.5;
  const halfH = tileH * 0.5;
  const sx = cx + (x - z) * halfW;
  const sy = cy + (x + z) * halfH - y * yLift;
  return [sx, sy];
}

/**
 * 螢幕 → 世界 XZ，投射到水平面 y = planeY（拖曳時用物件實際高度，放置時用放置高度）。
 */
export function isoCanvasToWorld(
  px: number,
  py: number,
  w: number,
  h: number,
  planeY: number,
  step: number,
): { x: number; z: number } {
  const { cx, cy, tileW, tileH, yLift } = isoLayout(w, h);
  const halfW = tileW * 0.5;
  const halfH = tileH * 0.5;
  const isoX = px - cx;
  const depth = py - cy + planeY * yLift;
  const x = (isoX / halfW + depth / halfH) / 2;
  const z = (depth / halfH - isoX / halfW) / 2;
  return snapClampXZ(x, z, step);
}

/** 地面落點（y=0） */
export function isoGroundToCanvas(x: number, z: number, w: number, h: number): [number, number] {
  return isoWorldToCanvas(x, z, 0, w, h);
}

/** 側視：X 水平、Y 垂直 */
export function sideWorldToCanvas(x: number, y: number, w: number, h: number): [number, number] {
  const px = ((x + EDITOR_HALF) / EDITOR_WORLD) * w;
  const py = h - 10 - (y / EDITOR_MAX_Y) * (h - 24);
  return [px, py];
}
