// T-103 headless validation — 4 categories of advanced blocks
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
            resolve({ name, ok: false });
        });
    });
}

(async () => {
    console.log('=== T-103 headless validation ===\n');

    // 1. Default manual
    const s1 = await takeShot('t103-1-default-manual.png', URL, 4000);

    // 2. Program mode — toolbox should show 7 categories
    const s2 = await takeShot('t103-2-program-4cat.png', URL + '?mode=program', 5000);

    // 3. Run starter (which uses T-102 blocks; new T-103 blocks visible in toolbox)
    const s3 = await takeShot('t103-3-starter-running.png', URL + '?mode=program&autorun', 4000);

    // 4. Level 1-5 with program
    const s4 = await takeShot('t103-4-level-1-5.png', URL + '?mode=program', 5000);

    console.log('\n=== Summary ===');
    const all = [s1, s2, s3, s4];
    const passed = all.filter(x => x.ok && x.size > 5000).length;
    console.log(`${passed}/${all.length} screenshots valid (>5KB)`);
    process.exit(passed === all.length ? 0 : 1);
})();