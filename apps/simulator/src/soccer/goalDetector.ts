// 無人機足球穿門判定（純幾何，不碰 Babylon / DOM）。
// 與 apps/api/app/games/soccer_rules.py 的 GoalDetector 同一套。
//
// 方向：維持原本規則。必須沿 attackSign 從場內向外穿（藍隊 +z、紅隊 −z）。
// 反向穿回場內不算。不看機頭朝向。
//
// 軸向：護罩後緣要跨過出口面（門面再往行進方向半個環厚）。
// 只碰到門面、或卡在框厚裡，不算穿過去。
//
// 徑向：護罩是一顆球。前後位置連成線段，看這顆球的掃掠體有沒有跟開口圓柱相交。
// 開口半徑是內半徑 goalR，軸向只涵蓋框厚，框管本身不算開口。
// 球心貼著內緣、甚至只有一部分球體伸進洞，都算。
// 球體只打到框管、或從框外面飛過去，不算。
// 不用「這一幀球心在不在某個小球裡」的抽樣，避免高速一幀跳過門面。

export interface GoalFrame {
  /** 門面 z（圓環中心面） */
  goalZ: number;
  /** 圓心高度 */
  goalY: number;
  /** 開口半徑（內半徑）。框管在這外面，不算開口。 */
  goalR: number;
  /** 護罩半徑（機體球半徑） */
  shieldR: number;
  /** 框的軸向半厚（管半徑）。出口面 = 門面 + 行進方向 × 半厚。 */
  halfThick: number;
  /** +1 必須往 +z；−1 必須往 −z；0 不判定 */
  attackSign: number;
}

export interface GoalPoint {
  x: number;
  y: number;
  z: number;
}

const DIR_EPS = 1e-9;
const HIT_EPS = 1e-6;

export class GoalDetector {
  /**
   * 這一段位移算不算進球。
   * 要同時滿足：沿進攻方向、後緣跨過出口面、掃掠球體碰到開口。
   */
  static crossed(prev: GoalPoint, curr: GoalPoint, goal: GoalFrame): boolean {
    if (!GoalDetector.trailingEdgeClearsExit(prev, curr, goal)) return false;
    return GoalDetector.sweptIntersectsOpening(prev, curr, goal);
  }

  /**
   * 護罩後緣是否在這一段、沿進攻方向跨過出口面。
   * 反向、幾乎沒動、或後緣還沒離開環厚，都回 false。
   */
  static trailingEdgeClearsExit(prev: GoalPoint, curr: GoalPoint, goal: GoalFrame): boolean {
    const sign = GoalDetector.attackMotionSign(prev, curr, goal.attackSign);
    if (sign === 0 || !(goal.halfThick >= 0)) return false;
    const prevTrail = prev.z - goal.shieldR * sign;
    const currTrail = curr.z - goal.shieldR * sign;
    const exitZ = goal.goalZ + sign * goal.halfThick;
    if (sign > 0) return prevTrail < exitZ && currTrail >= exitZ;
    return prevTrail > exitZ && currTrail <= exitZ;
  }

  /**
   * 半徑 shieldR 的球沿 prev→curr 掃過去，有沒有碰到開口圓柱。
   * 不看方向。開口是半徑 goalR、z 落在框厚裡的圓柱。
   */
  static sweptIntersectsOpening(prev: GoalPoint, curr: GoalPoint, goal: GoalFrame): boolean {
    if (!(goal.goalR > 0) || !(goal.shieldR >= 0) || !(goal.halfThick >= 0)) return false;
    const z0 = goal.goalZ - goal.halfThick;
    const z1 = goal.goalZ + goal.halfThick;
    const reach = goal.shieldR;

    const slab = tSpanOverlappingZ(prev.z, curr.z, z0, z1);
    if (slab) {
      const radial = minRadial(prev, curr, slab[0], slab[1], goal.goalY);
      if (radial <= goal.goalR + reach + HIT_EPS) return true;
    }

    const segLo = Math.min(prev.z, curr.z);
    const segHi = Math.max(prev.z, curr.z);
    if (segHi < z0 - reach - HIT_EPS || segLo > z1 + reach + HIT_EPS) return false;
    return minDistToOpening(prev, curr, goal.goalY, goal.goalR, z0, z1) <= reach + HIT_EPS;
  }

