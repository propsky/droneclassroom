// 模擬核心版本雜湊：前端（vite.config.ts）與伺服器驗證器（build-replay-verifier.mjs）共用。
// 涵蓋會影響重播結果的全部來源：simulator core、@creafly/shared、官方關卡 JSON。
// 刻意用 .mjs：Docker 建置階段沒有 tsx。
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const SOURCES = [
  { dir: 'apps/simulator/src/core', ext: '.ts' },
  { dir: 'packages/shared/src', ext: '.ts' },
  { dir: 'apps/simulator/public/levels', ext: '.json' },
];

function walk(dir, ext, out) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) walk(p, ext, out);
    else if (ent.name.endsWith(ext) && !ent.name.endsWith('.test.ts')) out.push(p);
  }
}

/** repoRoot = monorepo 根目錄；回傳 16 位 hex */
export function computeSimVersion(repoRoot) {
  const files = [];
  for (const s of SOURCES) walk(join(repoRoot, s.dir), s.ext, files);
  const rels = files.map((f) => relative(repoRoot, f).split('\\').join('/')).sort();
  const h = createHash('sha256');
  for (const rel of rels) {
    h.update(rel);
    h.update('\0');
    h.update(readFileSync(join(repoRoot, rel)));
    h.update('\0');
  }
  return h.digest('hex').slice(0, 16);
}
