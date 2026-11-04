// 網格碰撞的速度反應與掃掠切分 — 純數學，不依賴 Babylon，Node 測得到（havokBackend.ts 用）。
//
// 舊做法（對齊 legacy resolveBVHCollision）：一碰到就整個速度 ×0.4。
// 貼著門框或遊樂場牆面飛時每 tick 都接觸，沿牆的速度也被打掉 6 成，幾下就黏住不動。
// 這裡改成：
//   - 只消掉「撞進牆」的法向分量；離開牆的分量不動
//   - 切向給庫侖摩擦：撞得越用力，沿牆速度掉越多；擦邊而過幾乎不掉
//   - 移動太快（一 tick 超過半個護罩半徑）時切成小步檢查，薄門框不會一步跨過去

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export class MeshContact {
  /** 摩擦係數 μ：沿牆速度最多減少「撞進去的速度 × μ」 */
  static readonly FRICTION = 0.4;
  /** 掃掠每步最多前進護罩半徑的這個比例 */
  static readonly SWEEP_STEP = 0.5;
  /** 一 tick 移動超過這個距離（m）視為瞬移（回家、重置、換關、發球），不掃 */
  static readonly TELEPORT_M = 2;
  /**
   * 位移要跟速度對得上才掃：integrate 是 p += v 之後 v *= DRAG，
   * 所以位移 ≈ 速度 / 0.92；放寬到 1.5 倍容納 AABB 推出、地板夾住等小修正。
   * 程式模式、自動駕駛、伺服器拉回、debug 探針的速度都是 0，不會被當成飛過去。
   */
  static readonly SPEED_SLACK = 1.5;
  /** 掃掠最多切幾步（防呆；正常 0.14 m / 0.05 m 約 3 步） */
  static readonly MAX_STEPS = 16;

  /**
   * 推出方向 n（單位向量，指向牆外）：消掉撞進牆的法向速度，就地改 v。
   * 回傳撞進去的速度（≥ 0）；往外飛或貼著平行滑 = 0，速度不動。
   */
  static removeInward(v: Vec3Like, n: Vec3Like): number {
    const vn = v.x * n.x + v.y * n.y + v.z * n.z;
    if (vn >= 0) return 0;
    v.x -= n.x * vn;
    v.y -= n.y * vn;
    v.z -= n.z * vn;
    return -vn;
  }

  /**
   * 庫侖摩擦：沿牆（垂直 n 的）速度減少 FRICTION × impact，最多減到 0；法向分量不動。就地改 v。
   */
  static applyFriction(v: Vec3Like, n: Vec3Like, impact: number): void {
    if (impact <= 0) return;
    const vn = v.x * n.x + v.y * n.y + v.z * n.z;
    const tx = v.x - n.x * vn;
    const ty = v.y - n.y * vn;
    const tz = v.z - n.z * vn;
    const vt = Math.sqrt(tx * tx + ty * ty + tz * tz);
    if (vt < 1e-12) return;
    const k = Math.max(0, vt - MeshContact.FRICTION * impact) / vt;
    v.x = n.x * vn + tx * k;
    v.y = n.y * vn + ty * k;
    v.z = n.z * vn + tz * k;
  }

  /**
   * 從上一 tick 的位置 `from` 到這一 tick 的 `to` 要切幾步檢查（1 = 只查終點，跟以前一樣）。
   * `speed`：這一 tick 的速度大小（每 tick 公尺）。
   */
  static sweepSteps(from: Vec3Like | null, to: Vec3Like, speed: number, radius: number): number {
    if (!from) return 1;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const step = radius * MeshContact.SWEEP_STEP;
    if (!(step > 0) || d <= step) return 1;
    if (d >= MeshContact.TELEPORT_M) return 1;
    if (d > speed * MeshContact.SPEED_SLACK + 1e-6) return 1;
    return Math.min(MeshContact.MAX_STEPS, Math.ceil(d / step));
  }
}
