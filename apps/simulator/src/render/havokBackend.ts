// HavokBackend — PhysicsBackend 的 Havok（WASM）實作：只做「碰撞/接觸」查詢。
//
// 定位（見 core/physicsBackend.ts 與 docs/rewrite-plan.md §3.3）：
// - 不接管任何動力學：世界零重力、只放 STATIC body，無人機不建 body ——
//   每 tick 以「點鄰近查詢（pointProximity）+ 球半徑」把穿進網格的無人機推出。
//   速度只消掉撞進牆的法向分量、沿牆加庫侖摩擦（render/meshContact.ts）；
//   不再像 legacy resolveBVHCollision 整個 ×0.4（貼著門框、牆面飛會黏住）。
//   一 tick 移動超過半個護罩半徑時，沿上一 tick 位置 → 這一 tick 位置切小步檢查，
//   F9A-B 的 10 cm 護罩高速飛也不會一步跨過 7.5 cm 管徑的門框。
// - lazy init：WASM 只在需要網格碰撞的場景（playground / 之後的足球）才載入，
//   首屏零 WASM。載入失敗 → init() reject，由呼叫端降級 SimpleBackend。
// - 介面引擎無關：未來 Rust-WASM 後端以同一份 PhysicsBackend 介面替換本檔。
import {
  Mesh,
  PhysicsBody,
  PhysicsMotionType,
  PhysicsShapeBox,
  PhysicsShapeMesh,
  ProximityCastResult,
  Quaternion,
  type Scene,
  TransformNode,
  Vector3,
  VertexData,
  HavokPlugin,
} from '@babylonjs/core';
import type { PhysicsBackend, CollisionResult } from '../core/physicsBackend';
import type { Vec3 } from '../core/droneState';
import { MeshContact } from './meshContact';

/** 單 tick 最多推出迭代次數（牆角同時接觸多面時逐步收斂） */
const MAX_PUSH_ITER = 3;

interface StaticEntry {
  node: TransformNode;
  body: PhysicsBody;
  shape: PhysicsShapeBox | PhysicsShapeMesh;
}

export class HavokBackend implements PhysicsBackend {
  private plugin: HavokPlugin | null = null;
  private initPromise: Promise<void> | null = null;
  private statics = new Map<string, StaticEntry>();
  // 查詢用暫存（避免每 tick 配置）
  private readonly queryPos = new Vector3();
  private readonly pushDir = new Vector3();
  private readonly result = new ProximityCastResult();
  /** 上一次推出完的位置（掃掠起點）。null = 剛掛上 / 清空，這 tick 只查終點。 */
  private lastPos: Vec3 | null = null;

  constructor(private readonly scene: Scene) {}

  /** lazy 載入 Havok WASM（冪等；失敗會把同一個 rejection 傳給所有呼叫端） */
  init(): Promise<void> {
    if (!this.initPromise) this.initPromise = this.doInit();
    return this.initPromise;
  }

  private async doInit(): Promise<void> {
    // 測試後門：?havokfail=1 模擬 WASM 載入失敗（headless 驗證降級路徑用）
    if (new URLSearchParams(location.search).get('havokfail') === '1') {
      throw new Error('模擬 WASM 載入失敗（?havokfail=1）');
    }
    // WASM 由 vite 打包成本地資產（?url），HavokPhysics 以 locateFile 指到它 —— 不打 CDN。
    // @babylonjs/havok（JS 膠水 + WASM）動態 import：首屏不載，進 playground 才抓。
    const [{ default: HavokPhysics }, { default: wasmUrl }] = await Promise.all([
      import('@babylonjs/havok'),
      import('@babylonjs/havok/lib/esm/HavokPhysics.wasm?url'),
    ]);
    const havok = await HavokPhysics({ locateFile: () => wasmUrl });
    this.plugin = new HavokPlugin(false, havok);
    // 零重力：Havok 只當「靜態體 + 鄰近查詢」用，飛行動力學仍屬 core/physics 手寫核心
    this.scene.enablePhysics(new Vector3(0, 0, 0), this.plugin);
    console.log('[Havok] WASM 載入完成（碰撞後端就緒）');
  }

