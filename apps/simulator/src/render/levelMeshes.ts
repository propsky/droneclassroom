// 關卡物件視覺：任務圈（torus）、障礙方塊、氣球、passZone 地面標記圈。
// 訂閱 core 事件重建 / 更新；動畫（圈自轉、漂浮）由 tick 驅動。
// 有圈的關卡都標出下一個圈（高亮 + 編號）；已穿過與還沒輪到的圈外觀不同。
import {
  Scene,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  Color3,
  DynamicTexture,
  Material,
  TransformNode,
  Vector3,
  type LinesMesh,
} from '@babylonjs/core';
import type { LevelDef, RingGuideLook, RingGuidePhase } from '@creafly/shared';
import {
  balloonDiameter,
  RingGuide,
  RingPassJudge,
  ringBobAmp,
  ringDiameter,
  ringSpin,
  ringYawDeg,
  ringThickness,
  zoneMarkerDiameter,
  zoneTriggerRadius,
  obstacleIsCollidable,
} from '@creafly/shared';
import { bus } from '../core/events';
import { levelState, ringWorldY } from '../core/level';
import { simTime } from '../core/droneState';
import { SceneLedger } from '../core/sceneLedger';
import { CREAFLY_COLOR, hex } from './scene';

const RING_COLORS: Record<string, number> = {
  red: 0xff4444,
  yellow: 0xfbbf24,
  green: 0x4ade80,
  blue: 0x3b82f6,
};

const BALLOON_COLORS = [0xff4d6d, 0xffd166, 0x4dd0e1, 0x9b5de5, 0x4ade80, 0xff9f1c];

const BADGE_PX = 256;
const BADGE_METERS = 1.45;

/** 圈上方的編號牌。沒有 canvas（Node 測試）時不畫，圈的顏色仍會分開。 */
class RingBadgeArt {
  static available(): boolean {
    return typeof document !== 'undefined' && typeof document.createElement === 'function';
  }

