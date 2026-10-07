// 搖桿 UI 導覽意圖（純函式）— 選單層與飛行層共用同一套方向 / 確認語意。
// 四向鎖定（取較大軸），避免斜推一次跳兩格。

export const PAD_NAV_THRESHOLD = 0.45;

export type Dir1 = -1 | 0 | 1;

export interface DigitalDir {
  x: Dir1;
  y: Dir1;
}

export interface DpadButtons {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
}

/** 類比軸 → 四向；+x 右、+y 上 */
export function digitalFromStick(x: number, y: number, threshold = PAD_NAV_THRESHOLD): DigitalDir {
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  if (ax < threshold && ay < threshold) return { x: 0, y: 0 };
  if (ax > ay) return { x: x > 0 ? 1 : -1, y: 0 };
  return { x: 0, y: y > 0 ? 1 : -1 };
}

export function digitalFromDpad(d: DpadButtons): DigitalDir {
  const x: Dir1 = d.right && !d.left ? 1 : d.left && !d.right ? -1 : 0;
  const y: Dir1 = d.up && !d.down ? 1 : d.down && !d.up ? -1 : 0;
  if (x !== 0 && y !== 0) return Math.abs(x) >= Math.abs(y) ? { x, y: 0 } : { x: 0, y };
  return { x, y };
}

/** D-pad 優先於類比（點擊更乾脆） */
export function mergeNav(stick: DigitalDir, dpad: DigitalDir): DigitalDir {
  if (dpad.x !== 0 || dpad.y !== 0) return dpad;
  return stick;
}

/** 由前到後取第一個非中立方向（D-pad → 左桿 → 右桿） */
export function coalesceNav(...dirs: DigitalDir[]): DigitalDir {
  for (const d of dirs) {
    if (d.x !== 0 || d.y !== 0) return d;
  }
  return { x: 0, y: 0 };
}

/**
 * 按住連發：第一次立刻觸發，之後 initialDelayTicks 再發，再每 repeatEveryTicks 發一次。
 * 回傳是否應在本 tick 移動一格。
 */
export function shouldRepeatNav(
  prev: DigitalDir,
  next: DigitalDir,
  heldTicks: number,
  initialDelayTicks: number,
  repeatEveryTicks: number,
): { fire: boolean; heldTicks: number } {
  if (next.x === 0 && next.y === 0) return { fire: false, heldTicks: 0 };
  if (next.x !== prev.x || next.y !== prev.y) return { fire: true, heldTicks: 1 };
  const held = heldTicks + 1;
  if (held === initialDelayTicks) return { fire: true, heldTicks: held };
  if (held > initialDelayTicks && (held - initialDelayTicks) % repeatEveryTicks === 0) {
    return { fire: true, heldTicks: held };
  }
  return { fire: false, heldTicks: held };
}

export function wrapIndex(index: number, delta: number, length: number): number {
  if (length <= 0) return 0;
  return ((index + delta) % length + length) % length;
}

/** 網格移動（列優先）；deltaX 右為正、deltaY 上為正 → 視覺上一格是 index-cols */
export function moveGridIndex(
  index: number,
  deltaX: Dir1,
  deltaY: Dir1,
  length: number,
  columns: number,
): number {
  if (length <= 0) return 0;
  const cols = Math.max(1, columns);
  if (cols === 1) {
    const delta = deltaX !== 0 ? deltaX : -deltaY;
    return wrapIndex(index, delta, length);
  }
  const rows = Math.ceil(length / cols);
  const col = index % cols;
  const row = Math.floor(index / cols);
  let nextCol = col + deltaX;
  let nextRow = row - deltaY;
  nextCol = ((nextCol % cols) + cols) % cols;
  nextRow = Math.max(0, Math.min(rows - 1, nextRow));
  const next = nextRow * cols + nextCol;
  return next < length ? next : index;
}
