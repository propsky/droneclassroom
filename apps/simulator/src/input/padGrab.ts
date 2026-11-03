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
//   apps/fly/src/play/touch-map.ts 的 PadGrab、padTravel、reachOf
// 改成靜態方法與我們的命名；行為不變。

/**
 * 觸控搖桿的「相對拖曳」。純函式，Node 測得到。
 *
 * 舊做法（nipplejs static）：圓盤中心就是搖桿中心，手指一按下沒對準中心，
 * 就是一次瞬間打桿；iPad 上起飛常常一碰就往旁邊飄。
 * 這裡跟遙控器一樣：按下去的那一點保持搖桿現在的值（放開彈回 0 的軸 = 按下的點就是中心），
 * 從那裡開始，手指移動多少像素，搖桿就動多少，推到圓盤半徑扣掉搖桿頭時是滿舵。
 *
 * 螢幕邊緣：手指按在圓盤外緣時，往螢幕邊那一側可能不夠推滿。
 * 那一側就改成「手指到螢幕邊（留 8px）= 滿舵」，保證一定推得到底，按下去的瞬間仍然不動。
 */

export interface Reach {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** 單一軸：按下時手指座標、當時的搖桿值、到 +1 與到 -1 各要多少像素。 */
interface Axis {
  at: number;
  v: number;
  toMax: number;
  toMin: number;
  dir: 1 | -1;
}

const clamp1 = (v: number): number => (v < -1 ? -1 : v > 1 ? 1 : v);

/** 一側最少也給這麼多像素（螢幕邊比這還近：手指其實按在圓盤外）。 */
const MIN_SIDE_PX = 8;

/**
 * `dir` +1：座標變大搖桿變大（x，往右）；-1：座標變小搖桿變大（y，往上）。
 * `low` / `high`：這一軸手指搆得到的範圍。
 */
function grabAxis(at: number, v: number, travel: number, low: number, high: number, dir: 1 | -1): Axis {
  const side = (need: number, room: number): number =>
    need <= 0 ? 0 : Math.max(Math.min(need, room), Math.min(need, MIN_SIDE_PX));
  const roomUp = dir > 0 ? high - at : at - low;
  const roomDown = dir > 0 ? at - low : high - at;
  return { at, v, dir, toMax: side((1 - v) * travel, roomUp), toMin: side((1 + v) * travel, roomDown) };
}

function readAxis(a: Axis, p: number): number {
  const u = (p - a.at) * a.dir;
  if (u >= 0) return a.toMax > 0 ? a.v + (1 - a.v) * Math.min(1, u / a.toMax) : a.v;
  return a.toMin > 0 ? a.v - (1 + a.v) * Math.min(1, -u / a.toMin) : a.v;
}

/** 一根手指在一個圓盤上。 */
export class PadGrab {
  /** 搖桿頭半徑：滿舵距離 = 圓盤半徑扣掉它。 */
  static readonly KNOB_HALF_PX = 24;
  /** 拇指碰得到的位置離螢幕邊大約這麼遠。 */
  static readonly SCREEN_EDGE_PX = 8;

  /** 寬 `widthPx` 的圓盤，推到滿舵要移動幾像素。 */
  static travel(widthPx: number): number {
    return Math.max(8, widthPx / 2 - PadGrab.KNOB_HALF_PX);
  }

  /** `w`×`h` 的視窗裡手指搆得到的範圍。 */
  static reachOf(w: number, h: number): Reach {
    const e = PadGrab.SCREEN_EDGE_PX;
    return { left: e, top: e, right: w - e, bottom: h - e };
  }

  private x: Axis = { at: 0, v: 0, toMax: 1, toMin: 1, dir: 1 };
  private y: Axis = { at: 0, v: 0, toMax: 1, toMin: 1, dir: -1 };

  /** 在 (px, py) 按下、搖桿當時在 (curX, curY)（-1..1，y 往上為正）：這個值留在手指底下。 */
  grab(px: number, py: number, curX: number, curY: number, travel: number, reach: Reach): void {
    this.x = grabAxis(px, clamp1(curX), travel, reach.left, reach.right, 1);
    this.y = grabAxis(py, clamp1(curY), travel, reach.top, reach.bottom, -1);
  }

  /** 手指在 (px, py) 時的搖桿值 [x 往右, y 往上]，各 -1..1（兩軸各自算，像遙控器的方形搖桿）。 */
  read(px: number, py: number): [number, number] {
    return [readAxis(this.x, px), readAxis(this.y, py)];
  }
}
