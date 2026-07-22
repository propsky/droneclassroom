// 角度/方位純函數 — 與 legacy 判定行為一致（度為單位，yaw 正向 = 左轉）。

/** 正規化到 [0, 360) */
export function normalizeDeg(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** 兩角最短差的絕對值（0–180） */
export function yawDiffDeg(a: number, b: number): number {
  let d = Math.abs(normalizeDeg(a) - normalizeDeg(b));
  if (d > 180) d = 360 - d;
  return d;
}

/** 帶方向的角差：>0 需往左轉、<0 需往右轉（-180, 180] */
export function signedYawDiffDeg(target: number, current: number): number {
  return ((normalizeDeg(target) - normalizeDeg(current) + 540) % 360) - 180;
}

/** 機頭方位文字：0=前、90=左、180=後、270=右（與 legacy headingLabel 一致） */
export function headingLabel(deg: number): string {
  const d = normalizeDeg(deg);
  if (d <= 45 || d > 315) return '前 ↑';
  if (d <= 135) return '左 ←';
  if (d <= 225) return '後 ↓';
  return '右 →';
}

export const RAD2DEG = 180 / Math.PI;
export const DEG2RAD = Math.PI / 180;

/** 含頭尾隨機整數（cf_random 積木語意） */
export function randomInt(a: number, b: number): number {
  const lo = Math.min(Math.floor(a), Math.floor(b));
  const hi = Math.max(Math.floor(a), Math.floor(b));
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}
