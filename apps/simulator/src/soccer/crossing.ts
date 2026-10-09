// 護罩穿環（F9A 階段二）。與 apps/api/app/games/soccer_rules.py 同一套幾何：
// 看行進方向、不看機頭。後緣要跨過環的出口面（門面再往前半個環厚），
// 而且那一刻球心落在「內半徑 − 護罩半徑」裡，整顆才算穿過。

export interface RingCross {
  goalZ: number;
  goalY: number;
  goalR: number;
  shieldR: number;
  /** +1 = 必須往 +z 走；-1 = 必須往 -z 走 */
  attackSign: number;
  /**
   * 環的軸向半厚（公尺）= 管半徑。
   * 出口面 = 門面 + 行進方向 × 半厚。後緣沒離開這一側，不算穿環。
   */
  halfThick: number;
}

export function shieldPassesRing(
  prev: { x: number; y: number; z: number },
  curr: { x: number; y: number; z: number },
  ring: RingCross,
): boolean {
  const dz = curr.z - prev.z;
  if (ring.attackSign === 0 || dz * ring.attackSign <= 1e-9) return false;
  const sign = dz > 0 ? 1 : -1;
  const prevTrail = prev.z - ring.shieldR * sign;
  const currTrail = curr.z - ring.shieldR * sign;
  const exitZ = ring.goalZ + sign * ring.halfThick;
  if (sign > 0) {
    if (!(prevTrail < exitZ && currTrail >= exitZ)) return false;
  } else if (!(prevTrail > exitZ && currTrail <= exitZ)) {
    return false;
  }
  const span = currTrail - prevTrail;
  if (Math.abs(span) < 1e-12) return false;
  let t = (exitZ - prevTrail) / span;
  if (t < -1e-6 || t > 1 + 1e-6) return false;
  t = Math.min(1, Math.max(0, t));
  const cx = prev.x + (curr.x - prev.x) * t;
  const cy = prev.y + (curr.y - prev.y) * t;
  const clearance = ring.goalR - ring.shieldR;
  if (clearance <= 0) return false;
  return Math.hypot(cx, cy - ring.goalY) <= clearance + 1e-6;
}

/**
 * 跨 tick 的穿環。比賽仍用上面的單段函式（與伺服器同一套）。
 * 練習每 tick 只走一小段：後緣跨過出口面時，球心往往已經離開環厚一個護罩半徑。
 * 若只在那一刻檢查淨空，環厚裡本來整顆通過、離開後才側移或高度微晃，會被漏判。
 * 這裡記住「球心在環厚裡是否一直落在淨空」，後緣離開出口面時才結算。
 * 淨空仍是內半徑 − 護罩半徑；球心擦到環（徑向大於淨空）不算。
 */
export interface RingPassage {
  /** 球心已從進攻側進入環厚，後緣還沒離開出口面 */
  live: boolean;
  /** 環厚內球心都在淨空裡，前後帽緣也沒擦到框 */
  clean: boolean;
}

export function createRingPassage(): RingPassage {
  return { live: false, clean: true };
}

interface PassagePoint {
  x: number;
  y: number;
  z: number;
}

function lerpPassage(prev: PassagePoint, curr: PassagePoint, t: number): PassagePoint {
  return {
    x: prev.x + (curr.x - prev.x) * t,
    y: prev.y + (curr.y - prev.y) * t,
    z: prev.z + (curr.z - prev.z) * t,
  };
}

function axisRadial(p: PassagePoint, goalY: number): number {
  return Math.hypot(p.x, p.y - goalY);
}

