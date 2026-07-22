// 畫畫教室：持久粗墨水線渲染（Babylon GreasedLine）。
// 訂閱 core/pen.ts 發出的 ink-* 事件；每段 stroke 一顆 GreasedLine mesh、各自顏色。
//
// 效能策略（呼應 legacy L989–997 的坑：成長中的 LineGeometry 不能就地 setPositions，
// 必須整顆換新幾何）：
//   - 「進行中 stroke 每加一點就 dispose 舊 mesh、用累積點重建一顆新 GreasedLine；
//      stroke 結束（開新段 / 抬筆）後就不再動它 = 固化」。
//   - 不採 updatable + 預配大 buffer 方案：單段上限 1500 點、取樣 60ms 節流
//     （最多 ~17 次/秒重建），重建成本低；而預配方案要自己管 instance count 與
//     零寬 padding 段，複雜度高、又容易踩到與 legacy 同型的「就地更新不生效」問題。
import {
  Scene,
  Color3,
  CreateGreasedLine,
  GreasedLineMeshMaterialType,
  type GreasedLineBaseMesh,
} from '@babylonjs/core';
import { bus } from '../core/events';

// ---- 墨水線視覺常數 ----
/**
 * 線寬（世界單位）。legacy 是 6px 螢幕空間 fat line（INK_WIDTH=6）；
 * 本版用世界寬度：俯視相機距繪圖面約 15–18m、fov 60° 時 0.18m ≈ 6px，視覺對齊。
 */
const INK_WIDTH_WORLD = 0.18;

interface InkStroke {
  color: Color3;
  /** 攤平的 xyz 座標（GreasedLine points 格式） */
  points: number[];
  mesh: GreasedLineBaseMesh | null;
}

export class InkVisual {
  private scene: Scene;
  private strokes = new Map<number, InkStroke>();
  /** 進行中 stroke 的 id（只有它會被重建；其餘已固化） */
  private currentId: number | null = null;

  constructor(scene: Scene) {
    this.scene = scene;
    bus.on('ink-stroke-start', ({ id, color }) => this.startStroke(id, color));
    bus.on('ink-point', ({ id, x, y, z }) => this.addPoint(id, x, y, z));
    bus.on('ink-clear', () => this.clear());
  }

  private startStroke(id: number, color: string): void {
    // 前一段固化：mesh 保持現狀，之後不再重建
    this.currentId = id;
    this.strokes.set(id, { color: Color3.FromHexString(color), points: [], mesh: null });
  }

  private addPoint(id: number, x: number, y: number, z: number): void {
    const stroke = this.strokes.get(id);
    if (!stroke || id !== this.currentId) return;
    stroke.points.push(x, y, z);
    if (stroke.points.length < 6) return; // 至少 2 點才畫得出線
    this.rebuild(id, stroke);
  }

  /** 整顆換新：dispose 舊 mesh、用累積點重建（見檔頭效能策略註解） */
  private rebuild(id: number, stroke: InkStroke): void {
    stroke.mesh?.dispose();
    stroke.mesh = CreateGreasedLine(
      `ink${id}`,
      { points: stroke.points },
      {
        color: stroke.color,
        width: INK_WIDTH_WORLD,
        // SIMPLE = 不受光照的純色材質 → 墨水顏色恆定、俯視下辨識度最高
        materialType: GreasedLineMeshMaterialType.MATERIAL_TYPE_SIMPLE,
      },
      this.scene,
    );
    stroke.mesh.isPickable = false;
  }

  private clear(): void {
    for (const s of this.strokes.values()) s.mesh?.dispose();
    this.strokes.clear();
    this.currentId = null;
  }
}
