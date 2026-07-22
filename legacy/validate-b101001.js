// B-101-001 fix validation — verify no console errors after fix
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = 'http://localhost:3000/';

console.log('=== B-101-001 fix validation ===\n');

function runChrome(url, waitMs = 5000) {
    const args = [
        '--headless',
        '--disable-gpu',
        '--no-sandbox',
        '--hide-scrollbars',
        '--window-size=1280,800',
        `--virtual-time-budget=${waitMs}`,
        '--enable-logging=stderr',
        '--v=0',
        url,
    ];
    const result = spawnSync(CHROME, args, { encoding: 'utf8', timeout: 30000 });
    const stderr = result.stderr || '';
    const errorLines = stderr.split('\n').filter(line =>
        /CONSOLE\(.*\).*(error|ERROR|Uncaught)/.test(line) ||
        /Uncaught Error/.test(line) ||
        /\[error\]/.test(line)
    );
    return { exitCode: result.status, errors: errorLines };
}

const tests = [
    { name: 'Default load', url: URL + '?mode=manual', wait: 5000 },
    { name: 'Program mode + autorun', url: URL + '?mode=program&autorun', wait: 6000 },
    { name: 'Level 1-5 + program', url: URL + '?mode=program', wait: 5000 },
];

let totalErrors = 0;
for (const t of tests) {
    const r = runChrome(t.url, t.wait);
    console.log(`Test: ${t.name}`);
    console.log(`  exit=${r.exitCode}, errors=${r.errors.length}`);
    if (r.errors.length) r.errors.forEach(e => console.log('    ERR: ' + e.substring(0, 200)));
    totalErrors += r.errors.length;
}
console.log(`\n=== Result: ${totalErrors} error(s) across ${tests.length} tests ===`);
process.exit(totalErrors === 0 ? 0 : 1);