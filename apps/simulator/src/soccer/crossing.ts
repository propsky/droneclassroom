// 護罩穿環（F9A）。幾何在 GoalDetector，與 apps/api/app/games/soccer_rules.py 同一套。
// 看行進方向、不看機頭。後緣要跨過環的出口面，而且掃掠球體要碰到開口（不含框管）。

import { GoalDetector, type GoalFrame, type GoalPoint } from './goalDetector';

export type RingCross = GoalFrame;

export function shieldPassesRing(prev: GoalPoint, curr: GoalPoint, ring: RingCross): boolean {
  return GoalDetector.crossed(prev, curr, ring);
}

/**
 * 跨 tick 的穿環。比賽單段仍用 shieldPassesRing（與伺服器同一套）。
 * 練習每 tick 只走一小段：球體通過開口時，後緣往往還沒離開出口面；
 * 離開時球心可能已經側移。這裡記住「這次接近有沒有掃到開口」，後緣離開才結算。
 * 開口仍是內半徑那顆圓柱；只打到框管不算。
 */
export interface RingPassage {
  /** 球心已從進攻側進入環厚，後緣還沒離開出口面 */
  live: boolean;
  /** 這次接近期間，掃掠體有跟開口相交 */
  throughOpening: boolean;
}

export function createRingPassage(): RingPassage {
  return { live: false, throughOpening: false };
}

export function advanceRingPassage(
  state: RingPassage,
  prev: GoalPoint,
  curr: GoalPoint,
  ring: RingCross,
): { state: RingPassage; passed: boolean } {
  const attack: 1 | -1 | 0 = ring.attackSign > 0 ? 1 : ring.attackSign < 0 ? -1 : 0;
  if (attack === 0 || !(ring.goalR > 0)) return { state: createRingPassage(), passed: false };

  const entry = ring.goalZ - attack * ring.halfThick;
  const dz = curr.z - prev.z;
  const forward = dz * attack > 1e-9;
  const beforeEntry = (z: number): boolean => (attack > 0 ? z < entry - 1e-9 : z > entry + 1e-9);

  let live = state.live;
  let throughOpening = state.throughOpening;
  if (!live && forward && beforeEntry(prev.z) && !beforeEntry(curr.z)) {
    live = true;
    throughOpening = false;
  }

  if (live && GoalDetector.sweptIntersectsOpening(prev, curr, ring)) {
    throughOpening = true;
  }

  let passed = false;
  if (live && GoalDetector.trailingEdgeClearsExit(prev, curr, ring)) {
    passed = throughOpening;
    live = false;
    throughOpening = false;
  } else if (live && beforeEntry(curr.z) && dz * attack < -1e-9) {
    live = false;
    throughOpening = false;
  }

  return { state: { live, throughOpening }, passed };
}

/** 護罩伸進圓環開口（自家圓環犯規）。只擦外管不算。 */
export function shieldOverlapsOpening(
  pos: { x: number; y: number; z: number },
  ring: { goalZ: number; goalY: number; goalR: number; shieldR: number },
): boolean {
  if (Math.abs(pos.z - ring.goalZ) > ring.shieldR + 1e-9) return false;
  return Math.hypot(pos.x, pos.y - ring.goalY) < ring.goalR + 1e-9;
}
