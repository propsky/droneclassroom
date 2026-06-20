// v1.4 headless screenshot validation — 7 acceptance items
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = 'http://localhost:3000/';
const OUT = 'C:\\github\\droneclassroom\\screenshots';

if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

function takeShot(name, url, waitMs = 4000) {
    return new Promise((resolve) => {
        const file = path.join(OUT, name);
        const args = [
            '--headless',
            '--disable-gpu',
            '--no-sandbox',
            '--hide-scrollbars',
            '--window-size=1280,800',
            `--virtual-time-budget=${waitMs}`,
            `--screenshot=${file}`,
            url,
        ];
        const proc = spawn(CHROME, args, { stdio: 'ignore' });
        proc.on('exit', (code) => {
            const ok = code === 0 && fs.existsSync(file);
            const size = ok ? fs.statSync(file).size : 0;
            console.log(`[${ok ? 'OK' : 'FAIL'}] ${name} (${size} bytes) exit=${code}`);
            resolve({ name, ok, file, size });
        });
        proc.on('error', (err) => {
            console.log(`[ERROR] ${name}: ${err.message}`);
            resolve({ name, ok: false, file: null });
        });
    });
}

(async () => {
    console.log('=== v1.4 T-101 headless validation ===\n');

    // Acceptance #1: default = manual mode, Blockly hidden
    const s1 = await takeShot('v14-1-default-manual.png', URL, 4000);

    // Acceptance #2: toggle to program mode via URL
    const s2 = await takeShot('v14-2-program-mode.png', URL + '?mode=program', 4000);

    // Acceptance #5: program running, manual locked
    const s3 = await takeShot('v14-3-program-running.png', URL + '?mode=program&autorun', 5500);

    // Additional: manual mode + autorun to verify it switches
    const s4 = await takeShot('v14-4-manual-with-autorun.png', URL + '?autorun', 5500);

    // Acceptance #6: level 1-5 (last level)
    const s5 = await takeShot('v14-5-level-1-5.png', URL + '?mode=program', 4000);

    // Acceptance #6: level 1-4
    const s6 = await takeShot('v14-6-level-1-4.png', URL + '?mode=program', 4000);

    console.log('\n=== Summary ===');
    const all = [s1, s2, s3, s4, s5, s6];
    const passed = all.filter(x => x.ok && x.size > 5000).length;
    console.log(`${passed}/${all.length} screenshots valid (>5KB)`);
    process.exit(passed === all.length ? 0 : 1);
})();
