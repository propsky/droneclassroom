// 飛行範圍（LevelDef.flightBounds）的外觀：地面紅框＋半透明圍牆，學生看得出邊界在哪。
// 擋人的是 core/physics（FlightArea.keepInside），這裡只畫。
import { Color3, MeshBuilder, Scene, StandardMaterial, Vector3, type Mesh, type LinesMesh } from '@babylonjs/core';
import { FlightArea, type LevelDef } from '@creafly/shared';
import { bus } from '../core/events';
import { SceneLedger } from '../core/sceneLedger';

/** 圍牆看得到的高度（碰撞不限高度；太高會擋住鏡頭）。 */
const FENCE_HEIGHT_M = 4;
const FENCE_ALPHA = 0.12;
const FENCE_COLOR = new Color3(0.94, 0.27, 0.27);
/** 地面框線抬離地板，避免和場地底圖 z-fighting。 */
const OUTLINE_Y = 0.05;

export class FlightFenceVisual {
  private scene: Scene;
  private meshes: (Mesh | LinesMesh)[] = [];
  private mat: StandardMaterial | null = null;

  constructor(scene: Scene) {
    this.scene = scene;
    bus.on('level-loaded', ({ level }) => this.build(level));
    bus.on('level-cleared', () => this.clear());
  }

  private clear(): void {
    this.meshes.forEach((m) => m.dispose());
    this.meshes = [];
    SceneLedger.set('flightFence', 0);
  }

  private material(): StandardMaterial {
    if (this.mat) return this.mat;
    const mat = new StandardMaterial('flightFenceMat', this.scene);
    mat.diffuseColor = FENCE_COLOR;
    mat.emissiveColor = FENCE_COLOR.scale(0.6);
    mat.specularColor = Color3.Black();
    mat.alpha = FENCE_ALPHA;
    mat.backFaceCulling = false;
    this.mat = mat;
    return mat;
  }

  private build(level: LevelDef): void {
    this.clear();
    const b = FlightArea.of(level);
    if (!b) return;
    const corners = [
      new Vector3(b.minX, OUTLINE_Y, b.minZ),
      new Vector3(b.maxX, OUTLINE_Y, b.minZ),
      new Vector3(b.maxX, OUTLINE_Y, b.maxZ),
      new Vector3(b.minX, OUTLINE_Y, b.maxZ),
    ];
    const outline = MeshBuilder.CreateLines('flightFenceOutline', { points: [...corners, corners[0]!] }, this.scene);
    outline.color = FENCE_COLOR;
    outline.isPickable = false;
    this.meshes.push(outline);

    const w = b.maxX - b.minX;
    const d = b.maxZ - b.minZ;
    const cx = (b.minX + b.maxX) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    const walls: [number, number, number, number][] = [
      // [中心 x, 中心 z, 寬, 繞 Y 轉角]
      [cx, b.minZ, w, 0],
      [cx, b.maxZ, w, 0],
      [b.minX, cz, d, Math.PI / 2],
      [b.maxX, cz, d, Math.PI / 2],
    ];
    walls.forEach(([x, z, width, rot], i) => {
      const wall = MeshBuilder.CreatePlane(`flightFenceWall${i}`, { width, height: FENCE_HEIGHT_M }, this.scene);
      wall.position.set(x, FENCE_HEIGHT_M / 2, z);
      wall.rotation.y = rot;
      wall.material = this.material();
      wall.isPickable = false;
      this.meshes.push(wall);
    });
    SceneLedger.set('flightFence', this.meshes.length);
  }
}
