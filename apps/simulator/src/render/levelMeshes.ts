// 關卡物件視覺：任務圈（torus）、障礙方塊、氣球、passZone 地面標記圈。
// 訂閱 core 事件重建 / 更新；動畫（圈自轉、漂浮）由 tick 驅動。
import {
  Scene,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  Color3,
  TransformNode,
} from '@babylonjs/core';
import type { LevelDef } from '@creafly/shared';
import { bus } from '../core/events';
import { ringWorldY } from '../core/level';
import { CREAFLY_COLOR, hex } from './scene';

const RING_COLORS: Record<string, number> = {
  red: 0xff4444,
  yellow: 0xfbbf24,
  green: 0x4ade80,
  blue: 0x3b82f6,
};

const BALLOON_COLORS = [0xff4d6d, 0xffd166, 0x4dd0e1, 0x9b5de5, 0x4ade80, 0xff9f1c];

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
  mesh: Mesh;
  mat: StandardMaterial;
  baseColor: number;
  baseY: number;
  index: number;
}

export class LevelVisuals {
  private scene: Scene;
  private rings: RingVisual[] = [];
  private obstacles: Mesh[] = [];
  private balloons: Mesh[] = [];
  private zoneDiscs: (Mesh | null)[] = [];
  private disposables: { dispose(): void }[] = [];

  constructor(scene: Scene) {
    this.scene = scene;
    bus.on('level-loaded', ({ level }) => this.build(level));
    bus.on('level-cleared', () => this.clear()); // 進大亂鬥：關卡物件全部移除
    bus.on('ring-passed', ({ index }) => this.setRingVisible(index, false));
    bus.on('rings-reset', () => this.rings.forEach((r) => this.setRingVisible(r.index, true)));
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
      const mesh = this.track(
        MeshBuilder.CreateTorus(
          `ring${i}`,
          { diameter: 3, thickness: 0.24, tessellation: 32 },
          scene,
        ),
      );
      mesh.rotation.x = Math.PI / 2; // Babylon torus 平躺 → 立起來面向 Z
      mesh.parent = node;
      const mat = this.track(new StandardMaterial(`ringMat${i}`, scene));
      mat.diffuseColor = hex(color);
      mat.emissiveColor = hex(color).scale(0.3);
      mat.specularColor = new Color3(0.5, 0.5, 0.5);
      mesh.material = mat;
      this.rings.push({ node, mesh, mat, baseColor: color, baseY: r.y, index: i });
    });

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
      const color = BALLOON_COLORS[i % BALLOON_COLORS.length] as number;
      const mesh = this.track(
        MeshBuilder.CreateSphere(`balloon${i}`, { diameter: 1.4, segments: 20 }, scene),
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
          { diameter: 1.8, thickness: 0.6, tessellation: 32 },
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
  }

  private setRingVisible(index: number, visible: boolean): void {
    this.rings[index]?.node.setEnabled(visible);
  }

  /** faceYaw 圈對準時變綠 */
  private setRingAligned(index: number, aligned: boolean): void {
    const r = this.rings[index];
    if (!r) return;
    const c = aligned ? 0x4ade80 : r.baseColor;
    r.mat.diffuseColor = hex(c);
    r.mat.emissiveColor = hex(c).scale(aligned ? 0.5 : 0.3);
  }

  private highlightZone(index: number): void {
    const disc = this.zoneDiscs[index];
    if (!disc) return;
    const mat = disc.material as StandardMaterial;
    mat.emissiveColor = hex(0x10b981);
    mat.alpha = 0.8;
  }

  /** 每 tick：圈自轉 0.015 + 上下漂浮（與 core 判定同一公式） */
  tick(nowMs: number): void {
    for (const r of this.rings) {
      if (!r.node.isEnabled()) continue;
      r.node.rotation.y += 0.015;
      r.node.position.y = ringWorldY(r.index, r.baseY, nowMs);
    }
  }
}
