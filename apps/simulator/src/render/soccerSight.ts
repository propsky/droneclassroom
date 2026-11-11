// 全場／考證：鏡頭這一端擋視線的門環、端牆中橫梁、端牆網用固定半透明。
// 只改外觀。鏡位、碰撞、進球判定都不在這裡。
// 跟隨與第一人稱維持不透明。
import { CameraSight, type SightPoint } from './cameraSight';

/** 與 CameraViewMode 同一組字串。放在這裡避免 core 事件去依賴 render。 */
export type SoccerSightMode = 'follow' | 'team' | 'exam' | 'fpv';

/**
 * 半透明強度（1 = 不透明）。
 * 門環自發光很強，再高就還是一塊實心色；再低遠看會消失。
 * 端牆網原本就有自己的 alpha，套用時直接改成這個值。
 */
export const SOCCER_SIGHT_VEIL = 0.32;

/** 全場或考證，而且這一面就是鏡頭站的那一端，才淡化。 */
export function soccerSightVeiled(mode: SoccerSightMode, end: 1 | -1, nearEnd: 1 | -1): boolean {
  if (mode !== 'team' && mode !== 'exam') return false;
  return end === nearEnd;
}

// ---- 擋在鏡頭與機身之間的鋼架、燈具、計分板：當下淡掉 ----
// 柱子、橫梁、天花鋼架、燈具、吊帶、計分板，每幀用鏡頭→機身的線段檢查。
// 撞到（或鏡頭本身埋在裡面）就淡到 SOCCER_OCCLUDER_FADE，離開視線再慢慢恢復。

/** 擋住時的不透明度。太低會找不到柱子在哪，太高還是看不到後面的機身。 */
export const SOCCER_OCCLUDER_FADE = 0.18;
/** 物件外擴（m）：護罩半徑加一點餘裕，機身邊緣被擦到也算擋。 */
export const SOCCER_OCCLUDER_PAD = 0.25;
/** 淡入淡出的時間常數（ms）。 */
export const SOCCER_OCCLUDER_FADE_MS = 90;

export interface OccluderBox {
  min: SightPoint;
  max: SightPoint;
}

/** 鏡頭到機身的線段有沒有穿過（外擴後的）物件，或鏡頭埋在物件裡。 */
export function soccerOccludes(eye: SightPoint, target: SightPoint, box: OccluderBox, pad = SOCCER_OCCLUDER_PAD): boolean {
  const solid = {
    kind: 'aabb' as const,
    name: '',
    min: { x: box.min.x - pad, y: box.min.y - pad, z: box.min.z - pad },
    max: { x: box.max.x + pad, y: box.max.y + pad, z: box.max.z + pad },
  };
  if (CameraSight.contains(solid, eye) || CameraSight.contains(solid, target)) return true;
  return CameraSight.hitT(eye, target, solid) !== null;
}

/**
 * 物件在場上的角色。ceiling：天花鋼架、燈具；end：某一端的角柱與端牆橫梁；other：吊帶、計分板等。
 * 考證／全場是站在端線外、眼高固定的定點鏡頭：天花的東西從下往上看會蓋滿畫面上半，
 * 鏡頭這一端的柱子和橫梁就在眼前，兩者都直接淡掉；其他照視線判斷。
 */
export type OccluderRole = { kind: 'ceiling' } | { kind: 'end'; end: 1 | -1 } | { kind: 'other' };

export function soccerFixedViewClutter(mode: SoccerSightMode, role: OccluderRole, nearEnd: 1 | -1): boolean {
  if (mode !== 'team' && mode !== 'exam') return false;
  if (role.kind === 'ceiling') return true;
  return role.kind === 'end' && role.end === nearEnd;
}

/** 目前不透明度往目標走一步（指數逼近，跟幀率無關）。 */
export function stepOccluderFade(current: number, blocked: boolean, dtMs: number): number {
  const goal = blocked ? SOCCER_OCCLUDER_FADE : 1;
  const k = 1 - Math.exp(-Math.max(0, dtMs) / SOCCER_OCCLUDER_FADE_MS);
  const next = current + (goal - current) * k;
  return Math.abs(next - goal) < 0.01 ? goal : next;
}