  /** 位移是否朝進攻方向。+1 / −1；反向或幾乎沒動為 0。 */
  static attackMotionSign(prev: GoalPoint, curr: GoalPoint, attackSign: number): 1 | -1 | 0 {
    const dz = curr.z - prev.z;
    if (attackSign === 0 || dz * attackSign <= DIR_EPS) return 0;
    return dz > 0 ? 1 : -1;
  }
}

function tSpanOverlappingZ(
  prevZ: number,
  currZ: number,
  zA: number,
  zB: number,
): [number, number] | null {
  const loZ = Math.min(zA, zB);
  const hiZ = Math.max(zA, zB);
  const dz = currZ - prevZ;
  if (Math.abs(dz) < 1e-12) {
    if (prevZ < loZ - HIT_EPS || prevZ > hiZ + HIT_EPS) return null;
    return [0, 1];
  }
  let tA = (loZ - prevZ) / dz;
  let tB = (hiZ - prevZ) / dz;
  if (tA > tB) {
    const swap = tA;
    tA = tB;
    tB = swap;
  }
  const lo = Math.max(0, tA);
  const hi = Math.min(1, tB);
  if (lo > hi + 1e-9) return null;
  return [lo, Math.max(lo, hi)];
}

/** 線段在 t0..t1 這一段，球心到門軸 (x=0, y=goalY) 的最近距離。 */
function minRadial(prev: GoalPoint, curr: GoalPoint, t0: number, t1: number, goalY: number): number {
  const ax = prev.x + (curr.x - prev.x) * t0;
  const ay = prev.y + (curr.y - prev.y) * t0 - goalY;
  const bx = prev.x + (curr.x - prev.x) * t1;
  const by = prev.y + (curr.y - prev.y) * t1 - goalY;
  return distPointToSegment2D(0, 0, ax, ay, bx, by);
}

function distPointToSegment2D(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const abx = bx - ax;
  const aby = by - ay;
  const ab2 = abx * abx + aby * aby;
  if (ab2 < 1e-24) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * abx + (py - ay) * aby) / ab2;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  return Math.hypot(ax + abx * t - px, ay + aby * t - py);
}

/** 點到實心有限圓柱的距離。圓柱半徑 goalR，軸在 x=0、y=goalY，z 介於 z0..z1。 */
function distToOpening(p: GoalPoint, goalY: number, goalR: number, z0: number, z1: number): number {
  const radial = Math.hypot(p.x, p.y - goalY);
  const dr = Math.max(0, radial - goalR);
  let dz = 0;
  if (p.z < z0) dz = z0 - p.z;
  else if (p.z > z1) dz = p.z - z1;
  if (dz === 0) return dr;
  if (dr === 0) return dz;
  return Math.hypot(dr, dz);
}

/**
 * 球心沿線段走到開口圓柱的最近距離。
 * 距離函數對凸集合是凸的，黃金分割找得到全域最小，不會漏掉中間才擦到的那一下。
 */
function minDistToOpening(
  prev: GoalPoint,
  curr: GoalPoint,
  goalY: number,
  goalR: number,
  z0: number,
  z1: number,
): number {
  const at = (t: number): number => {
    const p = {
      x: prev.x + (curr.x - prev.x) * t,
      y: prev.y + (curr.y - prev.y) * t,
      z: prev.z + (curr.z - prev.z) * t,
    };
    return distToOpening(p, goalY, goalR, z0, z1);
  };
  const end = Math.min(at(0), at(1));
  const gr = (Math.sqrt(5) - 1) / 2;
  let a = 0;
  let b = 1;
  let c = b - gr * (b - a);
  let d = a + gr * (b - a);
  let fc = at(c);
  let fd = at(d);
  let fa = at(a);
  let fb = at(b);
  for (let i = 0; i < 64; i++) {
    if (fc < fd) {
      b = d;
      fb = fd;
      d = c;
      fd = fc;
      c = b - gr * (b - a);
      fc = at(c);
    } else {
      a = c;
      fa = fc;
      c = d;
      fc = fd;
      d = a + gr * (b - a);
      fd = at(d);
    }
  }
  return Math.min(end, fa, fb, fc, fd);
}
