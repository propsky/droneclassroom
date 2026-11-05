// 足球飛行手感。只改足球模式的推力路徑，不碰關卡物理與重播 hash。
// 搖桿命令傾角，鬆桿依該檔自動回正；滿舵的水平極速、升降速度用 m/s 定義，對齊場地大小
// （F9A-B 場只有 6 m 長、3 m 高，沿用關卡那套約 9 m/s 會一秒衝過全場）。
// 新手／模擬／專業有定高。無定高（Angle）傾角沿用模擬的 30°，鬆開上升會下降。
// 開了真實物理：改走 core/realFlight（油門＋重力＋慣性），傾角、反應、極速仍照這一檔。
import type { ControlFrame } from '../core/physics';
import { droneState, DRAG, MANUAL_LIFT, THRUST, TICK_HZ } from '../core/droneState';
import { RealFlight, type RealFlightTuning } from '../core/realFlight';
import { F9A_B } from './constants';
import { activeSoccerField } from './field';

export type SoccerFeelId = 'beginner' | 'sim' | 'pro' | 'angle';

export interface FeelProfile {
  id: SoccerFeelId;
  label: string;
  maxTiltDeg: number;
  /** 拉桿時，姿態追上目標傾角的每 tick 比例 */
  response: number;
  /** 鬆桿時回到水平的每 tick 比例（新手強、專業弱） */
  autoLevel: number;
  /** false = Angle 模式，沒有定高 */
  altitudeHold: boolean;
  /** 滿舵水平極速（m/s，F9A-B 場；大場依場地放大，見 soccerSpeedScale） */
  topSpeed: number;
  /** 滿桿升降速度（m/s） */
  climb: number;
  /** 無定高時鬆桿的下降速度（m/s）。定高檔為 0；上升滿桿淨爬升 = climb − sink */
  sink: number;
}

export const SOCCER_FEELS: Record<SoccerFeelId, FeelProfile> = {
  beginner: {
    id: 'beginner',
    label: '新手',
    maxTiltDeg: 18,
    response: 0.22,
    autoLevel: 0.2,
    altitudeHold: true,
    topSpeed: 1.8,
    climb: 1.2,
    sink: 0,
  },
  sim: {
    id: 'sim',
    label: '模擬',
    maxTiltDeg: 30,
    response: 0.16,
    autoLevel: 0.1,
    altitudeHold: true,
    topSpeed: 2.8,
    climb: 1.6,
    sink: 0,
  },
  pro: {
    id: 'pro',
    label: '專業',
    maxTiltDeg: 42,
    response: 0.14,
    autoLevel: 0.04,
    altitudeHold: true,
    topSpeed: 4,
    climb: 2.2,
    sink: 0,
  },
  angle: {
    id: 'angle',
    label: '無定高',
    maxTiltDeg: 30,
    response: 0.16,
    autoLevel: 0.1,
    altitudeHold: false,
    topSpeed: 2.8,
    climb: 2.4,
    sink: 1.2,
  },
};

/** 簡易物理滿推力的穩態速度（m/s）：每 tick 先加推力再乘阻力 → 位移 = 推力 / (1 − 阻力) */
export const ARCADE_TOP_MPS = (THRUST / (1 - DRAG)) * TICK_HZ;
/** 簡易物理滿桿升降的穩態速度（m/s） */
export const ARCADE_CLIMB_MPS = (MANUAL_LIFT / (1 - DRAG)) * TICK_HZ;

/**
 * 場地越大飛越快：F9A-B（半長 3 m）為 1，F9A-A（半長 7 m）約 1.5。
 * 開根號是因為大場的機體也大、但不會快到等比例（不然大場一樣難控）。
 */
export function soccerSpeedScale(halfZ: number = activeSoccerField().halfZ): number {
  const k = Math.sqrt(halfZ / F9A_B.halfZ);
  return k < 0.7 ? 0.7 : k > 1.6 ? 1.6 : k;
}
let feel: SoccerFeelId = 'sim';
let pitch = 0;
let roll = 0;

export function getSoccerFeel(): SoccerFeelId {
  return feel;
}

export function setSoccerFeel(id: SoccerFeelId): void {
  if (SOCCER_FEELS[id]) feel = id;
}

export function resetSoccerAttitude(): void {
  pitch = 0;
  roll = 0;
  droneState.attitudePitch = null;
  droneState.attitudeRoll = null;
}

