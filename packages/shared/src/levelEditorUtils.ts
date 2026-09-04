// 關卡編輯器共用：座標吸附、範圍限制（零 runtime 依賴）。
export const EDITOR_WORLD = 30;
export const EDITOR_HALF = EDITOR_WORLD / 2;

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

/** 俯視標記依高度著色：低=藍、高=紅（業界常見 elevation 視覺化） */
export function heightHueColor(y: number, alpha = 0.85): string {
  const t = Math.max(0, Math.min(1, y / EDITOR_MAX_Y));
  const hue = 220 - t * 220;
  return `hsla(${hue}, 75%, 55%, ${alpha})`;
}
