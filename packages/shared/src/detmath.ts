// 確定性數學（G-04 跨環境 bit 級確定性的基礎）。
//
// 背景：IEEE-754 規定 + - * / sqrt 必須正確捨入 → 所有 JS 引擎 bit 一致；
// 但 Math.sin / Math.cos 等超越函數的實作由引擎自由發揮（V8 / JSC /
// SpiderMonkey 各不相同，同引擎不同版本也可能改實作），迭代模擬會把
// 最後一個 bit 的差異逐 tick 放大。這裡以 fdlibm（Sun 的參考實作，
// netlib.org/fdlibm）移植 sin / cos：整個計算只用 IEEE 保證的運算與
// 整數位元操作 → 任何引擎、任何平台結果 bit 相同。
//
// 適用範圍：|x| < 2^19·π/2（約 8.2e5 rad）走 fdlibm 三段 Cody-Waite 精確
// 縮減（模擬時間驅動的角度在連續上課數天內都遠低於此界）；超出時退回
// 「確定但精度較低」的樸素縮減 —— 仍然跨引擎一致，只是尾數精度下降。
//
// hypot：Math.hypot 演算法未被規格固定（引擎間不一致），以 sqrt(x²+y²)
// 重寫 —— 乘加與 sqrt 皆正確捨入，跨引擎一致；模擬座標量級（<10³）
// 無溢位/下溢疑慮，不需要 hypot 的縮放保護。

// ---- 位元操作（DataView 明確大端序 → 平台無關）----
const _buf = new ArrayBuffer(8);
const _dv = new DataView(_buf);

/** 取 double 的高 32 位元（含符號與指數） */
function hi32(x: number): number {
  _dv.setFloat64(0, x);
  return _dv.getUint32(0);
}

/** 以高/低 32 位元組出 double */
function fromWords(hi: number, lo: number): number {
  _dv.setUint32(0, hi >>> 0);
  _dv.setUint32(4, lo >>> 0);
  return _dv.getFloat64(0);
}

// ---- fdlibm __kernel_sin：|x| ≤ π/4，y 為 x 的尾差 ----
const S1 = -1.66666666666666324348e-1;
const S2 = 8.33333333332248946124e-3;
const S3 = -1.98412698298579493134e-4;
const S4 = 2.75573137070700676789e-6;
const S5 = -2.50507602534068634195e-8;
const S6 = 1.58969099521155010221e-10;

function kernelSin(x: number, y: number, iy: number): number {
  const ix = hi32(x) & 0x7fffffff;
  if (ix < 0x3e400000) {
    // |x| < 2^-27：一次多項式已不影響結果
    if (x === 0) return x;
  }
  const z = x * x;
  const v = z * x;
  const r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
  if (iy === 0) return x + v * (S1 + z * r);
  return x - (z * (0.5 * y - v * r) - y - v * S1);
}

// ---- fdlibm __kernel_cos：|x| ≤ π/4 ----
const C1 = 4.16666666666666019037e-2;
const C2 = -1.38888888888741095749e-3;
const C3 = 2.48015872894767294178e-5;
const C4 = -2.75573143513906633035e-7;
const C5 = 2.08757232129817482790e-9;
const C6 = -1.13596475577881948265e-11;

function kernelCos(x: number, y: number): number {
  const ix = hi32(x) & 0x7fffffff;
  if (ix < 0x3e400000) {
    // |x| < 2^-27
    return 1;
  }
  const z = x * x;
  const r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
  if (ix < 0x3fd33333) {
    // |x| < 0.3
    return 1 - (0.5 * z - (z * r - x * y));
  }
  const qx = ix > 0x3fe90000 ? 0.28125 : fromWords(ix - 0x00200000, 0);
  const hz = 0.5 * z - qx;
  const a = 1 - qx;
  return a - (hz - (z * r - x * y));
}

// ---- fdlibm __ieee754_rem_pio2 的中等引數分支（|x| < 2^19·π/2）----
const invpio2 = 6.36619772367581382433e-1; // 2/π
const pio2_1 = 1.57079632673412561417e0;
const pio2_1t = 6.07710050650619224932e-11;
const pio2_2 = 6.0771005063039659766e-11;
const pio2_2t = 2.02226624879595063154e-21;
const pio2_3 = 2.0222662487111664558e-21;
const pio2_3t = 8.47842766036889956997e-32;
const PIO4_HI = 0x3fe921fb; // π/4 的高位
const MEDIUM_HI = 0x413921fb; // 2^19·π/2 的高位