  /**
   * 球（半徑 radius）對所有靜態體的推出：
   * 以無人機中心做 pointProximity 找最近點，距離 < radius 即穿透 →
   * 沿（中心 − 最近點）方向推到球面上，只消掉撞進去的法向速度，沿牆加摩擦。
   * 移動夠快時從上一 tick 位置切小步前進，停在第一個碰到的地方（之後的位移丟掉）。
   */
  resolveCollisions(pos: Vec3, vel: Vec3, radius: number): CollisionResult {
    if (!this.plugin || this.statics.size === 0) {
      this.lastPos = null;
      return { pos, vel, bumped: false, impact: 0 };
    }
    const from = this.lastPos;
    const speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z);
    const steps = MeshContact.sweepSteps(from, pos, speed, radius);
    let bumped = false;
    let impact = 0;
    for (let s = 1; s <= steps; s++) {
      if (from && s < steps) {
        const t = s / steps;
        this.queryPos.set(
          from.x + (pos.x - from.x) * t,
          from.y + (pos.y - from.y) * t,
          from.z + (pos.z - from.z) * t,
        );
      } else {
        this.queryPos.set(pos.x, pos.y, pos.z);
      }
      for (let i = 0; i < MAX_PUSH_ITER; i++) {
        this.result.reset();
        this.plugin.pointProximity(
          {
            position: this.queryPos,
            maxDistance: radius,
            collisionFilter: {},
            shouldHitTriggers: false,
          },
          this.result,
        );
        if (!this.result.hasHit || this.result.hitDistance >= radius) break;
        // 推出方向：中心 − 最近點；退化（中心恰在面上）時用命中法線（legacy 用三角形法線）
        this.pushDir.copyFrom(this.queryPos).subtractInPlace(this.result.hitPoint);
        if (this.pushDir.lengthSquared() < 1e-8) this.pushDir.copyFrom(this.result.hitNormal);
        this.pushDir.normalize();
        this.queryPos.copyFrom(this.result.hitPoint).addInPlace(this.pushDir.scale(radius));
        const hit = MeshContact.removeInward(vel, this.pushDir);
        MeshContact.applyFriction(vel, this.pushDir, hit);
        if (hit > impact) impact = hit;
        bumped = true;
      }
      if (bumped) break;
    }
    if (bumped || steps > 1) {
      pos.x = this.queryPos.x;
      pos.y = this.queryPos.y;
      pos.z = this.queryPos.z;
    }
    this.lastPos = { x: pos.x, y: pos.y, z: pos.z };
    return { pos, vel, bumped, impact };
  }

  /** 註冊靜態 AABB（目前場景多半走 SimpleBackend；為介面完整性提供） */
  addStaticBox(id: string, center: Vec3, half: Vec3): void {
    if (!this.plugin) return this.warnNotReady(id);
    this.removeStatic(id);
    const node = new TransformNode(`havok-box:${id}`, this.scene);
    node.position.set(center.x, center.y, center.z);
    const shape = new PhysicsShapeBox(
      Vector3.Zero(),
      Quaternion.Identity(),
      new Vector3(half.x * 2, half.y * 2, half.z * 2),
      this.scene,
    );
    const body = new PhysicsBody(node, PhysicsMotionType.STATIC, false, this.scene);
    body.shape = shape;
    this.statics.set(id, { node, body, shape });
  }

  /** 註冊靜態三角網格（世界座標 triangle soup → 隱藏 mesh → Havok mesh shape） */
  addStaticMesh(id: string, positions: Float32Array, indices?: Uint32Array): void {
    if (!this.plugin) return this.warnNotReady(id);
    this.removeStatic(id);
    // 建一個不渲染的 mesh 當幾何載體（PhysicsShapeMesh 需要 Babylon Mesh）
    const mesh = new Mesh(`havok-mesh:${id}`, this.scene);
    const vd = new VertexData();
    vd.positions = positions;
    vd.indices = indices ?? sequentialIndices(positions.length / 3);
    vd.applyToMesh(mesh);
    mesh.isVisible = false;
    mesh.isPickable = false;
    const shape = new PhysicsShapeMesh(mesh, this.scene);
    const body = new PhysicsBody(mesh, PhysicsMotionType.STATIC, false, this.scene);
    body.shape = shape;
    this.statics.set(id, { node: mesh, body, shape });
    console.log(`[Havok] 靜態網格已註冊：${id}（${(vd.indices.length / 3) | 0} 三角形）`);
  }

  removeStatic(id: string): void {
    const entry = this.statics.get(id);
    if (!entry) return;
    entry.body.dispose();
    entry.shape.dispose();
    entry.node.dispose();
    this.statics.delete(id);
    this.lastPos = null;
  }

  clear(): void {
    for (const id of [...this.statics.keys()]) this.removeStatic(id);
  }

  private warnNotReady(id: string): void {
    console.warn(`[Havok] 尚未 init 完成，忽略靜態體註冊：${id}`);
  }
}

/** 非索引 triangle soup → 連號索引 */
function sequentialIndices(count: number): Uint32Array {
  const idx = new Uint32Array(count);
  for (let i = 0; i < count; i++) idx[i] = i;
  return idx;
}

// =============================================================================
// 共用單例：一個 Babylon Scene 只能 enablePhysics 一次 —— playground 與足球
// 共用同一個 HavokBackend（靜態體以 id 區分：'playground' / 'soccer-goals'）。
// =============================================================================
let sharedBackend: HavokBackend | null = null;

/** 取得（或建立）此 scene 的共用 HavokBackend 單例 */
export function getHavokBackend(scene: Scene): HavokBackend {
  if (!sharedBackend) sharedBackend = new HavokBackend(scene);
  return sharedBackend;
}
