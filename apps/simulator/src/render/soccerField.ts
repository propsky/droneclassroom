// ⚽ 足球視覺 + 門框碰撞：場地（地板 / 邊牆 / 中線 / 起始區）、兩端 torus 球門（隊色）、
// 球形保護框、P-5 假人、多人隊色分身＋前鋒彩帶（striker 玩法）、推球模式共用球 —
// Babylon 版，行為對齊 legacy §16 / §16b。
// 場地尺寸資料驅動：一律讀 soccer/field.ts 的生效值（伺服器下發優先、constants fallback），
// 收到 soccer-field-changed 以新尺寸整場重建（含門框碰撞）。
//
// 門框碰撞：torus mesh 烤成世界座標三角網格註冊進共用 HavokBackend
// （球門洞可穿、框實心 — legacy 用 BVH，本版走 PhysicsBackend 介面），
// 碰撞半徑用 SOCCER_BALL_R（球形保護框）。牆 / 天花板的 clamp 在邏輯層
// （soccer/practice.ts、multiplayer/soccer.ts）照 legacy 處理。
import {
  Scene,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Vector3,
  TransformNode,
} from '@babylonjs/core';
import { bus, toast } from '../core/events';
import { droneState, DRONE_RADIUS, type Vec3 } from '../core/droneState';
import { setMeshCollisionBackend } from '../core/physics';
import {
  SOCCER_BALL_R,
  SOCCER_DRONE_SCALE,
  SOCCER_TEAM_COLORS,
  soccerTeamColorHex,
} from '../soccer/constants';
import { activeSoccerField } from '../soccer/field';
import { soccerState, type SoccerOther } from '../multiplayer/soccer';
import { getHavokBackend, type HavokBackend } from './havokBackend';
import { bakeTriangleSoup } from './playground';
import { makeNameLabel } from './clones';
import { hex } from './scene';
import type { DroneVisual } from './drone';

/** 分身位置 / 彩帶擺動的視覺常數 */
const RIBBON_SCALE = 2.4; // 彩帶整組放大（對齊 legacy makeSoccerDrone）
const RIBBON_SWING = 0.25; // 彩帶擺動幅度（rad）
const CLONE_LABEL_Y = 1.9; // 名牌高度（分身比一般 clone 大 → 名牌抬高）

/** 推球模式共用球的視覺常數（亮黃 + emissive → 綠地板上好追） */
const BALL_COLOR = 0xffd60a; // 亮黃
const BALL_GLOW_IDLE = 0.42; // 平時 emissive 比例
const BALL_GLOW_NEAR = 0.95; // 本機貼近球時微發亮（純視覺回饋，物理在伺服器）

type SoccerVariant = 'practice' | 'match';

/** 一個他人分身的視覺物件組 */
interface SoccerCloneVisual {
  root: TransformNode;
  bodyMat: StandardMaterial;
  ribbon: TransformNode;
  appliedTeam: string | null;
  /** 彩帶目前是否顯示（= striker 且玩法為 'striker'；ball 模式一律不顯示） */
  appliedRibbon: boolean;
}

export class SoccerFieldVisuals {
  private readonly scene: Scene;
  private readonly drone: DroneVisual;
  private readonly backend: HavokBackend;
  /** 場地所有靜態視覺（地板 / 牆 / 線 / 球門 / 起始區） */
  private fieldMeshes: Mesh[] = [];
  private dummyMeshes: Mesh[] = [];
  private goalMeshes: Mesh[] = [];
  private ballCage: Mesh | null = null;
  /** 推球模式的共用球（伺服器模擬；lazy 建立、依 soccerState.ball 位置渲染） */
  private sharedBall: Mesh | null = null;
  private sharedBallMat: StandardMaterial | null = null;
  private sharedBallR = 0;
  private sharedBallGlow = 0;
  private myRibbon: TransformNode | null = null;
  private clones = new Map<string, SoccerCloneVisual>();
  private active = false;
  /** 目前場地 variant（伺服器下發場地定義變更時據此重建） */
  private variant: SoccerVariant = 'practice';
  private collisionReady = false;
  /** 世代計數：Havok WASM 載入中離場 → 作廢舊的非同步註冊 */
  private generation = 0;

