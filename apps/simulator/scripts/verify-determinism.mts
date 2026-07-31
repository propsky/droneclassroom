// G-04 確定性 Gate 驗證：
//   1. detmath / PRNG 單元確定性（雜湊 10 萬點）
//   2. 完整回放場景：Node(V8) 重跑兩次 → hash 必須相同（同引擎可重現）
//   3. 跨引擎：同一 bundle 丟給 jsc（JavaScriptCore，= iPad Safari 的引擎）
//      → hash 必須與 Node 完全相同（bit 級跨引擎一致）
// 用法：pnpm --filter @creafly/simulator verify:determinism
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { detSin, detCos, mulberry32 } from '@creafly/shared';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '.cache');
const bundle = join(outDir, 'replay-bundle.js');

const JSC_PATHS = [
  '/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc',
  '/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc',
];

let failures = 0;
const ok = (label: string): void => console.log(`✓ ${label}`);
const bad = (label: string): void => {
  failures++;
  console.error(`✗ ${label}`);
};

// ---- 1. detmath / PRNG 單元確定性 ----
{
  let h = 0xcbf29ce484222325n;
  const P = 0x100000001b3n;
  const M = 0xffffffffffffffffn;
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  const mix = (x: number): void => {
    dv.setFloat64(0, x);
    for (let i = 0; i < 8; i++) h = ((h ^ BigInt(dv.getUint8(i))) * P) & M;
  };
  const rand = mulberry32(12345);
  for (let i = 0; i < 100_000; i++) {
    mix(detSin(i * 0.137 - 5000));
    mix(detCos(i * 0.211));
    mix(rand());
  }
  // 基準 hash：首次執行時記下，之後任何環境（含 CI / 不同 Node 版本）必須相同。
  const EXPECTED = '40c7939bfe9d7887';
  const got = h.toString(16);
  if (got === EXPECTED) ok(`detmath+PRNG 單元 hash 符合基準（${got}）`);
  else bad(`detmath+PRNG 單元 hash 不符：得到 ${got}，預期 ${EXPECTED}（若為首次建立基準，請更新 EXPECTED）`);
}

// ---- 2. 打包回放場景 ----
mkdirSync(outDir, { recursive: true });
await build({
  entryPoints: [join(here, 'replay-standalone.ts')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  outfile: bundle,
  logLevel: 'silent',
});
ok('回放場景 bundle 完成（esbuild，單檔零依賴）');

interface Result {
  manualHash: string;
  programHash: string;
  ticks: number;
  ringsCollected: number;
  programFinished: boolean;
}

function runBundle(cmd: string, args: string[]): Result {
  const out = execFileSync(cmd, args, { encoding: 'utf-8', timeout: 120_000 });
  const line = out.split('\n').find((l) => l.startsWith('RESULT '));
  if (!line) throw new Error(`無 RESULT 輸出：${out.slice(0, 500)}`);
  return JSON.parse(line.slice(7)) as Result;
}

// ---- 3. Node 重跑兩次（同引擎可重現）----
const n1 = runBundle(process.execPath, [bundle]);
const n2 = runBundle(process.execPath, [bundle]);
if (!n1.programFinished) bad('程式段未在限時內結束');
if (n1.ringsCollected < 1) bad(`場景應至少穿過 1 圈（實際 ${n1.ringsCollected}）`);
if (n1.manualHash === n2.manualHash && n1.programHash === n2.programHash) {
  ok(`Node 重跑一致：manual=${n1.manualHash} program=${n1.programHash}（${n1.ticks} ticks, 圈 ${n1.ringsCollected}/3）`);
} else {
  bad(`Node 重跑不一致：${JSON.stringify(n1)} vs ${JSON.stringify(n2)}`);
}

// ---- 4. 跨引擎：JavaScriptCore（iPad Safari 的 JS 引擎）----
const jsc = JSC_PATHS.find((p) => existsSync(p));
if (!jsc) {
  console.warn('⚠ 本機找不到 jsc（非 macOS？）— 跨引擎比對跳過，僅完成同引擎驗證');
} else {
  const j = runBundle(jsc, [bundle]);
  if (j.manualHash === n1.manualHash && j.programHash === n1.programHash) {
    ok(`跨引擎 bit 級一致：V8(Node) ≡ JavaScriptCore(jsc)（manual=${j.manualHash} program=${j.programHash}）`);
  } else {
    bad(
      `跨引擎不一致！V8: manual=${n1.manualHash} program=${n1.programHash} ｜ JSC: manual=${j.manualHash} program=${j.programHash}`,
    );
  }
}

console.log(failures === 0 ? '\n✅ G-04 確定性驗證全部通過' : `\n❌ ${failures} 項失敗`);
process.exit(failures === 0 ? 0 : 1);