/** 網址 ?feel=beginner|sim|pro|angle（只在瀏覽器初始化時讀，測試不碰 location） */
export function initSoccerFeelFromUrl(): void {
  if (typeof location === 'undefined') return;
  const q = new URLSearchParams(location.search).get('feel');
  if (q === 'beginner' || q === 'sim' || q === 'pro' || q === 'angle') feel = q;
}

function clampStick(v: number): number {
  if (v > 1) return 1;
  if (v < -1) return -1;
  return v;
}

/** 鎖控時的控制幀：不推、不轉、不起飛 */
const LOCKED_FRAME: ControlFrame = {
  forward: 0,
  right: 0,
  lift: 0,
  yawDelta: 0,
  wantsTakeoff: false,
  anyInput: false,
};

/**
 * 真實物理的足球參數：傾角、反應照這一檔；阻力讓「懸停油門＋滿舵傾角」的極速 = 這一檔的極速。
 * 極速時一半是一次阻力、一半是二次阻力：低速時鬆桿會滑一段（時間常數約 1 秒），不像簡易物理馬上停。
 */
export function soccerRealTuning(id: SoccerFeelId = feel, scale: number = soccerSpeedScale()): RealFlightTuning {
  const p = SOCCER_FEELS[id];
  const maxTilt = (p.maxTiltDeg * Math.PI) / 180;
  const v = p.topSpeed * scale;
  // 懸停時推力垂直分量 = 重量，水平分量 = g·tan(傾角)
  const a = RealFlight.G * Math.tan(maxTilt);
  return {
    maxTilt,
    attitudeGain: p.response,
    levelGain: p.autoLevel,
    dragLinear: (0.5 * a) / v,
    dragQuad: (0.5 * a) / (v * v),
  };
}

/**
 * 把搖桿改寫成傾角後的推力。
 * locked：搖桿無效（倒數鎖控等），姿態仍回正，水平推力為 0。
 * enabled 為 false：清掉姿態，控制幀原樣返回（關卡／大亂鬥）。
 * real：真實物理接手傾角與推力（core/realFlight），這裡只處理鎖控，搖桿原樣交出去。
 */
export function applySoccerFeel(
  frame: ControlFrame,
  opts: { enabled: boolean; locked: boolean; real?: boolean },
): ControlFrame {
  if (!opts.enabled || opts.real) {
    // 真實物理的傾角由 realFlight 寫進 droneState，這裡只清自己的，切回簡易從水平開始
    pitch = 0;
    roll = 0;
    if (!opts.enabled) resetSoccerAttitude();
    if (opts.enabled && opts.locked) return { ...LOCKED_FRAME };
    return frame;
  }
  const profile = SOCCER_FEELS[feel];
  const max = (profile.maxTiltDeg * Math.PI) / 180;
  const stickOn = !opts.locked && Math.hypot(frame.forward, frame.right) > 0.05;
  const targetPitch = opts.locked ? 0 : clampStick(frame.forward) * max;
  const targetRoll = opts.locked ? 0 : clampStick(frame.right) * max;
  const gain = stickOn ? profile.response : profile.autoLevel;
  pitch += (targetPitch - pitch) * gain;
  roll += (targetRoll - roll) * gain;
  const mag = Math.hypot(pitch, roll);
  if (mag > max && mag > 1e-8) {
    const k = max / mag;
    pitch *= k;
    roll *= k;
  }
  droneState.attitudePitch = pitch;
  droneState.attitudeRoll = roll;
  if (opts.locked) return { ...LOCKED_FRAME };
  const scale = soccerSpeedScale();
  // 滿舵傾角 → 這一檔的極速；中間傾角照 sin 比例（傾越多，水平分力越大）
  const tilt = Math.hypot(pitch, roll);
  const auth = ((profile.topSpeed * scale) / ARCADE_TOP_MPS) * (Math.sin(tilt) / Math.sin(max));
  let forward = 0;
  let right = 0;
  if (tilt > 1e-5) {
    forward = (pitch / tilt) * auth;
    right = (roll / tilt) * auth;
  }
  let lift = (frame.lift * profile.climb * scale) / ARCADE_CLIMB_MPS;
  if (!profile.altitudeHold && droneState.isFlying) lift -= (profile.sink * scale) / ARCADE_CLIMB_MPS;
  return { ...frame, forward, right, lift };
}

/** 測試用：直接看目前傾角（弧度） */
export function soccerAttitude(): { pitch: number; roll: number } {
  return { pitch, roll };
}
