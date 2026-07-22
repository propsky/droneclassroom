// T-104 validation — 6 levels x 2 modes = 12 cases
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = 'http://localhost:3000/';
const OUT = 'C:\\github\\droneclassroom\\screenshots';

if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

function takeShot(name, url, waitMs = 4500) {
    return new Promise((resolve) => {
        const file = path.join(OUT, name);
        const args = [
            '--headless', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
            '--window-size=1280,800', `--virtual-time-budget=${waitMs}`,
            `--screenshot=${file}`, url,
        ];
        const proc = spawn(CHROME, args, { stdio: 'ignore' });
        proc.on('exit', (code) => {
            const ok = code === 0 && fs.existsSync(file);
            const size = ok ? fs.statSync(file).size : 0;
            console.log(`[${ok ? 'OK' : 'FAIL'}] ${name} (${size}B)`);
            resolve({ name, ok, file, size });
        });
        proc.on('error', (err) => {
            console.log(`[ERROR] ${name}: ${err.message}`);
            resolve({ name, ok: false });
        });
    });
}

(async () => {
    console.log('=== T-104: 6 levels x 2 modes = 12 cases ===\n');
    const levels = ['1-0', '1-1', '1-2', '1-3', '1-4', '1-5'];
    const results = [];
    for (const lv of levels) {
        results.push(await takeShot(`t104-${lv}-manual.png`, `${BASE}?level=${lv}&mode=manual`, 4500));
        results.push(await takeShot(`t104-${lv}-program.png`, `${BASE}?level=${lv}&mode=program`, 5000));
    }
    const passed = results.filter(x => x.ok && x.size > 5000).length;
    console.log(`\n=== ${passed}/${results.length} screenshots valid ===`);
    process.exit(passed === results.length ? 0 : 1);
})();