// 大亂鬥視覺：他人分身（盒身+機鼻錐+名牌）、氣球、鬼抓捕光環、掩體方塊、
// 自機的鬼/暈眩/無敵外觀 — Babylon 版，行為對齊 legacy main.js §15。
// 名牌與氣球等幾何做成可重用的工廠（未來 soccer 分身共用 makeNameLabel / makeCloneDrone）。
//
// 內插係數 0.25：legacy 是「每渲染幀 @60fps」的值。本版渲染幀率可變（高更新率螢幕 / 掉幀），
// 因此把內插放在 60Hz 固定物理 tick 執行 —— 每 tick 0.25 與 legacy 每幀 0.25@60fps 完全等價，
// 且不會因渲染幀率不同而忽快忽慢。
import {
  Scene,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  DynamicTexture,
  Color3,
  TransformNode,
} from '@babylonjs/core';
import { bus } from '../core/events';
import { droneState } from '../core/droneState';
import {
  arenaState,
  myInvincibleNow,
  GHOST_CATCH_R,
  ARENA_OBSTACLE_DEFS,
} from '../multiplayer/arena';
import { hex } from './scene';
import type { DroneVisual } from './drone';

const INTERP = 0.25; // 每 60Hz tick 的指數內插係數（= legacy 每幀 @60fps）
const BALLOON_COLORS = [0xff4d6d, 0xffd166, 0x4dd0e1, 0x9b5de5, 0x4ade80, 0xff9f1c];
const GHOST_RED = 0xff2d55;

// ---- id → 穩定顏色（與 legacy arenaColorForId 同一 hash → hsl(h,70%,55%)）----
const _cloneHue = new Map<string, number>();
function cloneColorForId(id: string): Color3 {
  let h = _cloneHue.get(id);
  if (h === undefined) {
    h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
    _cloneHue.set(id, h);
  }
  return hslColor3(h, 0.7, 0.55);
}

function hslColor3(h: number, s: number, l: number): Color3 {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return new Color3(r + m, g + m, b + m);
}

/** 名牌：Canvas 圓角底 + 名字 → billboard 平面（renderingGroup 1 = 不被場景擋住，同 legacy depthTest:false） */
export function makeNameLabel(scene: Scene, text: string): Mesh {
  const dt = new DynamicTexture('nameLabel', { width: 256, height: 64 }, scene, false);
  dt.hasAlpha = true;
  const ctx = dt.getContext() as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, 256, 64);
  ctx.fillStyle = 'rgba(10,37,64,0.82)';
  roundRect(ctx, 4, 8, 248, 48, 14);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 30px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text.slice(0, 8), 128, 34);
  dt.update();

  const plane = MeshBuilder.CreatePlane('nameLabelPlane', { width: 3, height: 0.75 }, scene);
  plane.billboardMode = Mesh.BILLBOARDMODE_ALL;
  plane.renderingGroupId = 1; // 永遠畫在場景上面（label 不被牆 / 圈擋住）
  plane.isPickable = false;
  const mat = new StandardMaterial('nameLabelMat', scene);
  mat.diffuseTexture = dt;
  mat.emissiveColor = Color3.White();
  mat.disableLighting = true;
  mat.useAlphaFromDiffuseTexture = true;
  mat.backFaceCulling = false;
  plane.material = mat;
  plane.position.y = 1.4;
  return plane;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fill();
}

/** 一個他人分身的視覺物件組 */
interface CloneVisual {
  root: TransformNode;
  bodyMat: StandardMaterial;
  baseColor: Color3;
  /** 全部材質 + 原始 alpha（暈眩變暗 / 無敵閃爍） */
  fadeMats: { mat: StandardMaterial; baseAlpha: number }[];
  aura: Mesh | null;
  auraMat: StandardMaterial | null;
  appliedRole: 'ghost' | 'runner';
  appliedStunned: boolean;
  wasInvincible: boolean;
}

export class ArenaCloneVisuals {
  private scene: Scene;
  private drone: DroneVisual;
  private clones = new Map<string, CloneVisual>();
  private balloons = new Map<number, Mesh>();
  private balloonMats: StandardMaterial[] = [];
  private obstacles: Mesh[] = [];
  private myAura: Mesh | null = null;
  private myAuraMat: StandardMaterial | null = null;
  private myAppliedScale = 1;

  constructor(scene: Scene, drone: DroneVisual) {
    this.scene = scene;
    this.drone = drone;
    bus.on('arena-entered', () => this.buildObstacles());
    bus.on('arena-exited', () => this.disposeAll());
  }