  constructor(scene: Scene, drone: DroneVisual) {
    this.scene = scene;
    this.drone = drone;
    this.backend = getHavokBackend(scene); // 與 playground 共用單例（scene 只能 enablePhysics 一次）
    bus.on('soccer-entered', ({ variant }) => this.build(variant));
    bus.on('soccer-exited', () => this.disposeAll());
    bus.on('soccer-dummies-changed', ({ boxes }) => this.buildDummies(boxes));
    // 伺服器下發場地定義（生效值在 soccer/field.ts）→ 以新尺寸整場重建（含門框碰撞）
    bus.on('soccer-field-changed', () => {
      if (this.active) this.build(this.variant);
    });

    // headless 驗收 / debug 後門（對齊 __creaflyPlayground）：
    // collisionReady = 門框網格已註冊；probe(x,y,z) = 以球框半徑做一次推出查詢（不動 droneState）
    (window as unknown as Record<string, unknown>).__creaflySoccer = {
      collisionReady: () => this.collisionReady,
      probe: (x: number, y: number, z: number): { pos: Vec3; bumped: boolean } => {
        const pos = { x, y, z };
        const vel = { x: 0, y: 0, z: 0 };
        const { bumped } = this.backend.resolveCollisions(pos, vel, SOCCER_BALL_R);
        return { pos, bumped };
      },
    };
  }

  // ---------------------------------------------------------------------------
  // 場地建置
  // ---------------------------------------------------------------------------
  private build(variant: SoccerVariant): void {
    this.disposeAll(); // 防重複（practice ↔ match 直切、伺服器場地定義變更重建）
    this.active = true;
    this.variant = variant;
    const gen = ++this.generation;
    const scene = this.scene;
    // 場地尺寸：伺服器下發的生效值（未下發 = constants fallback）— 資料驅動
    const F = activeSoccerField();
    this.drone.setScaleFactor(SOCCER_DRONE_SCALE); // 縮小飛機 → 場地相對變大、比例正確
    this.setDefaultGroundVisible(false);

    // ---- 地板（草綠）----
    const floor = MeshBuilder.CreateGround('soccerFloor', { width: F.halfX * 2, height: F.halfZ * 2 }, scene);
    floor.position.y = 0.02;
    const floorMat = new StandardMaterial('soccerFloorMat', scene);
    floorMat.diffuseColor = hex(0x3a7d44);
    floorMat.specularColor = new Color3(0.05, 0.05, 0.05);
    floor.material = floorMat;
    floor.receiveShadows = true;
    this.fieldMeshes.push(floor);

    // ---- 四面透明邊牆（視覺提示；clamp 在邏輯層）----
    const wallMat = new StandardMaterial('soccerWallMat', scene);
    wallMat.diffuseColor = hex(0x4dd0e1);
    wallMat.alpha = 0.12;
    wallMat.backFaceCulling = false;
    const walls: [number, number, number, number, number, number][] = [
      [F.halfX * 2, F.top, 0.15, 0, F.top / 2, -F.halfZ],
      [F.halfX * 2, F.top, 0.15, 0, F.top / 2, F.halfZ],
      [0.15, F.top, F.halfZ * 2, -F.halfX, F.top / 2, 0],
      [0.15, F.top, F.halfZ * 2, F.halfX, F.top / 2, 0],
    ];
    walls.forEach(([w, h, d, x, y, z], i) => {
      const m = MeshBuilder.CreateBox(`soccerWall${i}`, { width: w, height: h, depth: d }, scene);
      m.position.set(x, y, z);
      m.material = wallMat;
      m.isPickable = false;
      this.fieldMeshes.push(m);
    });

    // ---- 中線 ----
    const midMat = new StandardMaterial('soccerMidMat', scene);
    if (variant === 'match') {
      // 多人：黃色發光中線 + 半場淡隊色（藍 -z 半場、紅 +z 半場 — 與 server 站位一致）
      midMat.emissiveColor = hex(0xffe066);
      midMat.disableLighting = true;
      midMat.alpha = 0.9;
      (
        [
          ['blue', -1],
          ['red', 1],
        ] as const
      ).forEach(([team, s]) => {
        const half = MeshBuilder.CreateGround(
          `soccerHalf-${team}`,
          { width: F.halfX * 2, height: F.halfZ },
          scene,
        );
        half.position.set(0, 0.03, (s * F.halfZ) / 2);
        const hm = new StandardMaterial(`soccerHalfMat-${team}`, scene);
        hm.emissiveColor = hex(SOCCER_TEAM_COLORS[team]);
        hm.disableLighting = true;
        hm.alpha = 0.08;
        half.material = hm;
        half.isPickable = false;
        this.fieldMeshes.push(half);
      });
    } else {
      midMat.emissiveColor = Color3.White();
      midMat.disableLighting = true;
      midMat.alpha = 0.6;
    }
    const mid = MeshBuilder.CreateGround(
      'soccerMidLine',
      { width: F.halfX * 2, height: variant === 'match' ? 0.12 : 0.3 },
      scene,
    );
    mid.position.set(0, 0.05, 0);
    mid.material = midMat;
    mid.isPickable = false;
    this.fieldMeshes.push(mid);

    // ---- 起始區（單人：對應規則圖，藍 +z / 紅 -z 各一個）----
    if (variant === 'practice') {
      this.buildStartZone(F.startZ, SOCCER_TEAM_COLORS.blue);
      this.buildStartZone(-F.startZ, SOCCER_TEAM_COLORS.red);
    }

    // ---- 兩端 torus 球門 ----
    // 單人：遠端（-z）紅 = 攻、近端（+z）藍 = 守。
    // 多人：球門環用「該端守方」隊色 — 藍守 -z、紅守 +z（與 server SOCCER_TEAMS 對齊）。
    const farColor = variant === 'match' ? SOCCER_TEAM_COLORS.blue : SOCCER_TEAM_COLORS.red;
    const nearColor = variant === 'match' ? SOCCER_TEAM_COLORS.red : SOCCER_TEAM_COLORS.blue;
    this.goalMeshes = [this.makeGoalRing(-F.goalZ, farColor), this.makeGoalRing(F.goalZ, nearColor)];
    this.fieldMeshes.push(...this.goalMeshes);

    // ---- 門框實心（網格碰撞）→ 只能從中間的洞穿過，撞到框會被擋 ----
    void this.registerGoalCollision(gen);

    // ---- 機體外的球形保護框（像真實無人機足球的球；每 tick 貼齊飛機，不受飛機縮放影響）----
    this.ballCage = MeshBuilder.CreateIcoSphere(
      'soccerBallCage',
      { radius: SOCCER_BALL_R, subdivisions: 1 },
      scene,
    );
    const cageMat = new StandardMaterial('soccerBallCageMat', scene);
    cageMat.emissiveColor = Color3.White();
    cageMat.disableLighting = true;
    cageMat.wireframe = true;
    cageMat.alpha = variant === 'match' ? 0.28 : 0.4;
    this.ballCage.material = cageMat;
    this.ballCage.isPickable = false;
    this.ballCage.position.set(droneState.position.x, droneState.position.y, droneState.position.z);
  }

