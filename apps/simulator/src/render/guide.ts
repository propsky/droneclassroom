// 畫畫教室：目標圖形參考線（guide 折線 → 虛線輪廓）。
// 對齊 legacy main.js L686–698：畫在 drawHeight + 0.02 的高度（與墨水線同層，
// 俯視時對齊）、白色半透明虛線。
import { Scene, Vector3, MeshBuilder, type LinesMesh } from '@babylonjs/core';
import type { LevelDef } from '@creafly/shared';
import { bus } from '../core/events';
import { DRAW_HEIGHT_DEFAULT } from '../core/pen';
import { hex } from './scene';

// ---- 參考線視覺常數（出處：legacy LineDashedMaterial 參數）----
/** 參考線抬離繪圖面的高度差（避免與墨水線 z-fighting） */
const GUIDE_Y_OFFSET = 0.02;
/** 虛線實段長（legacy dashSize 0.4） */
const GUIDE_DASH_SIZE = 0.4;
/** 虛線空隙長（legacy gapSize 0.3） */
const GUIDE_GAP_SIZE = 0.3;
/** 參考線透明度（legacy opacity 0.35） */
const GUIDE_ALPHA = 0.35;
/** 參考線顏色（legacy 0xffffff 白） */
const GUIDE_COLOR = 0xffffff;

export class GuideVisual {
  private scene: Scene;
  private mesh: LinesMesh | null = null;

  constructor(scene: Scene) {
    this.scene = scene;
    bus.on('level-loaded', ({ level }) => this.build(level));
  }

  private build(level: LevelDef): void {
    this.mesh?.dispose();
    this.mesh = null;
    if (!level.draw || !Array.isArray(level.guide) || level.guide.length < 2) return;

    const gy = (level.drawHeight ?? DRAW_HEIGHT_DEFAULT) + GUIDE_Y_OFFSET;
    const points = level.guide.map(([x, z]) => new Vector3(x, gy, z));

    // Babylon 的 CreateDashedLines 以 dashNb（虛線段數）控制節奏 →
    // 由折線總長換算成「每 dash+gap 週期一段」，視覺對齊 legacy 的 0.4/0.3。
    let totalLen = 0;
    for (let i = 1; i < points.length; i++) {
      totalLen += Vector3.Distance(points[i - 1] as Vector3, points[i] as Vector3);
    }
    const dashNb = Math.max(1, Math.round(totalLen / (GUIDE_DASH_SIZE + GUIDE_GAP_SIZE)));

    this.mesh = MeshBuilder.CreateDashedLines(
      'guideLine',
      {
        points,
        dashNb,
        // dashSize/gapSize 是相對比例：照 legacy 0.4 : 0.3
        dashSize: GUIDE_DASH_SIZE,
        gapSize: GUIDE_GAP_SIZE,
      },
      this.scene,
    );
    this.mesh.color = hex(GUIDE_COLOR);
    this.mesh.alpha = GUIDE_ALPHA;
    this.mesh.isPickable = false;
  }
}
