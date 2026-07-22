// Playground 遊樂場場景（大亂鬥 field:'playground'）— glb 載入 + Havok 網格碰撞。
//
// 對齊 legacy setArenaScene / buildPlaygroundCollision：
// - glTF 為 Y-up 右手系，與本場景一致（useRightHandedSystem），不需旋轉；
//   量 bounding box → 縮到約 48m 跨度（結構落在 ±24 遊玩區、可當掩體）→ 水平置中 → 落地 y=0。
// - 視覺 mesh 掛 scene；碰撞把所有 mesh 烤進世界座標合併成 triangle soup，
//   註冊進 HavokBackend（core/physics 的 tick 會與 SimpleBackend 的 AABB 掩體共存）。
// - WASM 載入失敗 → console.warn + 降級 SimpleBackend（場景照樣顯示、只是可穿過結構）。
// - 離開大亂鬥 → dispose 場景 mesh + 清空碰撞（重進會重新載入）。
import { ImportMeshAsync, Vector3, VertexBuffer, type Scene, type AbstractMesh } from '@babylonjs/core';
import { registerBuiltInLoaders } from '@babylonjs/loaders/dynamic';
import { bus, toast } from '../core/events';
import { setMeshCollisionBackend } from '../core/physics';
import { DRONE_RADIUS, type Vec3 } from '../core/droneState';
import { HavokBackend, getHavokBackend } from './havokBackend';

const PLAYGROUND_URL = '/assets/maps/playground_2b.glb';
/** 縮放後的目標跨度（m）— 與 legacy 相同，結構落在 ±24 遊玩區內 */
const PLAYGROUND_SPAN = 48;

let loadersRegistered = false;

export class PlaygroundScene {
  private readonly backend: HavokBackend;
  /** glb 載入結果的所有 mesh（[0] 為 __root__） */
  private meshes: AbstractMesh[] | null = null;
  private loading = false;
  /** 世代計數：載入中離場 / 切場地時作廢舊的非同步結果 */
  private generation = 0;

  constructor(private readonly scene: Scene) {
    this.backend = getHavokBackend(scene); // 與足球共用同一個 Havok 單例（scene 只能 enablePhysics 一次）
    bus.on('arena-field-changed', ({ field }) => {
      if (field === 'playground') void this.show();
      else this.hide();
    });
    bus.on('arena-exited', () => this.disposeAll());

    // headless 驗收 / debug 後門（對齊 legacy 的 playgroundBVHReady 匯出）：
    // sceneReady = glb 已掛上；collisionReady = Havok 網格已註冊；
    // probe(x,y,z) = 在該點做一次球推出查詢（不動 droneState），驗證碰撞不穿透用。
    (window as unknown as Record<string, unknown>).__creaflyPlayground = {
      sceneReady: () => !!this.meshes,
      collisionReady: () => this.collisionReady,
      probe: (x: number, y: number, z: number): { pos: Vec3; bumped: boolean } => {
        const pos = { x, y, z };
        const vel = { x: 0, y: 0, z: 0 };
        const { bumped } = this.backend.resolveCollisions(pos, vel, DRONE_RADIUS);
        return { pos, bumped };
      },
    };
  }

  private collisionReady = false;

  /** 切到 playground：載入（一次）→ 顯示 + 掛上網格碰撞、藏格線地面 */
  private async show(): Promise<void> {
    const gen = ++this.generation;
    if (this.meshes) {
      this.applyVisibility(true);
      setMeshCollisionBackend(this.backend);
      return;
    }
    if (this.loading) return;
    this.loading = true;
    toast('🌆 載入遊樂場場景中…');

    try {
      if (!loadersRegistered) {
        loadersRegistered = true;
        registerBuiltInLoaders(); // glTF loader 動態註冊（首屏不載）
      }
      // 場景 glb 與 Havok WASM 平行載入；Havok 失敗不擋場景（catch 後降級）
      const [result, havokOk] = await Promise.all([
        ImportMeshAsync(PLAYGROUND_URL, this.scene),
        this.backend.init().then(
          () => true,
          (e: unknown) => {
            console.warn('[Playground] Havok WASM 載入失敗，降級 SimpleBackend（結構無碰撞）：', e);
            toast('⚠ 碰撞引擎載入失敗 — 場景結構暫時可穿過', 'warning');
            return false;
          },
        ),
      ]);
      this.loading = false;
      const root = result.meshes[0];
      if (!root) throw new Error('glb 無 mesh');

      // ---- 量 bounding → 縮放 / 置中 / 落地（對齊 legacy）----
      let { min, max } = root.getHierarchyBoundingVectors(true);
      const span = Math.max(max.x - min.x, max.z - min.z) || 1;
      root.scaling.scaleInPlace(PLAYGROUND_SPAN / span);
      root.computeWorldMatrix(true);
      ({ min, max } = root.getHierarchyBoundingVectors(true));
      root.position.x -= (min.x + max.x) / 2; // 水平置中於原點
      root.position.z -= (min.z + max.z) / 2;
      root.position.y -= min.y; // 地面落到 y=0
      root.computeWorldMatrix(true);

      result.meshes.forEach((m) => {
        m.receiveShadows = true;
        m.isPickable = false;
      });
      this.meshes = result.meshes;

      // 載入期間已離場 / 切回格線 → 直接收掉，不掛碰撞
      if (gen !== this.generation) {
        this.disposeAll();
        return;
      }

      this.applyVisibility(true);

      // ---- 網格碰撞：烤世界座標 → 合併 triangle soup → 註冊 Havok ----
      if (havokOk) {
        const soup = bakeTriangleSoup(result.meshes);
        if (soup) {
          this.backend.addStaticMesh('playground', soup.positions, soup.indices);
          setMeshCollisionBackend(this.backend);
          this.collisionReady = true;
        } else {
          console.warn('[Playground] glb 無可用碰撞幾何');
        }
      }
      toast('🌆 遊樂場場景就緒！', 'success');
    } catch (e) {
      this.loading = false;
      console.warn('[Playground] 場景載入失敗：', e);
      toast('⚠ 場景載入失敗，維持格線', 'warning');
      this.applyVisibility(false); // 還原格線地面
    }
  }