  /** 起始區：地面填色長方形 + 邊框線（對齊 legacy makeStartZone；w=8 d=5） */
  private buildStartZone(centerZ: number, color: number): void {
    const w = 8;
    const d = 5;
    const fill = MeshBuilder.CreateGround(`soccerStart-${centerZ}`, { width: w, height: d }, this.scene);
    fill.position.set(0, 0.05, centerZ);
    const mat = new StandardMaterial(`soccerStartMat-${centerZ}`, this.scene);
    mat.emissiveColor = hex(color);
    mat.disableLighting = true;
    mat.alpha = 0.16;
    fill.material = mat;
    fill.isPickable = false;
    this.fieldMeshes.push(fill);

    const hw = w / 2;
    const hd = d / 2;
    const y = 0.07;
    const border = MeshBuilder.CreateLines(
      `soccerStartLine-${centerZ}`,
      {
        points: [
          new Vector3(-hw, y, centerZ - hd),
          new Vector3(hw, y, centerZ - hd),
          new Vector3(hw, y, centerZ + hd),
          new Vector3(-hw, y, centerZ + hd),
          new Vector3(-hw, y, centerZ - hd),
        ],
      },
      this.scene,
    );
    border.color = hex(color);
    border.isPickable = false;
    this.fieldMeshes.push(border);
  }

