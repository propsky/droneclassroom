// 搖桿輸入純函式（零 DOM / 零 Gamepad API）— 供 gamepad.ts / calibration.ts / index.ts 共用與 Vitest 驗證。

export interface StickAxes {
  throttle: number;
  yaw: number;
  pitch: number;
  roll: number;
}

export interface UrlPresetOverrides {
  buttonMap?: { takeoff: number; land: number; reset: number };
  invertThrottle?: boolean;
  invertPitch?: boolean;
  deadzone?: number;
}

/** 單軸：(raw - center) / range → clamp → 死區 */
export function normalizeGamepadAxis(
  raw: number,
  center: number,
  range: number,
  deadzone: number,
): number {
  const norm = (raw - center) / (range || 1);
  const clamped = Math.max(-1, Math.min(1, norm));
  return Math.abs(clamped) < deadzone ? 0 : clamped;
}

/** 校正精靈結算：每軸 range 取 center 兩側最大飄移，保底 0.5 */
export function computeCalibRanges(center: number[], min: number[], max: number[]): number[] {
  const newRange = [1, 1, 1, 1];
  for (let i = 0; i < 4; i++) {
    const c = center[i] ?? 0;
    const downRange = Math.abs((min[i] ?? 0) - c);
    const upRange = Math.abs((max[i] ?? 0) - c);
    newRange[i] = Math.max(downRange, upRange, 0.5);
  }
  return newRange;
}

/** 搖桿來源互斥：Gamepad > BLE > 虛擬搖桿；校正中全零 */
export function resolveStickSource(opts: {
  calibrating: boolean;
  gamepadConnected: boolean;
  gamepad: StickAxes;
  ble: StickAxes | null;
  virtual: StickAxes;
}): StickAxes {
  if (opts.calibrating) return { throttle: 0, yaw: 0, pitch: 0, roll: 0 };
  if (opts.gamepadConnected) return opts.gamepad;
  if (opts.ble) return opts.ble;
  return opts.virtual;
}

/** URL 快速 preset（?map=switch / ?map=ipega / ?inv= / ?dz=） */
export function urlPresetOverrides(search: string): UrlPresetOverrides {
  const q = new URLSearchParams(search);
  const out: UrlPresetOverrides = {};
  const map = q.get('map');
  if (map === 'switch') {
    out.buttonMap = { takeoff: 1, land: 0, reset: 3 };
  } else if (map === 'ipega') {
    out.invertThrottle = true;
    out.buttonMap = { takeoff: 9, land: 8, reset: 0 };
  }
  const inv = q.get('inv');
  if (inv === 'y' || inv === '1') {
    out.invertThrottle = true;
    out.invertPitch = true;
  }
  const dz = parseFloat(q.get('dz') ?? '');
  if (!Number.isNaN(dz) && dz > 0) out.deadzone = dz;
  return out;
}

export function applyDeadzone(value: number, deadzone: number): number {
  return Math.abs(value) < deadzone ? 0 : value;
}

/** 按鍵邊緣偵測（BLE / Gamepad 共用） */
export function detectButtonEdge(current: boolean, previous: boolean): boolean {
  return current && !previous;
}
