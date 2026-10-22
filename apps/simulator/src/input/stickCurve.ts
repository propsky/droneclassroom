// MIT License
//
// Copyright (c) 2026 Andrii Shramko
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
//
// 演算法取自 ShramkoGSFPV（MIT）：
// https://github.com/AndriiShramko/ShramkoGSFPV
//   packages/sim-core/src/rates.ts 的 BETAFLIGHT rawRate
//   packages/input/src/calib.ts 的 applyDeadband
// 公式由 ShramkoGSFPV 自 Betaflight 4.5.1（src/main/fc/rc.c，GPL-3.0）重寫。
// 本檔只沿用該 MIT 重寫，未複製 Betaflight GPL 原始碼。
// 此處改寫成純靜態方法，並只保留偏航用得到的 BETAFLIGHT 曲線與死區縮放。

/**
 * 搖桿曲線與死區。純函式、無時間、無亂數，同一輸入永遠得到同一輸出。
 * 偏航曲線在組成 ControlFrame 之前套用，錄製下來的是已經成形的 yawDelta。
 */
export class StickCurve {
  /** Betaflight rc rate > 2.0 時的增量係數（ShramkoGSFPV 自 4.5.1 重寫）。 */
  static readonly RC_RATE_INCREMENTAL = 14.54;

  /**
   * 偏航曲線固定用 rc rate 100、super rate 0：只留 expo 把中段壓軟，
   * 滿舵的 rawRate 不隨 expo 改變，正規化後仍是 ±1。
   */
  static readonly YAW_RC_RATE = 100;
  static readonly YAW_SUPER_RATE = 0;

  static clamp(v: number, lo: number, hi: number): number {
    return v < lo ? lo : v > hi ? hi : v;
  }

  /**
   * BETAFLIGHT raw rate，單位 deg/s。搖桿 x ∈ [-1, 1]；
   * rcRate / superRate / expo 是 Betaflight CLI 的整數（R / S / E）。
   */
  static rawRate(x: number, rcRate: number, superRate: number, expo: number): number {
    const a = x < 0 ? -x : x;
    let x1 = x;
    if (expo !== 0) {
      const e = expo / 100;
      x1 = x * (a * a * a) * e + x * (1 - e);
    }
    let r = rcRate / 100;
    if (r > 2) r += StickCurve.RC_RATE_INCREMENTAL * (r - 2);
    let w = 200 * r * x1;
    if (superRate !== 0) {
      w *= 1 / StickCurve.clamp(1 - a * (superRate / 100), 0.01, 1);
    }
    return w;
  }

  /**
   * 偏航搖桿成形。expo ≤ 0 直接回傳 x（與原本線性手感同一數值）。
   * expo > 0 走 rawRate，再除以滿舵 rawRate，所以 |x| = 1 仍得到 ±1。
   */
  static shapeYawStick(x: number, expo: number): number {
    if (!(expo > 0)) return x;
    const full = StickCurve.rawRate(1, StickCurve.YAW_RC_RATE, StickCurve.YAW_SUPER_RATE, expo);
    if (full === 0) return 0;
    const y = StickCurve.rawRate(x, StickCurve.YAW_RC_RATE, StickCurve.YAW_SUPER_RATE, expo) / full;
    return StickCurve.clamp(y, -1, 1);
  }

  /**
   * 扣除死區後把剩餘行程縮回 [-1, 1]。
   * 死區內（含邊界）為 0；死區外連續；滿舵仍為 ±1。
   * db ≤ 0 不處理。db ≥ 1 整段視為死區，回 0（避免除以 0）。
   */
  static applyDeadband(x: number, db: number): number {
    if (!(db > 0)) return x;
    if (db >= 1) return 0;
    const m = Math.abs(x);
    if (m <= db) return 0;
    const y = (m - db) / (1 - db);
    return x < 0 ? -y : y;
  }
}
