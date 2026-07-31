// 可播種 PRNG（G-04 確定性）— mulberry32：只用 32 位整數運算
// （Math.imul / 位移 / 無號右移，皆為規格強制確定），跨引擎 bit 一致。
// 品質對遊戲用途綽綽有餘（週期 2^32，通過 gjrand 基本測試）。

/** 回傳 [0,1) 均勻亂數產生器；同 seed 必產生同序列（任何引擎） */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
