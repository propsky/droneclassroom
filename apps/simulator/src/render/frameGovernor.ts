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
//   packages/render-pc/src/governor.ts 的 DisplayPeriod、FrameGovernor
// 只保留「掉幀就降解析度、穩了再慢慢升回來」；潑濺預算、延遲守衛、串流例外沒有搬。

/**
 * 畫質自動調整：舊電腦、iPad 跑不動時降低渲染解析度，順了再慢慢升回來。
 * 純邏輯，只吃畫面時間戳（ms），不碰引擎、不碰 DOM，Node 測得到。
 * 只影響畫面，不影響 60Hz 物理與判定（物理用固定 timestep，跟畫面張數無關）。
 */

/** 一張畫面的間隔超過幾個螢幕週期算掉幀（60Hz 螢幕上 33ms 的間隔 = 掉了一張）。 */
export const MISSED_PERIODS = 1.25;

/** 學到螢幕週期之前不判斷（30Hz 螢幕約 2 秒）。 */
export const PERIOD_MIN_SAMPLES = 60;

/** 每一級的渲染比例（1 = 原生解析度；0.5 = 長寬各一半）。 */
export const RENDER_SCALES: readonly number[] = [1, 0.85, 0.7, 0.6, 0.5];

export interface GovernorOptions {
  /** 往回看多久決定要不要降一級（ms） */
  downWindowMs: number;
  /** 這段時間掉幀超過這個比例就降 */
  downMissRatio: number;
  /** 穩定這麼久才升一級（ms） */
  upWindowMs: number;
  /** 期間掉幀不超過這個比例才升 */
  upMissRatio: number;
  periodMinSamples?: number;
}

export const DEFAULT_GOVERNOR: GovernorOptions = {
  downWindowMs: 1000,
  downMissRatio: 0.1,
  upWindowMs: 5000,
  upMissRatio: 0.01,
};

/**
 * 從畫面間隔學螢幕週期：最近 30 秒的第 5 百分位數。
 * 30Hz 的螢幕本來就是 33ms 一張，不算慢；只看最短的那些間隔，掉一半幀也還學得到 16.7ms。
 */
export class DisplayPeriod {
  private dts: { t: number; dt: number }[] = [];
  private sinceSort = 0;
  ms = Infinity;

  constructor(private readonly minSamples = PERIOD_MIN_SAMPLES) {}

  get learned(): boolean {
    return this.dts.length >= this.minSamples;
  }

  add(t: number, dt: number): void {
    this.dts.push({ t, dt });
    while (this.dts.length && t - this.dts[0]!.t > 30000) this.dts.shift();
    // 學習中每張都重排（樣本少），學會之後每 30 張排一次
    if (this.ms === Infinity || !this.learned || ++this.sinceSort >= 30) {
      this.sinceSort = 0;
      const s = this.dts.map((x) => x.dt).sort((a, b) => a - b);
      this.ms = s[Math.floor(0.05 * (s.length - 1))]!;
    }
  }
}

export class FrameGovernor {
  enabled = true;
  step = 0;
  /** 換過幾次級（?fps=1 看得到） */
  changes = 0;
  private last = -1;
  private readonly period: DisplayPeriod;
  private log: { t: number; missed: boolean }[] = [];
  private lastChange = -Infinity;
  private judging = false;

  constructor(
    readonly scales: readonly number[] = RENDER_SCALES,
    readonly opts: GovernorOptions = DEFAULT_GOVERNOR,
  ) {
    this.period = new DisplayPeriod(opts.periodMinSamples ?? PERIOD_MIN_SAMPLES);
  }

  /** `?governor=0` 關掉（量效能、截圖比對時用）。 */
  static enabledBy(search: string): boolean {
    return new URLSearchParams(search).get('governor') !== '0';
  }

  get renderScale(): number {
    return this.scales[this.step]!;
  }

  get displayPeriodMs(): number {
    return this.period.ms;
  }

  /** 每張畫面餵一次時間戳（ms）。換級時回傳新的渲染比例，否則 null。 */
  onFrame(t: number): number | null {
    if (this.last < 0) {
      this.last = t;
      return null;
    }
    const dt = t - this.last;
    this.last = t;
    if (dt <= 0 || dt > 1000) return null; // 分頁切走、除錯中斷：不是幀率訊號
    this.period.add(t, dt);
    if (!this.period.learned) return null;
    // 第一張被判斷的畫面當成剛換過級：比例要滿一整個視窗才算數
    if (!this.judging) {
      this.judging = true;
      this.lastChange = t;
    }
    const missed = dt > MISSED_PERIODS * this.period.ms;
    this.log.push({ t, missed });
    while (this.log.length && t - this.log[0]!.t > this.opts.upWindowMs) this.log.shift();
    if (!this.enabled) return null;

    const since = t - this.lastChange;
    const ratio = (win: number): number => {
      let n = 0;
      let m = 0;
      for (let i = this.log.length - 1; i >= 0 && t - this.log[i]!.t <= win; i--) {
        n++;
        if (this.log[i]!.missed) m++;
      }
      return n ? m / n : 0;
    };
    if (
      since >= this.opts.downWindowMs &&
      this.step < this.scales.length - 1 &&
      ratio(this.opts.downWindowMs) > this.opts.downMissRatio
    ) {
      this.step++;
      this.lastChange = t;
      this.changes++;
      return this.renderScale;
    }
    if (since >= this.opts.upWindowMs && this.step > 0 && ratio(this.opts.upWindowMs) <= this.opts.upMissRatio) {
      this.step--;
      this.lastChange = t;
      this.changes++;
      return this.renderScale;
    }
    return null;
  }
}
