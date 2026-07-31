// G-04 跨引擎驗證的獨立進入點 — esbuild 打包成單檔後，
// 以 node 與 jsc（JavaScriptCore CLI）各跑一次，比對輸出 hash。
// 禁止任何 DOM / Node API；輸出走 print（jsc）或 console.log（node）。

/* eslint-disable no-var */
declare var print: ((s: string) => void) | undefined;

// jsc 舊版沒有 console → 補一個殼（core/events 的 console.error 會用到）
if (typeof console === 'undefined') {
  const p = (typeof print === 'function' ? print : (): void => undefined) as (
    ...a: unknown[]
  ) => void;
  (globalThis as Record<string, unknown>)['console'] = { log: p, warn: p, error: p };
}

import { runScenario } from './replay-scenario';

const emit: (s: string) => void =
  typeof print === 'function' ? print : (s) => console.log(s);

void runScenario().then(
  (r) => emit(`RESULT ${JSON.stringify(r)}`),
  (e) => emit(`ERROR ${String(e)}`),
);