/** 線段 z 與 [zA,zB] 重疊的 t（夾在 0..1）。沒重疊就是 null。 */
function tsOverlappingZ(
  prevZ: number,
  currZ: number,
  zA: number,
  zB: number,
): [number, number] | null {
  const dz = currZ - prevZ;
  const loZ = Math.min(zA, zB) - 1e-9;
  const hiZ = Math.max(zA, zB) + 1e-9;
  if (Math.abs(dz) < 1e-12) {
    if (prevZ < loZ || prevZ > hiZ) return null;
    return [0, 1];
  }
  const tA = (zA - prevZ) / dz;
  const tB = (zB - prevZ) / dz;
  const left = Math.max(0, Math.min(tA, tB));
  const right = Math.min(1, Math.max(tA, tB));
  if (left > right + 1e-9) return null;
  return [left, Math.max(left, right)];
}

export function advanceRingPassage(
  state: RingPassage,
  prev: PassagePoint,
  curr: PassagePoint,
  ring: RingCross,
): { state: RingPassage; passed: boolean } {
  const clearance = ring.goalR - ring.shieldR;
  const attack: 1 | -1 | 0 = ring.attackSign > 0 ? 1 : ring.attackSign < 0 ? -1 : 0;
  if (attack === 0 || clearance <= 0) return { state: createRingPassage(), passed: false };

  const entry = ring.goalZ - attack * ring.halfThick;
  const exit = ring.goalZ + attack * ring.halfThick;
  const dz = curr.z - prev.z;
  const forward = dz * attack > 1e-9;
  const beforeEntry = (z: number): boolean => (attack > 0 ? z < entry - 1e-9 : z > entry + 1e-9);

  let live = state.live;
  let clean = state.clean;
  if (!live && forward && beforeEntry(prev.z) && !beforeEntry(curr.z)) {
    live = true;
    clean = true;
  }

  const mark = (ok: boolean): void => {
    if (!ok) clean = false;
  };

  if (live) {
    const slab = tsOverlappingZ(prev.z, curr.z, entry, exit);
    if (slab) {
      const [lo, hi] = slab;
      for (const t of [lo, hi, (lo + hi) / 2]) {
        mark(axisRadial(lerpPassage(prev, curr, t), ring.goalY) <= clearance + 1e-6);
      }
    }
    // 帽緣：球心還沒進環厚、或已經離開環厚，但護罩仍伸進出口／入口面
    const caps: Array<{ face: number; outward: 1 | -1 }> = [
      { face: entry, outward: attack === 1 ? -1 : 1 },
      { face: exit, outward: attack },
    ];
    for (const cap of caps) {
      const span = tsOverlappingZ(prev.z, curr.z, cap.face, cap.face + cap.outward * ring.shieldR);
      if (!span) continue;
      const [lo, hi] = span;
      for (let i = 0; i <= 4; i++) {
        const t = lo + ((hi - lo) * i) / 4;
        const p = lerpPassage(prev, curr, t);
        const d = cap.outward * (p.z - cap.face);
        if (d <= 1e-6 || d >= ring.shieldR - 1e-6) continue;
        const section = Math.sqrt(Math.max(0, ring.shieldR * ring.shieldR - d * d));
        mark(axisRadial(p, ring.goalY) <= ring.goalR - section + 1e-6);
      }
    }
  }

  const prevTrail = prev.z - ring.shieldR * attack;
  const currTrail = curr.z - ring.shieldR * attack;
  const trailCrossed =
    attack > 0 ? prevTrail < exit && currTrail >= exit : prevTrail > exit && currTrail <= exit;

  let passed = false;
  if (live && forward && trailCrossed) {
    passed = clean;
    live = false;
    clean = true;
  } else if (live && beforeEntry(curr.z) && dz * attack < -1e-9) {
    live = false;
    clean = true;
  }

  return { state: { live, clean }, passed };
}

/** 護罩伸進圓環開口（自家圓環犯規）。只擦外管不算。 */
export function shieldOverlapsOpening(
  pos: { x: number; y: number; z: number },
  ring: { goalZ: number; goalY: number; goalR: number; shieldR: number },
): boolean {
  if (Math.abs(pos.z - ring.goalZ) > ring.shieldR + 1e-9) return false;
  return Math.hypot(pos.x, pos.y - ring.goalY) < ring.goalR + 1e-9;
}