  static paint(ctx: CanvasRenderingContext2D, label: string, look: RingGuideLook): void {
    ctx.clearRect(0, 0, BADGE_PX, BADGE_PX);
    ctx.beginPath();
    ctx.arc(128, 128, 108, 0, Math.PI * 2);
    ctx.fillStyle = look.badgeFill;
    ctx.fill();
    ctx.lineWidth = look.pulse ? 18 : 10;
    ctx.strokeStyle = look.badgeStroke;
    ctx.stroke();
    ctx.fillStyle = look.badgeInk;
    ctx.font = `bold ${look.pulse ? 150 : 132}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, 128, 138);
  }
}

function parseColor(c: number | string | undefined, fallback: number): number {
  if (typeof c === 'number') return c;
  if (typeof c === 'string') {
    if (RING_COLORS[c] !== undefined) return RING_COLORS[c] as number;
    const n = parseInt(c.replace('#', ''), 16);
    if (!Number.isNaN(n)) return n;
  }
  return fallback;
}

/**
 * 任務點：地面實心色塊＋外框＋光柱。鋪在考照場照片上也看得到。
 * 還沒輪到維持綠色；下一個用圈的金色、做完用圈的灰色。
 */
const ZONE_COLOR = 0x4ade80;
const ZONE_ALPHA: Record<RingGuidePhase, number> = { next: 0.55, upcoming: 0.35, passed: 0.15 };
/** 光柱：遠處就看得到要往哪裡飛；做完的不畫 */
const ZONE_PILLAR_ALPHA: Record<RingGuidePhase, number> = { next: 0.3, upcoming: 0.12, passed: 0 };
const ZONE_PILLAR_HEIGHT = 3;
/** 編號牌高度：高過機身，從後方鏡頭也不會被無人機擋住 */
const ZONE_BADGE_Y = 2.2;

interface ZoneVisual {
  root: TransformNode;
  disc: Mesh;
  mat: StandardMaterial;
  edge: LinesMesh;
  pillar: Mesh;
  pillarMat: StandardMaterial;
  badge: Mesh | null;
  badgeTex: DynamicTexture | null;
  badgeKey: string;
  point: { x: number; z: number };
}

interface RingVisual {
  node: TransformNode;
  spinNode: TransformNode;
  mesh: Mesh;
  mat: StandardMaterial;
  badge: Mesh | null;
  badgeTex: DynamicTexture | null;
  badgeKey: string;
  badgeScale: number;
  baseColor: number;
  baseY: number;
  bobAmp: number;
  spin: number;
  /** 擺放角度（度），編號牌沿圈面放 */
  yawDeg: number;
  index: number;
  shownColor: number;
  emissiveScale: number;
  pulse: boolean;
  diameter: number;
}

export class LevelVisuals {
  private scene: Scene;
  private rings: RingVisual[] = [];
  private obstacles: Mesh[] = [];
  private balloons: Mesh[] = [];
  /** 位置任務點的地面圈；高度／轉角任務點沒有地面標記（null） */
  private zones: (ZoneVisual | null)[] = [];
  private disposables: { dispose(): void }[] = [];
  /** 旋轉鑽圈：目前回報對準的圈。只有「下一個圈」會因此變綠。 */
  private faceIndex = -1;
  private faceAligned = false;

  constructor(scene: Scene) {
    this.scene = scene;
    bus.on('level-loaded', ({ level }) => this.build(level));
    bus.on('level-cleared', () => this.clear()); // 進大亂鬥：關卡物件全部移除
    bus.on('ring-passed', () => this.refreshGuide());
    bus.on('rings-reset', () => this.refreshGuide());
    bus.on('ring-face', ({ index, aligned }) => this.setRingAligned(index, aligned));
    bus.on('zone-passed', () => this.refreshZoneGuide());
    bus.on('balloon-popped', ({ index }) => this.balloons[index]?.setEnabled(false));
  }

  private clear(): void {
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
    this.rings = [];
    this.obstacles = [];
    this.balloons = [];
    this.zones = [];
    this.faceIndex = -1;
    this.faceAligned = false;
    SceneLedger.set('level', 0);
  }

  private track<T extends { dispose(): void }>(x: T): T {
    this.disposables.push(x);
    return x;
  }

  private build(level: LevelDef): void {
    this.clear();
    const scene = this.scene;

    // ---- 任務圈 ----
    (level.rings ?? []).forEach((r, i) => {
      const color = parseColor(r.color, CREAFLY_COLOR.yellow);
      const node = this.track(new TransformNode(`ringNode${i}`, scene));
      node.position.set(r.x, r.y, r.z);
      // 自轉放在子節點，編號牌留在不轉的 node 上，數字才不會跟著圈轉。
      const spinNode = this.track(new TransformNode(`ringYaw${i}`, scene));
      spinNode.parent = node;
      // 擺放角度＋自轉：和穿圈判定同一條公式（core/level.ts checkRings），看到的圈面就是判定的圈面
      spinNode.rotation.y = RingPassJudge.yawRadAt(ringYawDeg(r), ringSpin(r), simTime.tick);
      const diam = ringDiameter(r);
      const thick = ringThickness(r);
      const mesh = this.track(
        MeshBuilder.CreateTorus(
          `ring${i}`,
          { diameter: diam, thickness: thick, tessellation: 32 },
          scene,
        ),
      );
      mesh.rotation.x = Math.PI / 2; // Babylon torus 平躺 → 立起來面向 Z
      mesh.parent = spinNode;
      const mat = this.track(new StandardMaterial(`ringMat${i}`, scene));
      mat.diffuseColor = hex(color);
      mat.emissiveColor = hex(color).scale(0.3);
      mat.specularColor = new Color3(0.5, 0.5, 0.5);
      mesh.material = mat;
      const badge = this.makeBadge(scene, `courseNum${i}`, node);
      this.rings.push({
        node,
        spinNode,
        mesh,
        mat,
        badge: badge?.mesh ?? null,
        badgeTex: badge?.tex ?? null,
        badgeKey: '',
        badgeScale: 1,
        baseColor: color,
        baseY: r.y,
        bobAmp: ringBobAmp(r),
        spin: ringSpin(r),
        index: i,
        shownColor: color,
        emissiveScale: 0.3,
        pulse: false,
        diameter: diam,
        yawDeg: ringYawDeg(r),
      });
    });
    this.placeBadges();
    this.refreshGuide();

    // ---- 障礙方塊（soft-cube 半透明；solid 較不透明）----
    (level.obstacles ?? []).forEach((o, i) => {
      const color = parseColor(o.color, 0x4ade80);
      const mesh = this.track(MeshBuilder.CreateBox(`obstacle${i}`, { size: o.size }, scene));
      mesh.position.set(o.x, o.y, o.z);
      const mat = this.track(new StandardMaterial(`obstacleMat${i}`, scene));
      mat.diffuseColor = hex(color);
      mat.emissiveColor = hex(color).scale(0.2);
      // 外觀跟著實際碰撞走（physics.collidable 優先），不會出現半透明卻擋路的方塊
      mat.alpha = obstacleIsCollidable(o) ? 0.85 : 0.6;
      mesh.material = mat;
      this.obstacles.push(mesh);
    });

    // ---- 氣球（球體 + 細繩）----
    (level.balloons ?? []).forEach((b, i) => {
      const fallback = BALLOON_COLORS[i % BALLOON_COLORS.length] as number;
      const color = parseColor(b.color, fallback);
      const diam = balloonDiameter(b);
      const mesh = this.track(
        MeshBuilder.CreateSphere(`balloon${i}`, { diameter: diam, segments: 20 }, scene),
      );
      mesh.position.set(b.x, b.y, b.z);
      const mat = this.track(new StandardMaterial(`balloonMat${i}`, scene));
      mat.diffuseColor = hex(color);
      mat.emissiveColor = hex(color).scale(0.35);
      mat.alpha = 0.95;
      mesh.material = mat;
      const str = this.track(
        MeshBuilder.CreateCylinder(`balloonStr${i}`, { diameter: 0.03, height: 0.9 }, scene),
      );
      str.position.set(0, -0.8, 0);
      str.parent = mesh;
      const strMat = this.track(new StandardMaterial(`balloonStrMat${i}`, scene));
      strMat.emissiveColor = Color3.White();
      strMat.disableLighting = true;
      strMat.alpha = 0.5;
      str.material = strMat;
      this.balloons.push(mesh);
    });

    // ---- passZone 地面標記圈＋步驟編號 ----
    (level.passZones ?? []).forEach((zone, i) => {
      // 位置型畫標記圈；高度／轉角有設觸發半徑時畫出觸發範圍，沒設（任何位置都算）就不畫
      const trigger = zoneTriggerRadius(zone);
      const marker = zone.type === 'position' ? zoneMarkerDiameter(zone) : trigger !== null ? trigger * 2 : null;
      if (marker === null) {
        this.zones.push(null);
        return;
      }
      const x = zone.x || 0;
      const z = zone.z || 0;
      const root = this.track(new TransformNode(`zoneNode${i}`, scene));
      root.position.set(x, 0, z);
      // 位置任務點四邊都有設：直接畫出判定框（學生看到的就是要飛進去的範圍）；其他畫圓
      const box =
        zone.type === 'position' &&
        zone.minX != null && zone.maxX != null && zone.minZ != null && zone.maxZ != null &&
        zone.maxX > zone.minX && zone.maxZ > zone.minZ
          ? { minX: zone.minX, maxX: zone.maxX, minZ: zone.minZ, maxZ: zone.maxZ }
          : null;
      const disc = this.track(
        box
          ? MeshBuilder.CreateGround(`zoneDisc${i}`, { width: box.maxX - box.minX, height: box.maxZ - box.minZ }, scene)
          : MeshBuilder.CreateDisc(`zoneDisc${i}`, { radius: marker / 2, tessellation: 40 }, scene),
      );
      if (!box) disc.rotation.x = Math.PI / 2;
      disc.parent = root;
      disc.position.set(box ? (box.minX + box.maxX) / 2 - x : 0, 0.03, box ? (box.minZ + box.maxZ) / 2 - z : 0);
      disc.isPickable = false;
      const mat = this.track(new StandardMaterial(`zoneDiscMat${i}`, scene));
      mat.emissiveColor = hex(ZONE_COLOR);
      mat.disableLighting = true;
      mat.backFaceCulling = false;
      mat.alpha = ZONE_ALPHA.upcoming;
      disc.material = mat;
      // 外框：不透明的線，色塊淡的時候也分得出邊界
      const outline = box
        ? [
            new Vector3(box.minX - x, 0.05, box.minZ - z),
            new Vector3(box.maxX - x, 0.05, box.minZ - z),
            new Vector3(box.maxX - x, 0.05, box.maxZ - z),
            new Vector3(box.minX - x, 0.05, box.maxZ - z),
            new Vector3(box.minX - x, 0.05, box.minZ - z),
          ]
        : Array.from({ length: 41 }, (_, k) => {
            const a = (k / 40) * Math.PI * 2;
            return new Vector3((Math.cos(a) * marker) / 2, 0.05, (Math.sin(a) * marker) / 2);
          });
      const edge = this.track(MeshBuilder.CreateLines(`zoneEdge${i}`, { points: outline }, scene));
      edge.parent = root;
      edge.isPickable = false;
      const pillar = this.track(
        MeshBuilder.CreateCylinder(
          `zonePillar${i}`,
          { diameter: Math.min(1.2, marker * 0.6), height: ZONE_PILLAR_HEIGHT, tessellation: 20, cap: Mesh.NO_CAP },
          scene,
        ),
      );
      pillar.parent = root;
      pillar.position.y = ZONE_PILLAR_HEIGHT / 2;
      pillar.isPickable = false;
      const pillarMat = this.track(new StandardMaterial(`zonePillarMat${i}`, scene));
      pillarMat.emissiveColor = hex(ZONE_COLOR);
      pillarMat.disableLighting = true;
      pillarMat.backFaceCulling = false;
      pillarMat.alpha = ZONE_PILLAR_ALPHA.upcoming;
      pillar.material = pillarMat;
      const badge = this.makeBadge(scene, `zoneNum${i}`, root);
      if (badge) badge.mesh.position.set(0, ZONE_BADGE_Y, 0);
      this.zones.push({
        root,
        disc,
        mat,
        edge,
        pillar,
        pillarMat,
        badge: badge?.mesh ?? null,
        badgeTex: badge?.tex ?? null,
        badgeKey: '',
        point: { x, z },
      });
    });
    this.refreshZoneGuide();
    SceneLedger.set('level', this.disposables.length);
  }

  /**
   * 編號放在自己那圈的側邊、路線外側（RingGuide.badgeDir）。
   * 若好幾圈幾乎排在同一條直線（1-4），再依順序往右錯開，避免編號疊在同一個洞裡。
   * 位置岔開的關卡（1-5）不錯開，編號才會留在自己的圈旁邊。
   */
  private placeBadges(): void {
    for (const ring of this.rings) {
      if (!ring.badge) continue;
      const side = ring.diameter / 2 + 0.55;
      const points = this.rings.map((r) => ({ x: r.node.position.x, z: r.node.position.z, yawDeg: r.yawDeg }));
      // 沿圈面往外放：圈轉了角度，編號牌也跟著擺到圈的側邊，不會擋在穿越路線上
      const dir = RingGuide.badgeDir(ring.index, points);
      const dist = side + RingGuide.lateralSpread(ring.index, points);
      ring.badge.position.x = dir.x * dist;
      ring.badge.position.z = dir.z * dist;
      ring.badge.position.y = 0.35;
    }
  }

  /** 編號牌掛在圈旁邊，永遠面向鏡頭。名稱不以 ring 開頭，避免和 torus 的卸載檢查混在一起。 */
  private makeBadge(
    scene: Scene,
    name: string,
    parent: TransformNode,
  ): { mesh: Mesh; tex: DynamicTexture } | null {
    if (!RingBadgeArt.available()) return null;
    try {
      const tex = this.track(
        new DynamicTexture(
          `${name}Tex`,
          { width: BADGE_PX, height: BADGE_PX },
          scene,
          false,
        ),
      );
      tex.hasAlpha = true;
      const mesh = this.track(
        MeshBuilder.CreatePlane(name, { width: BADGE_METERS, height: BADGE_METERS }, scene),
      );
      mesh.parent = parent;
      mesh.position.y = 0.35;
      mesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
      mesh.renderingGroupId = 1;
      mesh.isPickable = false;
      const mat = this.track(new StandardMaterial(`${name}Mat`, scene));
      mat.diffuseTexture = tex;
      mat.emissiveColor = Color3.White();
      mat.disableLighting = true;
      mat.useAlphaFromDiffuseTexture = true;
      mat.transparencyMode = Material.MATERIAL_ALPHABLEND;
      mat.backFaceCulling = false;
      mesh.material = mat;
      return { mesh, tex };
    } catch (err) {
      console.warn('圈編號畫不出來', err);
      return null;
    }
  }

  /** 依模擬器裡的通過旗標重畫每一圈。判定本身不在這裡。 */
  private refreshGuide(): void {
    const passed = levelState.rings.map((r) => r.passed);
    for (const r of this.rings) {
      const phase = RingGuide.phase(passed, r.index);
      const aligned = phase === 'next' && this.faceAligned && this.faceIndex === r.index;
      this.applyLook(r, RingGuide.look(phase, aligned), RingGuide.label(r.index));
    }
  }

  private applyLook(r: RingVisual, look: RingGuideLook, label: string): void {
    const color = look.color ?? r.baseColor;
    r.shownColor = color;
    r.emissiveScale = look.emissive;
    r.pulse = look.pulse;
    r.badgeScale = look.badgeScale;
    r.mat.diffuseColor = hex(color);
    r.mat.emissiveColor = hex(color).scale(look.emissive);
    r.mat.alpha = look.alpha;
    r.mat.transparencyMode = look.alpha < 0.999 ? Material.MATERIAL_ALPHABLEND : Material.MATERIAL_OPAQUE;
    if (!r.badge || !r.badgeTex) return;
    r.badge.scaling.setAll(look.badgeScale);
    const key = `${label}|${look.badgeFill}|${look.badgeInk}|${look.pulse}`;
    if (r.badgeKey === key) return;
    r.badgeKey = key;
    const ctx = r.badgeTex.getContext() as CanvasRenderingContext2D;
    RingBadgeArt.paint(ctx, label, look);
    r.badgeTex.update();
  }

  /** faceYaw 圈對準時，下一個圈變綠 */
  private setRingAligned(index: number, aligned: boolean): void {
    this.faceIndex = index;
    this.faceAligned = aligned;
    this.refreshGuide();
  }

  /**
   * 任務點和圈一樣標出下一步：下一個金色、做完變灰、還沒輪到維持綠色。
   * 同一地點有好幾步（八字交叉點、回到原點）只顯示一個，見 RingGuide.shownAtSameSpot。
   */
  private refreshZoneGuide(): void {
    const done = levelState.zoneProgress;
    const shown = RingGuide.shownAtSameSpot(
      this.zones.map((z) => z?.point ?? null),
      done,
    );
    this.zones.forEach((z, i) => {
      if (!z) return;
      z.root.setEnabled(shown[i]!);
      if (!shown[i]) return;
      const phase = RingGuide.phase(done, i);
      const look = RingGuide.look(phase);
      const color = hex(look.color ?? ZONE_COLOR);
      z.mat.emissiveColor = color;
      z.mat.alpha = ZONE_ALPHA[phase];
      z.edge.color = color;
      z.edge.alpha = phase === 'passed' ? 0.4 : 1;
      z.pillarMat.emissiveColor = color;
      z.pillarMat.alpha = ZONE_PILLAR_ALPHA[phase];
      z.pillar.setEnabled(ZONE_PILLAR_ALPHA[phase] > 0);
      if (!z.badge || !z.badgeTex) return;
      z.badge.scaling.setAll(look.badgeScale);
      const label = RingGuide.label(i);
      const key = `${label}|${look.badgeFill}|${look.badgeInk}|${look.pulse}`;
      if (z.badgeKey === key) return;
      z.badgeKey = key;
      RingBadgeArt.paint(z.badgeTex.getContext() as CanvasRenderingContext2D, label, look);
      z.badgeTex.update();
    });
  }

  /** 每 tick：圈自轉 + 上下漂浮（與 core 判定同一公式，用絕對模擬 tick）。spin 為 0 的關卡不會轉。 */
  tick(nowMs: number): void {
    for (const r of this.rings) {
      r.spinNode.rotation.y = RingPassJudge.yawRadAt(r.yawDeg, r.spin, simTime.tick);
      r.node.position.y = ringWorldY(r.index, r.baseY, nowMs, r.bobAmp);
      if (!r.pulse) continue;
      const wave = 0.82 + 0.18 * Math.sin(nowMs * 0.005);
      r.mat.emissiveColor = hex(r.shownColor).scale(r.emissiveScale * wave);
      if (r.badge) r.badge.scaling.setAll(r.badgeScale * (0.96 + 0.04 * Math.sin(nowMs * 0.005)));
    }
  }
}
