// J-02 伺服器重播驗證器打包：verify-recording.mts → 單檔 ESM，後端以 `node <檔>` 執行。
// 依賴圖只有 core/ + @creafly/shared（零 npm 依賴），故 Docker 建置階段只需 node + esbuild，
// 不必 pnpm install 整個 simulator（Babylon / Blockly）。
// 刻意用 .mjs 而非 .mts：Docker 建置階段沒有 tsx。
// 用法：node scripts/build-replay-verifier.mjs [輸出檔]
import { build } from 'esbuild';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeSimVersion } from './simVersion.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const outfile = resolve(process.argv[2] ?? join(here, '.cache', 'verify-recording.mjs'));
const simVersion = computeSimVersion(repoRoot);

await build({
  entryPoints: [join(here, 'verify-recording.mts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile,
  // Docker 建置階段沒有 pnpm workspace 的 node_modules 連結，直接指向原始碼
  alias: { '@creafly/shared': join(repoRoot, 'packages', 'shared', 'src') },
  define: { __CREAFLY_SIM_VERSION__: JSON.stringify(simVersion) },
  logLevel: 'warning',
});
console.log(`重播驗證器 bundle（simVersion ${simVersion}）→ ${outfile}`);
