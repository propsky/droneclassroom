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