  /** 切回格線場地：藏場景、卸下網格碰撞（mesh 保留，重切免重載） */
  private hide(): void {
    this.generation++;
    setMeshCollisionBackend(null);
    this.applyVisibility(false);
  }

  /** 離開大亂鬥：dispose 場景 + 卸下碰撞體（釋放 5MB 級資源；backend 是共用單例，只移自己的） */
  private disposeAll(): void {
    this.hide();
    this.backend.removeStatic('playground');
    this.collisionReady = false;
    if (this.meshes) {
      // 反向 dispose：子 mesh 先於 __root__
      [...this.meshes].reverse().forEach((m) => m.dispose(false, true));
      this.meshes = null;
    }
  }

  /** 場景顯示與格線地面互斥（對齊 legacy：ground / groundGrid 跟著切） */
  private applyVisibility(playgroundOn: boolean): void {
    this.meshes?.forEach((m) => (m.isVisible = playgroundOn));
    const ground = this.scene.getMeshByName('ground');
    const grid = this.scene.getMeshByName('grid');
    if (ground) ground.isVisible = !playgroundOn;
    if (grid) grid.isVisible = !playgroundOn;
  }
}

/**
 * 把一組 mesh 的幾何烤進世界座標，合併成單一 triangle soup（對齊 legacy buildPlaygroundCollision：
 * 只留 position、索引平移後合併）。回傳 null = 沒有任何可用幾何。
 * （render/soccerField.ts 的球門框碰撞也用這支。）
 */
export function bakeTriangleSoup(
  meshes: AbstractMesh[],
): { positions: Float32Array; indices: Uint32Array } | null {
  const posChunks: Float32Array[] = [];
  const idxChunks: Uint32Array[] = [];
  let vertexOffset = 0;
  let totalPos = 0;
  let totalIdx = 0;
  const tmp = new Vector3();

  for (const m of meshes) {
    const src = m.getVerticesData(VertexBuffer.PositionKind);
    if (!src || src.length === 0) continue;
    m.computeWorldMatrix(true);
    const world = m.getWorldMatrix();
    const baked = new Float32Array(src.length);
    for (let i = 0; i < src.length; i += 3) {
      tmp.set(src[i]!, src[i + 1]!, src[i + 2]!);
      Vector3.TransformCoordinatesToRef(tmp, world, tmp);
      baked[i] = tmp.x;
      baked[i + 1] = tmp.y;
      baked[i + 2] = tmp.z;
    }
    const srcIdx = m.getIndices();
    const vertCount = src.length / 3;
    const idx = new Uint32Array(srcIdx && srcIdx.length ? srcIdx.length : vertCount);
    if (srcIdx && srcIdx.length) {
      for (let i = 0; i < srcIdx.length; i++) idx[i] = srcIdx[i]! + vertexOffset;
    } else {
      for (let i = 0; i < vertCount; i++) idx[i] = i + vertexOffset;
    }
    posChunks.push(baked);
    idxChunks.push(idx);
    vertexOffset += vertCount;
    totalPos += baked.length;
    totalIdx += idx.length;
  }
  if (!posChunks.length) return null;

  const positions = new Float32Array(totalPos);
  const indices = new Uint32Array(totalIdx);
  let po = 0;
  let io = 0;
  for (const c of posChunks) {
    positions.set(c, po);
    po += c.length;
  }
  for (const c of idxChunks) {
    indices.set(c, io);
    io += c.length;
  }
  return { positions, indices };
}
