// PhysicsBackend — 碰撞後端抽象層（引擎無關；核心規則見 docs/rewrite-plan.md §3.3）。
//
// 設計鐵律：
// 1. 飛行「手感」永遠由 core/physics.ts 的 60Hz 手寫核心控制（推力/阻力/積分不外包）。
//    物理引擎只負責「碰撞/接觸」：把穿進靜態體的無人機推出來、衰減速度。
// 2. 介面必須引擎無關 —— 現在的 Havok（render/havokBackend.ts）與未來的 Rust-WASM
//    都以同一份介面接入，core 與遊戲層零改動。
// 3. SimpleBackend（本檔）是預設後端：純 TS AABB 推出，行為與接線前的
//    resolveObstacleCollisions 完全相同 —— 一般關卡零改變。
import type { Vec3 } from './droneState';

/** resolveCollisions 的回傳：允許就地修改傳入的 pos / vel 並回傳同一物件（避免每 tick 配置） */
export interface CollisionResult {
  pos: Vec3;
  vel: Vec3;
  /** 本 tick 有推出（呼叫端據此播撞擊音效等） */
  bumped: boolean;
}

export interface PhysicsBackend {
  /** 初始化（Havok 在此 lazy 載 WASM；SimpleBackend 為 no-op）。失敗要 reject，由呼叫端降級。 */
  init(): Promise<void>;
  /**
   * 每 60Hz tick 呼叫：給 droneState 的位置/速度，回傳修正後位置/速度（碰撞推出、反彈衰減）。
   * drone 視為半徑 radius 的球；不得改動速度語意以外的東西（手感屬 core/physics）。
   */
  resolveCollisions(pos: Vec3, vel: Vec3, radius: number): CollisionResult;
  /** 註冊靜態 AABB 方塊（half = 各軸半邊長；關卡障礙 / 大亂鬥掩體用） */
  addStaticBox(id: string, center: Vec3, half: Vec3): void;
  /**
   * 註冊靜態三角網格（世界座標 triangle soup；glb 場景用）。
   * positions 為烤進世界座標的頂點（xyz 連續），indices 省略時視為非索引三角形序列。
   */
  addStaticMesh(id: string, positions: Float32Array, indices?: Uint32Array): void;
  /** 移除單一靜態體（依 addStaticBox / addStaticMesh 的 id） */
  removeStatic(id: string): void;
  /** 清空所有靜態體（離開場景時） */
  clear(): void;
}

/**
 * SimpleBackend — 純 TS AABB 推出（預設啟用）。
 * 演算法對齊 legacy main.js L3295–3317：drone 球在「膨脹 radius 後的 AABB」內時，
 * 沿最小穿透軸推出、該軸速度歸零。網格碰撞不支援（那是 Havok / Rust 後端的事）。
 */
export class SimpleBackend implements PhysicsBackend {
  private boxes = new Map<string, { center: Vec3; half: Vec3 }>();
  private warnedMesh = false;

  init(): Promise<void> {
    return Promise.resolve();
  }

  resolveCollisions(pos: Vec3, vel: Vec3, radius: number): CollisionResult {
    let bumped = false;
    for (const { center: c, half } of this.boxes.values()) {
      const hx = half.x + radius;
      const hy = half.y + radius;
      const hz = half.z + radius;
      const dx = pos.x - c.x;
      const dy = pos.y - c.y;
      const dz = pos.z - c.z;
      if (Math.abs(dx) >= hx || Math.abs(dy) >= hy || Math.abs(dz) >= hz) continue;
      const px = hx - Math.abs(dx);
      const py = hy - Math.abs(dy);
      const pz = hz - Math.abs(dz);
      const m = Math.min(px, py, pz);
      if (m === px) {
        pos.x = c.x + (dx < 0 ? -hx : hx);
        vel.x = 0;
      } else if (m === py) {
        pos.y = c.y + (dy < 0 ? -hy : hy);
        vel.y = 0;
      } else {
        pos.z = c.z + (dz < 0 ? -hz : hz);
        vel.z = 0;
      }
      bumped = true;
    }
    return { pos, vel, bumped };
  }

  addStaticBox(id: string, center: Vec3, half: Vec3): void {
    this.boxes.set(id, { center: { ...center }, half: { ...half } });
  }

  addStaticMesh(id: string): void {
    // SimpleBackend 不支援三角網格 —— 需要網格碰撞的場景（playground / 足球）走 Havok 後端
    if (!this.warnedMesh) {
      this.warnedMesh = true;
      console.warn(`[SimpleBackend] 不支援 addStaticMesh（id=${id}）— 網格碰撞請用 Havok 後端`);
    }
  }

  removeStatic(id: string): void {
    this.boxes.delete(id);
  }

  clear(): void {
    this.boxes.clear();
  }
}
