// 方向鍵轉向漸進：原本一按就是滿速轉，要對準有朝向的圈很難，點一下就轉過頭。
// 按下先給一部分，按住 0.25 秒（15 tick）才到滿速；放開或換方向就重來。
// 每 tick 算一次（collectControlFrame），結果寫進 ControlFrame.yawDelta，錄製存的是這個值，重播不受影響。

export class YawKeyRamp {
  /** 剛按下時的轉速比例：輕點（約 0.1 秒）轉 4～5°，原本約 10°，方便微調 */
  static readonly START = 0.35;
  /** 從 START 推到滿速要幾個 tick（60Hz：0.25 秒） */
  static readonly RAMP_TICKS = 15;

  private dir = 0;
  private held = 0;

  /** 這個 tick 的方向（+1 左轉、-1 右轉、0 沒按）→ 轉速倍率（帶正負號）。 */
  next(dir: number): number {
    const d = Math.sign(dir);
    if (d !== this.dir) {
      this.dir = d;
      this.held = 0;
    }
    if (d === 0) return 0;
    const k = Math.min(1, YawKeyRamp.START + ((1 - YawKeyRamp.START) * this.held) / YawKeyRamp.RAMP_TICKS);
    this.held++;
    return d * k;
  }

  reset(): void {
    this.dir = 0;
    this.held = 0;
  }
}