  // ---------------------------------------------------------------------------
  // 每個物理 tick（main.ts 在 arena.active 時呼叫）
  // ---------------------------------------------------------------------------
  tick(): void {
    if (!arenaState.active) return;
    const now = Date.now();
    this.syncBalloons();
    this.syncClones();

    const tagRunning = arenaState.mode === 'tag' && arenaState.status === 'running';
    const meInvincible = myInvincibleNow(now);

    // ---- 自機外觀：鬼 = 放大 + 暈眩變暗 + 無敵閃爍 ----
    const scale = arenaState.myRole === 'ghost' ? 1.6 : 1;
    if (scale !== this.myAppliedScale) {
      this.myAppliedScale = scale;
      this.drone.setScaleFactor(scale);
    }
    // setOpacityFactor 內部有快取 → 不閃爍時每 tick 寫 1 沒有成本；閃爍結束自動還原
    if (arenaState.stunned) this.drone.setOpacityFactor(0.3);
    else if (tagRunning && arenaState.myRole === 'runner' && meInvincible) {
      this.drone.setOpacityFactor(blinkOpacity(now));
    } else this.drone.setOpacityFactor(1);

    // ---- 第一輪：內插他人位置 + 無敵閃爍 + 收集「可被抓的逃跑者」位置（光環危險度用） ----
    const runnerPos: { x: number; y: number; z: number }[] = [];
    for (const [id, c] of this.clones) {
      const o = arenaState.others.get(id);
      if (!o) continue;
      if (o.target) {
        const p = c.root.position;
        p.x += (o.target.x - p.x) * INTERP;
        p.y += (o.target.y - p.y) * INTERP;
        p.z += (o.target.z - p.z) * INTERP;
        c.root.rotation.y = o.target.yaw;
      }
      // 角色 / 暈眩改變 → 重套外觀
      if (c.appliedRole !== o.role || c.appliedStunned !== o.stunned) {
        c.appliedRole = o.role;
        c.appliedStunned = o.stunned;
        styleClone(c);
      }
      // 無敵中逐 tick 閃爍；剛結束交回 styleClone 恢復
      if (o.role === 'runner' && !o.stunned) {
        if (o.invincible) setCloneOpacity(c, blinkOpacity(now));
        else if (c.wasInvincible) styleClone(c);
        c.wasInvincible = o.invincible;
      } else c.wasInvincible = false;

      if (o.role === 'runner' && !o.stunned && !o.invincible) runnerPos.push(c.root.position);
    }
    if (arenaState.myRole === 'runner' && !arenaState.stunned && !meInvincible) {
      runnerPos.push(droneState.position);
    }

    // ---- 第二輪：鬼的抓捕光環（跟著鬼；接近逃跑者時脈動 + 變鮮紅） ----
    for (const [id, c] of this.clones) {
      const o = arenaState.others.get(id);
      const showAura = !!o && tagRunning && o.role === 'ghost' && !o.stunned;
      if (showAura) {
        if (!c.aura) {
          const { mesh, mat } = makeCatchAura(this.scene);
          c.aura = mesh;
          c.auraMat = mat;
        }
        c.aura.setEnabled(true);
        c.aura.position.copyFrom(c.root.position);
        applyAuraDanger(c.aura, c.auraMat as StandardMaterial, c.root.position, runnerPos, now);
      } else c.aura?.setEnabled(false);
    }
    // 自己是鬼 → 顯示自己的抓捕光環
    const meGhost = tagRunning && arenaState.myRole === 'ghost' && !arenaState.stunned;
    if (meGhost) {
      if (!this.myAura) {
        const { mesh, mat } = makeCatchAura(this.scene);
        this.myAura = mesh;
        this.myAuraMat = mat;
      }
      this.myAura.setEnabled(true);
      this.myAura.position.set(droneState.position.x, droneState.position.y, droneState.position.z);
      applyAuraDanger(this.myAura, this.myAuraMat as StandardMaterial, droneState.position, runnerPos, now);
    } else this.myAura?.setEnabled(false);
  }

  // ---------------------------------------------------------------------------
  // 同步：氣球 / 分身（依 arenaState 資料差集建立 / 移除）
  // ---------------------------------------------------------------------------
  private syncBalloons(): void {
    for (const [id, b] of arenaState.balloons) {
      const ex = this.balloons.get(id);
      if (ex) {
        ex.position.set(b.x, b.y, b.z); // 重生會換位置
      } else {
        this.balloons.set(id, this.makeBalloon(id, b));
      }
    }
    for (const [id, mesh] of this.balloons) {
      if (!arenaState.balloons.has(id)) {
        mesh.dispose(false, true);
        this.balloons.delete(id);
      }
    }
  }

