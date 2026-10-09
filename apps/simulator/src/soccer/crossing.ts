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

/** 護罩伸進圓環開口（自家圓環犯規）。只擦外管不算。 */
export function shieldOverlapsOpening(
  pos: { x: number; y: number; z: number },
  ring: { goalZ: number; goalY: number; goalR: number; shieldR: number },
): boolean {
  if (Math.abs(pos.z - ring.goalZ) > ring.shieldR + 1e-9) return false;
  return Math.hypot(pos.x, pos.y - ring.goalY) < ring.goalR + 1e-9;
}