interface Rem {
  n: number;
  y0: number;
  y1: number;
}
const _rem: Rem = { n: 0, y0: 0, y1: 0 };

/** x → n·π/2 + (y0+y1)，回傳 n mod 4 與高精度餘數（結果寫入 _rem 避免配置） */
function remPio2(x: number): Rem {
  const ix = hi32(x) & 0x7fffffff;
  if (ix <= PIO4_HI) {
    // |x| ≤ π/4：不需縮減
    _rem.n = 0;
    _rem.y0 = x;
    _rem.y1 = 0;
    return _rem;
  }
  const t = Math.abs(x);
  if (ix < MEDIUM_HI) {
    // Cody-Waite 三段縮減（fdlibm 逐步補精度）
    const fn = Math.floor(t * invpio2 + 0.5); // 引數範圍內等價 (int)(t*invpio2+0.5)
    let r = t - fn * pio2_1;
    let w = fn * pio2_1t;
    let y0 = r - w;
    const j = ix >>> 20;
    let i = j - ((hi32(y0) >>> 20) & 0x7ff);
    if (i > 16) {
      // 第一段掉超過 16 bit 精度 → 用第二段 π/2 補
      const t2 = r;
      w = fn * pio2_2;
      r = t2 - w;
      w = fn * pio2_2t - (t2 - r - w);
      y0 = r - w;
      i = j - ((hi32(y0) >>> 20) & 0x7ff);
      if (i > 49) {
        // 還掉 → 第三段
        const t3 = r;
        w = fn * pio2_3;
        r = t3 - w;
        w = fn * pio2_3t - (t3 - r - w);
        y0 = r - w;
      }
    }
    const y1 = r - y0 - w;
    if (x < 0) {
      _rem.n = -fn & 3;
      _rem.y0 = -y0;
      _rem.y1 = -y1;
    } else {
      _rem.n = fn & 3;
      _rem.y0 = y0;
      _rem.y1 = y1;
    }
    return _rem;
  }
  // 超出中等範圍（>8.2e5 rad，正常模擬不會到）：樸素縮減 —— 精度降但仍確定
  const TWO_PI = 6.283185307179586;
  const k = Math.floor(t / TWO_PI);
  const rr = t - k * TWO_PI;
  const sub = remPio2(rr);
  if (x < 0) {
    _rem.n = -sub.n & 3;
    _rem.y0 = -sub.y0;
    _rem.y1 = -sub.y1;
  }
  return _rem;
}

/** 確定性 sin（fdlibm 精度：誤差 < 1 ulp；跨引擎 bit 一致） */
export function detSin(x: number): number {
  if (!Number.isFinite(x)) return NaN;
  const { n, y0, y1 } = remPio2(x);
  const iy = y1 === 0 ? 0 : 1; // 尾差為 0 走 fdlibm 快速路徑（運算樹與原版一致）
  switch (n) {
    case 0:
      return kernelSin(y0, y1, iy);
    case 1:
      return kernelCos(y0, y1);
    case 2:
      return -kernelSin(y0, y1, iy);
    default:
      return -kernelCos(y0, y1);
  }
}

/** 確定性 cos（同上） */
export function detCos(x: number): number {
  if (!Number.isFinite(x)) return NaN;
  const { n, y0, y1 } = remPio2(x);
  const iy = y1 === 0 ? 0 : 1;
  switch (n) {
    case 0:
      return kernelCos(y0, y1);
    case 1:
      return -kernelSin(y0, y1, iy);
    case 2:
      return -kernelCos(y0, y1);
    default:
      return kernelSin(y0, y1, iy);
  }
}

/** 確定性 2D 距離（取代 Math.hypot；乘加與 sqrt 皆 IEEE 正確捨入） */
export function detHypot2(x: number, y: number): number {
  return Math.sqrt(x * x + y * y);
}

/** 確定性 3D 距離 */
export function detHypot3(x: number, y: number, z: number): number {
  return Math.sqrt(x * x + y * y + z * z);
}
