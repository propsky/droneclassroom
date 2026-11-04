// 撞擊速度提示：撞牆、撞障礙、落地時，速度夠快才發 'impact' 事件給畫面顯示「撞擊 3.2 m/s」。
// 只發事件、不改任何狀態：不影響物理、判定、重播 hash。
import { TICK_HZ } from './droneState';

export type ImpactSurface = 'wall' | 'floor';

export class ImpactWatch {
  /** 撞牆低於這個速度（m/s）不提示：沿牆推著滑、輕輕擦到都不吵 */
  static readonly WALL_MIN_MPS = 0.5;
  /** 落地低於這個速度（m/s）不提示：正常降落 */
  static readonly FLOOR_MIN_MPS = 1;

  /** 上一 tick 是否貼著牆。貼著推的每一 tick 都算撞，只有「剛撞上」那一下才提示 */
  private touching = false;

  /** 每 tick 的牆／障礙碰撞結果 → 要提示就回傳 m/s */
  wall(bumped: boolean, impactPerTick: number): number | null {
    const fresh = bumped && !this.touching;
    this.touching = bumped;
    if (!fresh) return null;
    const mps = impactPerTick * TICK_HZ;
    return mps >= ImpactWatch.WALL_MIN_MPS ? mps : null;
  }

  /** 落地當下往下的速度（每 tick 公尺，正值）→ 要提示就回傳 m/s */
  static floor(downPerTick: number): number | null {
    const mps = downPerTick * TICK_HZ;
    return mps >= ImpactWatch.FLOOR_MIN_MPS ? mps : null;
  }

  reset(): void {
    this.touching = false;
  }
}
