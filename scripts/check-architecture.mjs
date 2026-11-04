#!/usr/bin/env node
// 架構檢查（CI 擋關用，純 Node、零依賴）：
//   1. apps/simulator/src/core 是框架無關純 TS：不 import Babylon / Blockly、不 import core 以外的前端模組
//   2. core 不直接碰 DOM（document / window / localStorage / sessionStorage / navigator / location）
//   3. packages/shared 零 runtime 依賴
// 違規印出「檔案:行 規則」並 exit 1。用法：pnpm check:arch
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const coreDir = join(root, 'apps/simulator/src/core');

// 既有例外：都只在瀏覽器載入關卡的路徑上，伺服器重播（bootstrapLevelForReplay）不經過。
// 新增例外前先想清楚為什麼不能改走 event bus 或由呼叫端注入。
const ALLOWED_IMPORTS = new Map([
  // 老師 iframe 預覽：從 sessionStorage 讀關卡
  ['core/level.ts', new Set(['../preview', '../net/levelLoad'])],
]);
const ALLOWED_DOM = new Map([
  // 初次載入讀網址 ?level=
  ['core/level.ts', new Set(['location'])],
]);

const FORBIDDEN_PACKAGES = [/^@babylonjs\//, /^blockly(\/|$)/];
const DOM_GLOBALS = ['document', 'window', 'localStorage', 'sessionStorage', 'navigator', 'location'];

const violations = [];
const report = (file, line, rule) => violations.push(`${relative(root, file)}:${line}  ${rule}`);

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

/** 去掉註解但保留行數（字串裡的 // 不當註解；不處理樣板字串內嵌運算式，core 夠用） */
function stripComments(src) {
  let out = '';
  let i = 0;
  let quote = null;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (quote) {
      out += c;
      if (c === '\\') {
        out += n ?? '';
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      i++;
    } else if (c === '/' && n === '/') {
      while (i < src.length && src[i] !== '\n') i++;
    } else if (c === '/' && n === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') out += '\n';
        i++;
      }
      i += 2;
    } else {
      if (c === "'" || c === '"' || c === '`') quote = c;
      out += c;
      i++;
    }
  }
  return out;
}

const IMPORT_RE = /(?:\bfrom\s*|\bimport\s*\(\s*|^\s*import\s+)(['"])([^'"]+)\1/g;

for (const file of walk(coreDir)) {
  const key = relative(join(root, 'apps/simulator/src'), file).split(sep).join('/');
  const lines = stripComments(readFileSync(file, 'utf-8')).split('\n');
  lines.forEach((text, idx) => {
    const line = idx + 1;
    for (const m of text.matchAll(IMPORT_RE)) {
      const spec = m[2];
      if (spec.startsWith('.')) {
        const target = resolve(dirname(file), spec);
        const insideCore = target === coreDir || target.startsWith(coreDir + sep);
        if (!insideCore && !ALLOWED_IMPORTS.get(key)?.has(spec)) {
          report(file, line, `core 不得 import core 以外的前端模組：'${spec}'（render / ui / input 請訂閱 core/events）`);
        }
      } else if (FORBIDDEN_PACKAGES.some((re) => re.test(spec))) {
        report(file, line, `core 不得 import '${spec}'（core 要能在 Node 跑伺服器重播）`);
      }
    }
    for (const g of DOM_GLOBALS) {
      const re = new RegExp(`(?<![\\w.$'"])${g}\\b(?!\\s*:)`, 'g');
      for (const hit of text.matchAll(re)) {
        // `typeof location` 這類防護式用法允許
        if (/typeof\s+$/.test(text.slice(0, hit.index))) continue;
        if (ALLOWED_DOM.get(key)?.has(g)) continue;
        report(file, line, `core 不得直接使用 DOM 全域 ${g}（由 ui 傳進來，或先 typeof 防護）`);
      }
    }
  });
}

const sharedPkg = JSON.parse(readFileSync(join(root, 'packages/shared/package.json'), 'utf-8'));
for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
  const deps = Object.keys(sharedPkg[field] ?? {});
  if (deps.length > 0) {
    report(join(root, 'packages/shared/package.json'), 1, `@creafly/shared 必須零 runtime 依賴，${field} 有：${deps.join(', ')}`);
  }
}

if (violations.length > 0) {
  console.error(`✗ 架構檢查 ${violations.length} 項違規：\n${violations.map((v) => `  ${v}`).join('\n')}`);
  process.exit(1);
}
console.log('✓ 架構檢查通過（core 無 Babylon / DOM / 外部前端模組；shared 零 runtime 依賴）');
