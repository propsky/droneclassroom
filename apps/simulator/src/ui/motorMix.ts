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
// 音色與音效圖取自 ShramkoGSFPV（MIT）：
// https://github.com/AndriiShramko/ShramkoGSFPV
//   apps/fly/src/audio/motor-sound.ts 的 voiceHarmonics、MotorSound（四顆馬達的諧波振盪器 + 帶通噪音）
// 我們沒有馬達模型：四顆馬達的負載改由這裡用飛機實際的移動推出來（MotorSound.loads）。

// 馬達聲的純計算：飛機怎麼動 → 四顆馬達的音高與音量。不碰 Web Audio、不碰 DOM，Node 測得到。

/** 飛機這一刻的移動，每項 -1..1（已除以參考速度）。 */
export interface Motion {
  /** 往機頭方向 + */
  forward: number;
  /** 往機身右方 + */
  right: number;
  /** 上升 + */
  climb: number;
  /** 左轉 + */
  turn: number;
}

export interface MotorMixInput {
  motion: Motion;
  /** 在空中、沒被凍結 */
  flying: boolean;
  enabled: boolean;
  paused: boolean;
  hidden: boolean;
}

export interface Voice {
  freq: number;
  gain: number;
}

export interface MotorMix {
  master: number;
  voices: Voice[];
  wash: { gain: number; freq: number };
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

export class MotorSound {
  /** 整體音量：比過圈音小一截，當背景。 */
  static readonly MASTER = 0.05;
  /** 懸停時的馬達負載 */
  static readonly HOVER = 0.5;
  /** 小型教學機（兩葉槳）：負載 0..1 對到轉速 120..400 轉/秒 */
  static readonly ROTOR_MIN_HZ = 120;
  static readonly ROTOR_MAX_HZ = 400;
  static readonly BLADES = 2;
  /** 水平、垂直速度的參考值（單位/秒）：60Hz × 推力 / (1 - 阻力) ≈ 9 */
  static readonly REF_SPEED = 9;
  /** 轉向參考角速度（弧度/秒） */
  static readonly REF_TURN = 2.5;

  /**
   * X 型四軸：前左、前右、後左、後右。
   * 上升四顆一起加；往前飛 = 機頭下壓 = 後面兩顆加；往右飛 = 左邊兩顆加；
   * 左轉 = 順時針那對（前右、後左）加。
   */
  static loads(m: Motion): number[] {
    const climb = 0.3 * m.climb;
    const pitch = 0.15 * m.forward;
    const roll = 0.15 * m.right;
    const yaw = 0.08 * m.turn;
    return [
      MotorSound.HOVER + climb - pitch + roll - yaw,
      MotorSound.HOVER + climb - pitch - roll + yaw,
      MotorSound.HOVER + climb + pitch + roll + yaw,
      MotorSound.HOVER + climb + pitch - roll - yaw,
    ].map((v) => clamp(v, 0.1, 1));
  }

  static rotorHz(load: number): number {
    return MotorSound.ROTOR_MIN_HZ + clamp(load, 0, 1) * (MotorSound.ROTOR_MAX_HZ - MotorSound.ROTOR_MIN_HZ);
  }

  static audible(i: MotorMixInput): boolean {
    return i.enabled && i.flying && !i.paused && !i.hidden;
  }

  static mix(i: MotorMixInput): MotorMix {
    const loads = MotorSound.loads(i.motion);
    const voices = loads.map((m) => ({ freq: MotorSound.rotorHz(m), gain: 0.18 * Math.pow(m, 0.8) }));
    const mean = loads.reduce((a, b) => a + b, 0) / loads.length;
    const air = clamp(Math.hypot(i.motion.forward, i.motion.right, i.motion.climb), 0, 1);
    return {
      master: MotorSound.audible(i) ? MotorSound.MASTER : 0,
      voices,
      wash: { gain: 0.45 * mean * mean + 0.25 * air * air, freq: clamp(400 + 2.2 * MotorSound.rotorHz(mean), 300, 6000) },
    };
  }

  /**
   * 一顆槳的諧波強度（index 1 = 基頻）：葉片通過頻率（兩葉槳 = 2 倍）與它的兩倍撐起音色，
   * 基頻本身一點低鳴，其他補滿。
   */
  static harmonics(blades: number): Float32Array {
    const n = blades * 2 + 2;
    const a = new Float32Array(n + 1);
    for (let k = 1; k <= n; k++) a[k] = 0.12 / k;
    a[1] = 0.35;
    a[blades] = 1;
    a[blades * 2] = 0.45;
    return a;
  }
}
