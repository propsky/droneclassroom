// 畫畫教室固定鏡位的抬升。小誤差維持原本的緩動；落後多時加快，
// 手動滿舵爬升（終端約 11 m/s）才不會在 2-5 俯視裡把機身跟丟。
// 不改推力，關卡判定與其他章的手感維持原樣。

export class FixedCamLift {
  /** 與改動前 smooth 係數相同。誤差小時畫面跟以前一樣。 */
  static readonly BASE_GAIN = 0.08;
  /** 超過這個落後才加速跟上。 */
  static readonly CATCHUP_FROM_M = 0.35;
  static readonly MAX_GAIN = 0.5;

  static wanted(droneY: number, baseY: number, headroom: number): number {
    return Math.max(0, droneY - (baseY + headroom));
  }

  static step(current: number, droneY: number, baseY: number, headroom: number): number {
    const want = FixedCamLift.wanted(droneY, baseY, headroom);
    const err = want - current;
    const abs = Math.abs(err);
    const gain =
      abs > FixedCamLift.CATCHUP_FROM_M
        ? Math.min(FixedCamLift.MAX_GAIN, 0.22 + abs * 0.06)
        : FixedCamLift.BASE_GAIN;
    const next = current + err * gain;
    return Math.abs(want - next) < 1e-3 ? want : next;
  }
}