  private syncClones(): void {
    for (const [id, o] of arenaState.others) {
      if (!this.clones.has(id)) {
        this.clones.set(id, this.makeClone(id, o.name, o.emoji, o.target));
      }
    }
    for (const [id, c] of this.clones) {
      if (!arenaState.others.has(id)) {
        c.aura?.dispose(false, true);
        c.root.dispose(false, true); // 遞迴 dispose 子 mesh + 材質 + 貼圖
        this.clones.delete(id);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 工廠
  // ---------------------------------------------------------------------------
  /** 他人分身：色盒機身 + 白色機鼻錐（指向 -Z = 機頭）+ 4 顆馬達球 + 名牌 */
  private makeClone(
    id: string,
    name: string,
    emoji: string,
    target: { x: number; y: number; z: number; yaw: number } | null,
  ): CloneVisual {
    const scene = this.scene;
    const col = cloneColorForId(id);
    const root = new TransformNode(`clone-${id}`, scene);

    const bodyMat = new StandardMaterial(`cloneBody-${id}`, scene);
    bodyMat.diffuseColor = col.clone();
    bodyMat.emissiveColor = col.scale(0.25);
    const body = MeshBuilder.CreateBox(`cloneBox-${id}`, { width: 0.9, height: 0.25, depth: 0.9 }, scene);
    body.material = bodyMat;
    body.parent = root;

    const noseMat = new StandardMaterial(`cloneNose-${id}`, scene);
    noseMat.emissiveColor = Color3.White();
    noseMat.disableLighting = true;
    const nose = MeshBuilder.CreateCylinder(
      `cloneNoseM-${id}`,
      { height: 0.4, diameterTop: 0, diameterBottom: 0.24, tessellation: 12 },
      scene,
    );
    nose.rotation.x = -Math.PI / 2; // 錐尖朝 -Z（機頭方向）
    nose.position.z = -0.6;
    nose.material = noseMat;
    nose.parent = root;

    const motorMat = new StandardMaterial(`cloneMotor-${id}`, scene);
    motorMat.diffuseColor = hex(0x222831);
    for (const [mx, mz] of [[0.5, 0.5], [-0.5, 0.5], [0.5, -0.5], [-0.5, -0.5]] as const) {
      const m = MeshBuilder.CreateSphere(`cloneMotorM-${id}`, { diameter: 0.24, segments: 8 }, scene);
      m.position.set(mx, 0, mz);
      m.material = motorMat;
      m.parent = root;
    }

    const label = makeNameLabel(scene, `${emoji || ''}${name || '?'}`);
    label.parent = root;

    // 出生就放在目標點（避免從原點滑過去）
    if (target) {
      root.position.set(target.x, target.y, target.z);
      root.rotation.y = target.yaw;
    }

    const fadeMats = [bodyMat, noseMat, motorMat, label.material as StandardMaterial].map((m) => ({
      mat: m,
      baseAlpha: m.alpha,
    }));

    return {
      root,
      bodyMat,
      baseColor: col,
      fadeMats,
      aura: null,
      auraMat: null,
      appliedRole: 'runner',
      appliedStunned: false,
      wasInvincible: false,
    };
  }

  private makeBalloon(id: number, b: { x: number; y: number; z: number }): Mesh {
    const color = BALLOON_COLORS[id % BALLOON_COLORS.length] as number;
    const mesh = MeshBuilder.CreateSphere(`arenaBalloon-${id}`, { diameter: 1.4, segments: 16 }, this.scene);
    const mat = new StandardMaterial(`arenaBalloonMat-${id}`, this.scene);
    mat.diffuseColor = hex(color);
    mat.emissiveColor = hex(color).scale(0.35);
    mat.alpha = 0.95;
    mesh.material = mat;
    mesh.position.set(b.x, b.y, b.z);
    mesh.isPickable = false;
    this.balloonMats.push(mat);
    return mesh;
  }

  /** grid 場地紫色掩體（視覺；碰撞由 arena.ts setSolidObstacles 註冊） */
  private buildObstacles(): void {
    if (this.obstacles.length) return;
    const mat = new StandardMaterial('arenaObstacleMat', this.scene);
    mat.diffuseColor = hex(0x9b5de5);
    mat.emissiveColor = hex(0x9b5de5).scale(0.2);
    ARENA_OBSTACLE_DEFS.forEach(([x, y, z], i) => {
      const mesh = MeshBuilder.CreateBox(`arenaObstacle-${i}`, { size: 2.5 }, this.scene);
      mesh.position.set(x, y, z);
      mesh.material = mat;
      this.obstacles.push(mesh);
    });
  }

  /** 離場清理：分身 / 氣球 / 光環 / 掩體全部 dispose，並還原自機外觀 */
  private disposeAll(): void {
    for (const c of this.clones.values()) {
      c.aura?.dispose(false, true);
      c.root.dispose(false, true);
    }
    this.clones.clear();
    for (const mesh of this.balloons.values()) mesh.dispose(false, true);
    this.balloons.clear();
    this.balloonMats = [];
    this.myAura?.dispose(false, true);
    this.myAura = null;
    this.myAuraMat = null;
    // 掩體共用一個材質 → 只在第一顆帶 dispose 材質
    this.obstacles.forEach((o, i) => o.dispose(false, i === 0));
    this.obstacles = [];
    this.drone.setScaleFactor(1);
    this.drone.setOpacityFactor(1);
    this.myAppliedScale = 1;
  }
}

// =============================================================================
// 外觀 helpers（對齊 legacy styleOtherDrone / applyInvincibleBlink / applyAuraDanger）
// =============================================================================
/** 無敵閃爍透明度（legacy applyInvincibleBlink 同公式） */
function blinkOpacity(now: number): number {
  return 0.35 + 0.55 * (Math.sin(now / 90) * 0.5 + 0.5);
}

/** 依角色 / 暈眩調整分身外觀：鬼 = 紅 + 1.6 倍、暈眩 = 變暗（暫時，不是淘汰） */
function styleClone(c: CloneVisual): void {
  if (c.appliedRole === 'ghost') {
    c.root.scaling.setAll(1.6);
    c.bodyMat.diffuseColor = hex(GHOST_RED);
    c.bodyMat.emissiveColor = hex(GHOST_RED).scale(0.25);
  } else {
    c.root.scaling.setAll(1);
    c.bodyMat.diffuseColor = c.baseColor.clone();
    c.bodyMat.emissiveColor = c.baseColor.scale(0.25);
  }
  setCloneOpacity(c, c.appliedStunned ? 0.25 : 1);
}

function setCloneOpacity(c: CloneVisual, factor: number): void {
  for (const { mat, baseAlpha } of c.fadeMats) mat.alpha = baseAlpha * factor;
}

/** 鬼的「抓捕範圍」半透明紅光球（半徑 = 抓捕距離），進到裡面就會被吃 */
function makeCatchAura(scene: Scene): { mesh: Mesh; mat: StandardMaterial } {
  const mesh = MeshBuilder.CreateSphere('catchAura', { diameter: GHOST_CATCH_R * 2, segments: 16 }, scene);
  const mat = new StandardMaterial('catchAuraMat', scene);
  mat.emissiveColor = hex(GHOST_RED);
  mat.disableLighting = true;
  mat.alpha = 0.14;
  mat.disableDepthWrite = true;
  mat.backFaceCulling = false;
  mesh.material = mat;
  mesh.isPickable = false;
  return { mesh, mat };
}

/** 依「最近逃跑者距離」調整光環：越近 → 越鮮紅、脈動越強（快抓到的警示） */
function applyAuraDanger(
  aura: Mesh,
  mat: StandardMaterial,
  gpos: { x: number; y: number; z: number },
  runners: { x: number; y: number; z: number }[],
  now: number,
): void {
  let minD = Infinity;
  for (const rp of runners) {
    const d = Math.hypot(gpos.x - rp.x, gpos.y - rp.y, gpos.z - rp.z);
    if (d < minD) minD = d;
  }
  // t：>2R 為 0（安全）、=R 為 1（即將抓到）
  const t = Math.max(0, Math.min(1, (GHOST_CATCH_R * 2 - minD) / GHOST_CATCH_R));
  if (t <= 0) {
    mat.alpha = 0.14;
    mat.emissiveColor = hex(GHOST_RED);
    aura.scaling.setAll(1);
    return;
  }
  const pulse = 0.5 + 0.5 * Math.sin(now * 0.013); // 0..1 來回
  mat.alpha = 0.18 + 0.34 * t * (0.45 + 0.55 * pulse); // 越近越亮 + 脈動
  mat.emissiveColor = new Color3(1, 0.18 * (1 - t), 0.33 * (1 - t)); // 越近越鮮紅（t=1 → 純紅）
  aura.scaling.setAll(1 + 0.1 * t * pulse); // 輕微脹縮
}