  /** 球門環：torus 孔朝 z → 沿長軸穿過（Babylon torus 預設孔朝 y，轉 90°）；尺寸依生效場地 */
  private makeGoalRing(z: number, color: number): Mesh {
    const F = activeSoccerField();
    const ring = MeshBuilder.CreateTorus(
      `soccerGoal-${z}`,
      { diameter: F.goalR * 2, thickness: F.goalTube * 2, tessellation: 32 },
      this.scene,
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.set(0, F.goalY, z);
    const mat = new StandardMaterial(`soccerGoalMat-${z}`, this.scene);
    mat.diffuseColor = hex(color);
    mat.emissiveColor = hex(color).scale(0.45);
    mat.specularColor = new Color3(0.6, 0.6, 0.6);
    ring.material = mat;
    return ring;
  }

  /** 門框碰撞：Havok WASM lazy 載入 → torus 烤三角網格註冊（失敗降級 = 門框可穿，其餘照常） */
  private async registerGoalCollision(gen: number): Promise<void> {
    try {
      await this.backend.init();
    } catch (e) {
      console.warn('[Soccer] Havok WASM 載入失敗，門框暫時可穿過：', e);
      toast('⚠ 碰撞引擎載入失敗 — 門框暫時可穿過', 'warning');
      return;
    }
    if (gen !== this.generation || !this.active) return; // 載入期間已離場 → 作廢
    const soup = bakeTriangleSoup(this.goalMeshes);
    if (!soup) return;
    this.backend.addStaticMesh('soccer-goals', soup.positions, soup.indices);
    setMeshCollisionBackend(this.backend, SOCCER_BALL_R); // 碰撞半徑 = 球形保護框
    this.collisionReady = true;
  }

  /** P-5 防守假人（紫色方塊；碰撞 AABB 由 practice.ts setSolidObstacles 註冊） */
  private buildDummies(boxes: { x: number; y: number; z: number; half: number }[]): void {
    this.dummyMeshes.forEach((m) => m.dispose(false, true));
    this.dummyMeshes = boxes.map((b, i) => {
      const m = MeshBuilder.CreateBox(`soccerDummy-${i}`, { size: b.half * 2 }, this.scene);
      m.position.set(b.x, b.y, b.z);
      const mat = new StandardMaterial(`soccerDummyMat-${i}`, this.scene);
      mat.diffuseColor = hex(0x9b5de5);
      mat.emissiveColor = hex(0x9b5de5).scale(0.2);
      mat.alpha = 0.9;
      m.material = mat;
      m.isPickable = false;
      return m;
    });
  }

  // ---------------------------------------------------------------------------
  // 每個物理 tick（main.ts 在足球模式時呼叫）
  // ---------------------------------------------------------------------------
  tick(): void {
    if (!this.active) return;
    const now = performance.now();
    // 球形保護框貼齊自機
    this.ballCage?.position.set(droneState.position.x, droneState.position.y, droneState.position.z);

    if (!soccerState.active) return; // 以下為多人分身 / 共用球視覺
    this.syncClones();
    this.syncSharedBall();
    // 前鋒彩帶只在 striker 玩法顯示（ball 模式誰都能得分 → 沒有前鋒識別）
    const ribbonsOn = soccerState.mode === 'striker';
    for (const [id, c] of this.clones) {
      const o = soccerState.others.get(id);
      if (!o) continue;
      // 位置：直接取邏輯層內插後的 o.pos（機對機碰撞與視覺共用同一份 → 不會「看起來沒撞到」）
      if (o.hasPos) {
        c.root.position.set(o.pos.x, o.pos.y, o.pos.z);
        c.root.rotation.y = o.pos.yaw;
      }
      // 隊色 / 彩帶（前鋒 × 玩法）變動 → 重套外觀
      const wantRibbon = ribbonsOn && o.striker;
      if (c.appliedTeam !== o.team || c.appliedRibbon !== wantRibbon) {
        c.appliedTeam = o.team;
        c.appliedRibbon = wantRibbon;
        const col = hex(soccerTeamColorHex(o.team));
        c.bodyMat.diffuseColor = col;
        c.bodyMat.emissiveColor = col.scale(0.3);
        c.ribbon.setEnabled(wantRibbon);
      }
      // 前鋒彩帶輕微擺動
      if (c.appliedRibbon) {
        c.ribbon.rotation.z = Math.sin(now * 0.005 + c.root.position.x) * RIBBON_SWING;
      }
    }
    this.updateMyRibbon(now);
  }

  /**
   * 推球模式的共用球：亮黃 emissive 球體（學生好追）＋黑色接縫線，位置取邏輯層
   * 60Hz 內插後的 soccerState.ball.pos；本機貼近球時微發亮（純視覺回饋，物理在伺服器）。
   * lazy 建立 / 半徑變更重建 / 非 ball 模式自動清除。
   */
  private syncSharedBall(): void {
    const b = soccerState.ball;
    const want = soccerState.mode === 'ball' && !!b && b.hasPos;
    if (!want) {
      if (this.sharedBall) {
        this.sharedBall.dispose(false, true);
        this.sharedBall = null;
        this.sharedBallMat = null;
        this.sharedBallR = 0;
      }
      return;
    }
    const ball = b!;
    if (!this.sharedBall || this.sharedBallR !== ball.r) {
      this.sharedBall?.dispose(false, true);
      this.sharedBallR = ball.r;
      const mesh = MeshBuilder.CreateSphere(
        'soccerSharedBall',
        { diameter: ball.r * 2, segments: 20 },
        this.scene,
      );
      const mat = new StandardMaterial('soccerSharedBallMat', this.scene);
      mat.diffuseColor = hex(BALL_COLOR);
      mat.emissiveColor = hex(BALL_COLOR).scale(BALL_GLOW_IDLE);
      mat.specularColor = new Color3(0.3, 0.3, 0.3);
      mesh.material = mat;
      mesh.isPickable = false;
      // 黑色接縫線（icosphere 線框）→ 滾動 / 位移看得出來，像顆足球
      const seams = MeshBuilder.CreateIcoSphere(
        'soccerSharedBallSeams',
        { radius: ball.r * 1.002, subdivisions: 1 },
        this.scene,
      );
      const seamMat = new StandardMaterial('soccerSharedBallSeamMat', this.scene);
      seamMat.emissiveColor = hex(0x1a1a1a);
      seamMat.disableLighting = true;
      seamMat.wireframe = true;
      seams.material = seamMat;
      seams.isPickable = false;
      seams.parent = mesh;
      this.sharedBall = mesh;
      this.sharedBallMat = mat;
      this.sharedBallGlow = BALL_GLOW_IDLE;
    }
    this.sharedBall.position.set(ball.pos.x, ball.pos.y, ball.pos.z);
    // 貼近球 → 微發亮（有變才寫材質）
    const glow = soccerState.ballNear ? BALL_GLOW_NEAR : BALL_GLOW_IDLE;
    if (glow !== this.sharedBallGlow && this.sharedBallMat) {
      this.sharedBallGlow = glow;
      this.sharedBallMat.emissiveColor = hex(BALL_COLOR).scale(glow);
    }
  }

  /** 自己是前鋒（striker 玩法限定）→ 機體上方掛彩帶（跟著自機位置 / 朝向） */
  private updateMyRibbon(now: number): void {
    if (soccerState.myStriker && soccerState.mode === 'striker') {
      if (!this.myRibbon) {
        this.myRibbon = makeStrikerRibbon(this.scene, 'me');
        this.myRibbon.scaling.setAll(RIBBON_SCALE);
      }
      this.myRibbon.setEnabled(true);
      this.myRibbon.position.set(droneState.position.x, droneState.position.y, droneState.position.z);
      this.myRibbon.rotation.y = droneState.yaw;
      this.myRibbon.rotation.z = Math.sin(now * 0.005) * RIBBON_SWING;
    } else {
      this.myRibbon?.setEnabled(false);
    }
  }

  /** 依 soccerState.others 差集建立 / 移除分身 */
  private syncClones(): void {
    for (const [id, o] of soccerState.others) {
      if (!this.clones.has(id)) this.clones.set(id, this.makeClone(id, o));
    }
    for (const [id, c] of this.clones) {
      if (!soccerState.others.has(id)) {
        c.root.dispose(false, true);
        this.clones.delete(id);
      }
    }
  }

  /** 他人分身：隊色盒身 + 白色機鼻錐（-Z = 機頭）+ 名牌 + 前鋒彩帶（對齊 legacy makeSoccerDrone） */
  private makeClone(id: string, o: SoccerOther): SoccerCloneVisual {
    const scene = this.scene;
    const root = new TransformNode(`soccerClone-${id}`, scene);
    const col = hex(soccerTeamColorHex(o.team));

    const bodyMat = new StandardMaterial(`soccerCloneBody-${id}`, scene);
    bodyMat.diffuseColor = col;
    bodyMat.emissiveColor = col.scale(0.3);
    // 分身尺寸對齊縮放後的自機（約 1.5m 寬）→ 與場地同比例、不會像小點
    const body = MeshBuilder.CreateBox(
      `soccerCloneBox-${id}`,
      { width: 1.4, height: 0.4, depth: 1.4 },
      scene,
    );
    body.material = bodyMat;
    body.parent = root;

    const noseMat = new StandardMaterial(`soccerCloneNose-${id}`, scene);
    noseMat.emissiveColor = Color3.White();
    noseMat.disableLighting = true;
    const nose = MeshBuilder.CreateCylinder(
      `soccerCloneNoseM-${id}`,
      { height: 0.6, diameterTop: 0, diameterBottom: 0.4, tessellation: 10 },
      scene,
    );
    nose.rotation.x = -Math.PI / 2; // 錐尖朝 -Z（機頭方向）
    nose.position.z = -0.92;
    nose.material = noseMat;
    nose.parent = root;

    const label = makeNameLabel(scene, `${o.emoji || ''}${o.name || '?'}`);
    label.position.y = CLONE_LABEL_Y;
    label.parent = root;

    const ribbon = makeStrikerRibbon(scene, id);
    ribbon.scaling.setAll(RIBBON_SCALE);
    ribbon.parent = root;
    const wantRibbon = soccerState.mode === 'striker' && o.striker; // ball 模式不顯示彩帶
    ribbon.setEnabled(wantRibbon);

    if (o.hasPos) {
      root.position.set(o.pos.x, o.pos.y, o.pos.z);
      root.rotation.y = o.pos.yaw;
    }
    return { root, bodyMat, ribbon, appliedTeam: o.team, appliedRibbon: wantRibbon };
  }

  // ---------------------------------------------------------------------------
  // 清理
  // ---------------------------------------------------------------------------
  private disposeAll(): void {
    if (!this.active && this.fieldMeshes.length === 0) return;
    this.active = false;
    this.generation++;
    // 門框碰撞卸下（backend 是共用單例，只移自己的靜態體）
    this.backend.removeStatic('soccer-goals');
    setMeshCollisionBackend(null, DRONE_RADIUS);
    this.collisionReady = false;

    this.fieldMeshes.forEach((m) => m.dispose(false, true));
    this.fieldMeshes = [];
    this.goalMeshes = [];
    this.dummyMeshes.forEach((m) => m.dispose(false, true));
    this.dummyMeshes = [];
    this.ballCage?.dispose(false, true);
    this.ballCage = null;
    this.sharedBall?.dispose(false, true);
    this.sharedBall = null;
    this.sharedBallMat = null;
    this.sharedBallR = 0;
    for (const c of this.clones.values()) c.root.dispose(false, true);
    this.clones.clear();
    this.myRibbon?.dispose(false, true);
    this.myRibbon = null;

    this.drone.setScaleFactor(1); // 還原飛機大小
    this.setDefaultGroundVisible(true);
  }

  /**
   * 足球場地與預設地面物件互斥（對齊 legacy：ground / grid 跟著切）。
   * 起飛台（黃色圓盤）與起點白圈也一併隱藏 — 它們卡在中場，推球模式的共用球是亮黃色，
   * 留著會跟球混淆。
   */
  private setDefaultGroundVisible(on: boolean): void {
    for (const name of ['ground', 'grid', 'pad', 'startMarker']) {
      const m = this.scene.getMeshByName(name);
      if (m) m.isVisible = on;
    }
  }
}

/** 前鋒識別彩帶：機體上方一條醒目亮黃飄帶（不做布料物理，tick 內輕微擺動） */
function makeStrikerRibbon(scene: Scene, id: string): TransformNode {
  const g = new TransformNode(`strikerRibbon-${id}`, scene);
  const bandMat = new StandardMaterial(`strikerRibbonMat-${id}`, scene);
  bandMat.emissiveColor = hex(0xffe066);
  bandMat.disableLighting = true;
  bandMat.alpha = 0.95;
  bandMat.backFaceCulling = false;
  const band = MeshBuilder.CreatePlane(`strikerBand-${id}`, { width: 0.14, height: 0.9 }, scene);
  band.position.y = 0.6;
  band.material = bandMat;
  band.isPickable = false;
  band.parent = g;
  const tipMat = new StandardMaterial(`strikerTipMat-${id}`, scene);
  tipMat.emissiveColor = hex(0xffd000);
  tipMat.disableLighting = true;
  const tip = MeshBuilder.CreateCylinder(
    `strikerTip-${id}`,
    { height: 0.18, diameterTop: 0, diameterBottom: 0.2, tessellation: 4 },
    scene,
  );
  tip.position.y = 1.06;
  tip.material = tipMat;
  tip.isPickable = false;
  tip.parent = g;
  return g;
}
