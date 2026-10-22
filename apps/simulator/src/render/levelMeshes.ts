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
} from '@babylonjs/core';
import type { LevelDef, RingGuideLook } from '@creafly/shared';
import {
  balloonDiameter,
  RingGuide,
  ringBobAmp,
  ringDiameter,
  ringSpin,
  ringThickness,
  zoneMarkerDiameter,
} from '@creafly/shared';
import { bus } from '../core/events';
import { levelState, ringWorldY } from '../core/level';
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
  private zoneDiscs: (Mesh | null)[] = [];
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
    bus.on('zone-passed', ({ index }) => this.highlightZone(index));
    bus.on('balloon-popped', ({ index }) => this.balloons[index]?.setEnabled(false));
  }

  private clear(): void {
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
    this.rings = [];
    this.obstacles = [];
    this.balloons = [];
    this.zoneDiscs = [];
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
      const badge = this.makeBadge(scene, i, node);
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
      mat.alpha = o.solid ? 0.85 : 0.6;
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

    // ---- passZone 地面標記圈（只有 position 型畫在地上才有意義）----
    (level.passZones ?? []).forEach((zone, i) => {
      if (zone.type !== 'position') {
        this.zoneDiscs.push(null);
        return;
      }
      const disc = this.track(
        MeshBuilder.CreateTorus(
          `zoneDisc${i}`,
          { diameter: zoneMarkerDiameter(zone), thickness: 0.6, tessellation: 32 },
          scene,
        ),
      );
      disc.scaling.y = 0.03;
      disc.position.set(zone.x || 0, 0.02, zone.z || 0);
      const mat = this.track(new StandardMaterial(`zoneDiscMat${i}`, scene));
      mat.emissiveColor = hex(0x4ade80);
      mat.disableLighting = true;
      mat.alpha = 0.4;
      disc.material = mat;
      this.zoneDiscs.push(disc);
    });
    SceneLedger.set('level', this.disposables.length);
  }

  /**
   * 編號放在自己那圈的右側。
   * 若好幾圈幾乎排在同一條直線（1-4），再依順序往右錯開，避免編號疊在同一個洞裡。
   * 位置岔開的關卡（1-5）不錯開，編號才會留在自己的圈旁邊。
   */
  private placeBadges(): void {
    for (const ring of this.rings) {
      if (!ring.badge) continue;
      const side = ring.diameter / 2 + 0.55;
      const points = this.rings.map((r) => ({ x: r.node.position.x, z: r.node.position.z }));
      ring.badge.position.x = side + RingGuide.lateralSpread(ring.index, points);
      ring.badge.position.y = 0.35;
    }
  }

  /** 編號牌掛在圈旁邊，永遠面向鏡頭。名稱不以 ring 開頭，避免和 torus 的卸載檢查混在一起。 */
  private makeBadge(
    scene: Scene,
    index: number,
    parent: TransformNode,
  ): { mesh: Mesh; tex: DynamicTexture } | null {
    if (!RingBadgeArt.available()) return null;
    try {
      const tex = this.track(
        new DynamicTexture(
          `courseNumTex${index}`,
          { width: BADGE_PX, height: BADGE_PX },
          scene,
          false,
        ),
      );
      tex.hasAlpha = true;
      const mesh = this.track(
        MeshBuilder.CreatePlane(`courseNum${index}`, { width: BADGE_METERS, height: BADGE_METERS }, scene),
      );
      mesh.parent = parent;
      mesh.position.y = 0.35;
      mesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
      mesh.renderingGroupId = 1;
      mesh.isPickable = false;
      const mat = this.track(new StandardMaterial(`courseNumMat${index}`, scene));
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

  private highlightZone(index: number): void {
    const disc = this.zoneDiscs[index];
    if (!disc) return;
    const mat = disc.material as StandardMaterial;
    mat.emissiveColor = hex(0x10b981);
    mat.alpha = 0.8;
  }

  /** 每 tick：圈自轉 + 上下漂浮（與 core 判定同一公式）。spin 為 0 的關卡不會轉。 */
  tick(nowMs: number): void {
    for (const r of this.rings) {
      r.spinNode.rotation.y += r.spin;
      r.node.position.y = ringWorldY(r.index, r.baseY, nowMs, r.bobAmp);
      if (!r.pulse) continue;
      const wave = 0.82 + 0.18 * Math.sin(nowMs * 0.005);
      r.mat.emissiveColor = hex(r.shownColor).scale(r.emissiveScale * wave);
      if (r.badge) r.badge.scaling.setAll(r.badgeScale * (0.96 + 0.04 * Math.sin(nowMs * 0.005)));
    }
  }
}
