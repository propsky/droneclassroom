// 足球飛行手感三檔。只改足球模式的水平推力路徑，不碰關卡物理與重播 hash。
// 搖桿命令傾角，鬆桿依該檔自動回正；水平推力 = sin(傾角) / sin(42°)，專業滿舵才是原本滿推力。
import type { ControlFrame } from '../core/physics';
import { droneState } from '../core/droneState';

export type SoccerFeelId = 'beginner' | 'sim' | 'pro';

export interface FeelProfile {
  id: SoccerFeelId;
  label: string;
  maxTiltDeg: number;
  /** 拉桿時，姿態追上目標傾角的每 tick 比例 */
  response: number;
  /** 鬆桿時回到水平的每 tick 比例（新手強、專業弱） */
  autoLevel: number;
}

export const SOCCER_FEELS: Record<SoccerFeelId, FeelProfile> = {
  beginner: { id: 'beginner', label: '新手', maxTiltDeg: 18, response: 0.22, autoLevel: 0.2 },
  sim: { id: 'sim', label: '模擬', maxTiltDeg: 30, response: 0.16, autoLevel: 0.1 },
  pro: { id: 'pro', label: '專業', maxTiltDeg: 42, response: 0.14, autoLevel: 0.04 },
};

const PRO_MAX_DEG = 42;

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

/** 網址 ?feel=beginner|sim|pro（只在瀏覽器初始化時讀，測試不碰 location） */
export function initSoccerFeelFromUrl(): void {
  if (typeof location === 'undefined') return;
  const q = new URLSearchParams(location.search).get('feel');
  if (q === 'beginner' || q === 'sim' || q === 'pro') feel = q;
}

function clampStick(v: number): number {
  if (v > 1) return 1;
  if (v < -1) return -1;
  return v;
}

/**
 * 把搖桿改寫成傾角後的推力。
 * locked：搖桿無效（倒數鎖控等），姿態仍回正，水平推力為 0。
 * enabled 為 false：清掉姿態，控制幀原樣返回（關卡／大亂鬥）。
 */
export function applySoccerFeel(
  frame: ControlFrame,
  opts: { enabled: boolean; locked: boolean },
): ControlFrame {
  if (!opts.enabled) {
    resetSoccerAttitude();
    return frame;
  }
  const profile = SOCCER_FEELS[feel];
  const max = (profile.maxTiltDeg * Math.PI) / 180;
  const proMax = (PRO_MAX_DEG * Math.PI) / 180;
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
  if (opts.locked) {
    return {
      ...frame,
      forward: 0,
      right: 0,
      lift: 0,
      yawDelta: 0,
      wantsTakeoff: false,
      anyInput: false,
    };
  }
  const tilt = Math.hypot(pitch, roll);
  const auth = Math.sin(proMax) > 1e-8 ? Math.sin(tilt) / Math.sin(proMax) : 0;
  let forward = 0;
  let right = 0;
  if (tilt > 1e-5) {
    forward = (pitch / tilt) * auth;
    right = (roll / tilt) * auth;
  }
  return { ...frame, forward, right };
}

/** 測試用：直接看目前傾角（弧度） */
export function soccerAttitude(): { pitch: number; roll: number } {
  return { pitch, roll };
}
