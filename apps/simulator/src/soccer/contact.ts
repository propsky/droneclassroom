// 足球碰撞：機對機對齊護罩半徑、互推反作用；牆面用護罩半徑做輕微彈性反彈（速度不硬夾成 0）。

export const SOCCER_CONTACT_RESTITUTION = 0.45;
/** 牆面恢復係數：輕微彈開，不是黏在牆上 */
export const SOCCER_WALL_RESTITUTION = 0.22;
/** 每 tick 法線接近速度超過這個值才算一次撞擊回饋（約 1.2 m/s） */
export const SOCCER_IMPACT_TICK = 0.02;

export interface ContactSelf {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

/**
 * 本機與另一台護罩球。重疊時把本機推到最小間距（本機視角不穿模），
 * 並沿法線加反彈與互推。對方客戶端用法線相反的同一式推自己。
 * d≈0 時用 id 字典序把兩邊推向相反方向，避免除以零後同步漂移。
 */
export function resolveShieldContact(
  self: ContactSelf,
  other: { x: number; y: number; z: number },
  myId: string,
  otherId: string,
  radius: number,
  restitution: number = SOCCER_CONTACT_RESTITUTION,
): { separated: boolean; impact: number } {
  let dx = self.x - other.x;
  let dy = self.y - other.y;
  let dz = self.z - other.z;
  let d = Math.hypot(dx, dy, dz);
  const minDist = radius * 2;
  if (d >= minDist) return { separated: false, impact: 0 };
  if (d < 1e-6) {
    dx = myId < otherId ? -1 : 1;
    dy = 0;
    dz = 0;
    d = 1;
  }
  const nx = dx / d;
  const ny = dy / d;
  const nz = dz / d;
  const overlap = minDist - d;
  self.x = other.x + nx * minDist;
  self.y = other.y + ny * minDist;
  self.z = other.z + nz * minDist;
  const vDot = self.vx * nx + self.vy * ny + self.vz * nz;
  if (vDot < 0) {
    // 等質量：接近分量的一半衝量留在本機（另一半由對方客戶端承受）
    const impulse = (1 + restitution) * 0.5;
    self.vx -= vDot * nx * impulse;
    self.vy -= vDot * ny * impulse;
    self.vz -= vDot * nz * impulse;
  }
  const push = Math.min(overlap, 0.2) * 0.8;
  self.vx += nx * push;
  self.vy += ny * push;
  self.vz += nz * push;
  return { separated: true, impact: vDot < 0 ? -vDot : 0 };
}

/**
 * 本機護罩撞上一顆靜態球（練習假人）。最小間距 = 護罩半徑 + 假人半徑。
 * 重疊時沿法線推出，朝內的速度改成輕彈。selfR 要傳護罩半徑，不要傳教室 DRONE_RADIUS。
 */
export function pushOutOfSphere(
  pos: { x: number; y: number; z: number },
  vel: { x: number; y: number; z: number },
  sphere: { x: number; y: number; z: number; r: number },
  selfR: number,
  restitution: number = SOCCER_WALL_RESTITUTION,
): boolean {
  let dx = pos.x - sphere.x;
  let dy = pos.y - sphere.y;
  let dz = pos.z - sphere.z;
  let d = Math.hypot(dx, dy, dz);
  const minDist = selfR + sphere.r;
  if (d >= minDist) return false;
  if (d < 1e-6) {
    dx = 1;
    dy = 0;
    dz = 0;
    d = 1;
  }
  const nx = dx / d;
  const ny = dy / d;
  const nz = dz / d;
  pos.x = sphere.x + nx * minDist;
  pos.y = sphere.y + ny * minDist;
  pos.z = sphere.z + nz * minDist;
  const vDot = vel.x * nx + vel.y * ny + vel.z * nz;
  if (vDot < 0) {
    const bounce = -(1 + restitution) * vDot;
    vel.x += bounce * nx;
    vel.y += bounce * ny;
    vel.z += bounce * nz;
  }
  return true;
}

/** 側牆與天花板：夾回護罩內側，朝外的速度改成反向輕彈。地板仍由物理落地處理。 */
export function bounceSoccerWalls(
  pos: { x: number; y: number; z: number },
  vel: { x: number; y: number; z: number },
  field: { halfX: number; halfZ: number; top: number },
  radius: number,
  restitution: number = SOCCER_WALL_RESTITUTION,
): void {
  const axis = (
    value: number,
    velC: number,
    lo: number,
    hi: number,
  ): [number, number] => {
    if (value > hi) return [hi, velC > 0 ? -velC * restitution : velC];
    if (value < lo) return [lo, velC < 0 ? -velC * restitution : velC];
    return [value, velC];
  };
  [pos.x, vel.x] = axis(pos.x, vel.x, -field.halfX + radius, field.halfX - radius);
  [pos.z, vel.z] = axis(pos.z, vel.z, -field.halfZ + radius, field.halfZ - radius);
  [pos.y, vel.y] = axis(pos.y, vel.y, Number.NEGATIVE_INFINITY, field.top - radius);
}
