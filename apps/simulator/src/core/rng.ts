// 模擬用亂數單一入口（G-04 確定性）。
// 預設以牆鐘播種（一般遊玩體驗與 Math.random 無異）；
// 回放 / 驗證時 seedRng(固定值) → 亂數序列完全可重現。
import { mulberry32 } from '@creafly/shared';

let rand = mulberry32(Date.now() >>> 0);

/** 重新播種（回放 / 確定性驗證用；一般遊玩不需呼叫） */
export function seedRng(seed: number): void {
  rand = mulberry32(seed);
}

/** [0,1) 亂數 — core 內一律用這個，不准直接用 Math.random */
export function rng(): number {
  return rand();
}
