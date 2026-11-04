// 真實物理儀表的文字（純函式，Node 測得到）：油門、推力是重量的幾倍、上下合力。
// 用「幾倍重量」而不是牛頓：不同教學機的重量不一樣，比例對每台都成立。

export interface PhysicsReadoutInput {
  /** 油門設定 0..1 */
  throttle: number;
  /** 實際推力 ÷ 重量 */
  thrustRatio: number;
  /** 推力往上的分量 − 重力（m/s²） */
  netLift: number;
  /** 機身傾角（弧度） */
  tilt: number;
  /** 懸停油門 0..1 */
  hover: number;
  /** 停在地上：推力不夠時是地面撐住，不是力平衡在飛 */
  grounded: boolean;
}

export interface PhysicsReadoutView {
  throttle: string;
  thrust: string;
  net: string;
  /** 'up' 推力大於重量、'even' 力平衡、'down' 推力小於重量 */
  balance: 'up' | 'even' | 'down';
  tilt: string;
  /** 油門條：填滿比例與懸停刻度位置（%） */
  fillPct: number;
  hoverPct: number;
}

export class PhysicsReadout {
  /** 上下合力小於這個（m/s²）就算力平衡：幾乎不會再加速 */
  static readonly EVEN = 0.15;

  static of(i: PhysicsReadoutInput): PhysicsReadoutView {
    const onGround = i.grounded && i.netLift <= PhysicsReadout.EVEN;
    const balance = onGround
      ? 'even'
      : i.netLift > PhysicsReadout.EVEN
        ? 'up'
        : i.netLift < -PhysicsReadout.EVEN
          ? 'down'
          : 'even';
    const net = onGround
      ? '地面撐住'
      : balance === 'even'
        ? '力平衡'
        : `${balance === 'up' ? '↑' : '↓'} ${Math.abs(i.netLift).toFixed(1)} m/s²`;
    return {
      throttle: `${Math.round(i.throttle * 100)}%`,
      thrust: `${i.thrustRatio.toFixed(2)} × 重量`,
      net,
      balance,
      tilt: `${Math.round((i.tilt * 180) / Math.PI)}°`,
      fillPct: Math.round(Math.min(1, Math.max(0, i.throttle)) * 1000) / 10,
      hoverPct: Math.round(i.hover * 1000) / 10,
    };
  }
}
