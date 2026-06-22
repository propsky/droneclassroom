// =============================================================================
// CREAFLY Drone Simulator — 改造自 eccc20984/drone-simulator (MIT)
// 主要差異：
//   1. CREAFLY 風格無人機外觀（青綠配色 + LED + landing gear）
//   2. 整合 Google Blockly 視覺化程式控制
//   3. 動作 API 序列執行（async/await 動作系統）
//   4. 任務系統（穿過三個圈 + 計時 + HUD）
//   5. 手動控制（鍵盤 + 滑鼠）與程式控制互斥
// =============================================================================

import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

// =============================================================================
// 1. Three.js scene 初始化
// =============================================================================
const sceneCanvas = document.getElementById('scene-canvas');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87CEEB);   // 後備純色天空（HDRI 載入失敗時保留）
scene.fog = new THREE.FogExp2(0xB0DFFF, 0.008);

// 遠景真實感：載入 CC0 HDRI 天空盒當背景（素材來源見 docs/ATTRIBUTIONS.md）
// 失敗（離線 / 載入錯誤）時靜默維持上面的純色天空，不影響遊戲。
new RGBELoader().load(
    'assets/env/pretoria_gardens_1k.hdr',
    (texture) => {
        texture.mapping = THREE.EquirectangularReflectionMapping;
        scene.background = texture;
        scene.backgroundBlurriness = 0.04;  // 稍微柔化，遠景不搶戲
        scene.environment = texture;          // 給標準材質一點環境反射（Phong 不受影響）
    },
    undefined,
    (err) => console.warn('HDRI 天空載入失敗，維持純色天空：', err)
);

const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
camera.position.set(0, 15, 30);

const renderer = new THREE.WebGLRenderer({
    canvas: sceneCanvas,
    antialias: true
});
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setClearColor(0x87CEEB);

// =============================================================================
// 2. 燈光
// =============================================================================
scene.add(new THREE.AmbientLight(0xffffff, 0.55));

const sunLight = new THREE.DirectionalLight(0xffffff, 1.0);
sunLight.position.set(30, 50, 20);
sunLight.castShadow = true;
sunLight.shadow.mapSize.width = 1024;
sunLight.shadow.mapSize.height = 1024;
sunLight.shadow.camera.left = -50;
sunLight.shadow.camera.right = 50;
sunLight.shadow.camera.top = 50;
sunLight.shadow.camera.bottom = -50;
scene.add(sunLight);

const fillLight = new THREE.DirectionalLight(0x99CCFF, 0.3);
fillLight.position.set(-20, 10, -10);
scene.add(fillLight);

// =============================================================================
// 3. CREAFLY 風格無人機模型
// =============================================================================
// CREAFLY 配色
const COLOR = {
    primary: 0x00A3E0,   // 青色主體
    accent:  0x1B998B,   // 綠色點綴
    yellow:  0xFFCE00,   // 警示黃
    dark:    0x0A2540,   // 深藍細節
    white:   0xFFFFFF,
    ledGreen: 0x00FF66,
    ledRed:   0xFF3355,
};

function buildCreaFlyDrone() {
    const drone = new THREE.Group();

    // 中央主體（白色 + 青色頂蓋）
    const lowerBody = new THREE.Mesh(
        new THREE.BoxGeometry(2.4, 0.5, 2.4),
        new THREE.MeshPhongMaterial({ color: COLOR.white, shininess: 60 })
    );
    lowerBody.position.y = 0;
    lowerBody.castShadow = true;
    drone.add(lowerBody);

    const upperBody = new THREE.Mesh(
        new THREE.BoxGeometry(2.0, 0.3, 2.0),
        new THREE.MeshPhongMaterial({ color: COLOR.primary, shininess: 80 })
    );
    upperBody.position.y = 0.4;
    upperBody.castShadow = true;
    drone.add(upperBody);

    // CREAFLY 標誌方塊（綠色 logo 點綴）
    const logoBlock = new THREE.Mesh(
        new THREE.BoxGeometry(0.8, 0.15, 0.8),
        new THREE.MeshPhongMaterial({ color: COLOR.accent, shininess: 90 })
    );
    logoBlock.position.set(0, 0.62, 0);
    drone.add(logoBlock);

    // 4 個圓角馬達罩（X 形配置）
    const armLength = 1.6;
    const motorPositions = [
        { x:  armLength, z:  armLength },   // 前右
        { x: -armLength, z:  armLength },   // 前左
        { x:  armLength, z: -armLength },   // 後右
        { x: -armLength, z: -armLength },   // 後左
    ];

    const propellers = [];
    motorPositions.forEach((mp, i) => {
        // 機臂（從中央到馬達的支架）
        const armDir = new THREE.Vector3(mp.x, 0, mp.z).normalize();
        const arm = new THREE.Mesh(
            new THREE.BoxGeometry(0.18, 0.12, 1.0),
            new THREE.MeshPhongMaterial({ color: COLOR.dark })
        );
        // 旋轉臂使其沿徑向指向馬達
        const armLen = Math.hypot(mp.x, mp.z);
        arm.scale.z = armLen * 0.7;
        arm.position.set(mp.x * 0.5, 0.0, mp.z * 0.5);
        arm.lookAt(new THREE.Vector3(mp.x, 0, mp.z));
        arm.castShadow = true;
        drone.add(arm);

        // 馬達座（圓柱）
        const motorBase = new THREE.Mesh(
            new THREE.CylinderGeometry(0.32, 0.32, 0.25, 16),
            new THREE.MeshPhongMaterial({ color: COLOR.dark, shininess: 40 })
        );
        motorBase.position.set(mp.x, 0.15, mp.z);
        motorBase.castShadow = true;
        drone.add(motorBase);

        // 馬達頂蓋（青色）
        const motorTop = new THREE.Mesh(
            new THREE.CylinderGeometry(0.28, 0.28, 0.1, 16),
            new THREE.MeshPhongMaterial({ color: COLOR.primary, shininess: 80 })
        );
        motorTop.position.set(mp.x, 0.32, mp.z);
        drone.add(motorTop);

        // 螺旋槳
        const propGroup = new THREE.Group();
        propGroup.position.set(mp.x, 0.4, mp.z);
        const blade1 = new THREE.Mesh(
            new THREE.BoxGeometry(1.4, 0.04, 0.15),
            new THREE.MeshPhongMaterial({
                color: i % 2 === 0 ? COLOR.yellow : COLOR.white,
                transparent: true,
                opacity: 0.9
            })
        );
        const blade2 = new THREE.Mesh(
            new THREE.BoxGeometry(0.15, 0.04, 1.4),
            new THREE.MeshPhongMaterial({
                color: i % 2 === 0 ? COLOR.yellow : COLOR.white,
                transparent: true,
                opacity: 0.9
            })
        );
        propGroup.add(blade1);
        propGroup.add(blade2);
        drone.add(propGroup);
        propellers.push(propGroup);
    });

    // LED 燈（前綠後紅，順手牽羊式真實感）
    const ledFront = new THREE.Mesh(
        new THREE.SphereGeometry(0.12, 8, 8),
        new THREE.MeshBasicMaterial({ color: COLOR.ledGreen })
    );
    ledFront.position.set(0, 0.15, 1.25);
    drone.add(ledFront);

    const ledRear = new THREE.Mesh(
        new THREE.SphereGeometry(0.12, 8, 8),
        new THREE.MeshBasicMaterial({ color: COLOR.ledRed })
    );
    ledRear.position.set(0, 0.15, -1.25);
    drone.add(ledRear);

    // 底盤小支架（避免看起來扁扁的）
    const legGeo = new THREE.BoxGeometry(0.1, 0.4, 0.1);
    const legMat = new THREE.MeshPhongMaterial({ color: COLOR.dark });
    [[1.0, -1.0], [-1.0, -1.0], [1.0, 1.0], [-1.0, 1.0]].forEach(([x, z]) => {
        const leg = new THREE.Mesh(legGeo, legMat);
        leg.position.set(x * 0.7, -0.2, z * 0.7);
        drone.add(leg);
    });

    // 底下平板（地板保護）
    const bottomPlate = new THREE.Mesh(
        new THREE.BoxGeometry(1.4, 0.05, 1.4),
        new THREE.MeshPhongMaterial({ color: COLOR.accent })
    );
    bottomPlate.position.y = -0.1;
    drone.add(bottomPlate);

    return { drone, propellers };
}

const { drone: droneModel, propellers } = buildCreaFlyDrone();
scene.add(droneModel);

// =============================================================================
// 4. 環境（地面、雲、任務圈）
// =============================================================================
// 地面（棋盤格方便辨識方向）
const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(120, 120, 12, 12),
    new THREE.MeshPhongMaterial({
        color: 0x4FBE6E,
        shininess: 5
    })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// v1.4 6/22 修正 1：地面格子線（soccer field grid）— 幫助學生目測水平移動距離
const groundGrid = new THREE.GridHelper(50, 10, 0xffffff, 0x4dd0e1);
groundGrid.position.y = 0.01;  // 略高於地面避免 z-fighting
groundGrid.material.opacity = 0.6;
groundGrid.material.transparent = true;
scene.add(groundGrid);

// 起飛台
const pad = new THREE.Mesh(
    new THREE.CylinderGeometry(1.8, 1.8, 0.1, 32),
    new THREE.MeshPhongMaterial({ color: COLOR.yellow, shininess: 100 })
);
pad.position.y = 0.05;
pad.receiveShadow = true;
scene.add(pad);

// 雲
const clouds = [];
for (let i = 0; i < 30; i++) {
    const cloud = new THREE.Mesh(
        new THREE.SphereGeometry(Math.random() * 2.5 + 1.5, 8, 8),
        new THREE.MeshPhongMaterial({
            color: 0xffffff, transparent: true, opacity: 0.85, flatShading: true
        })
    );
    cloud.position.set(
        Math.random() * 200 - 100,
        Math.random() * 25 + 25,
        Math.random() * 200 - 100
    );
    cloud.scale.y = 0.5;
    clouds.push(cloud);
    scene.add(cloud);
}

// v1.3 任務圈：動態載入（由 loadLevel 控制）
let missionRings = [];
let rings = [];
let obstacles = [];
let currentLevel = null;
let chapterData = null;
let levelStartTime = 0;          // 0 = 尚未開始計時（按 OK + 3-2-1 倒數後才設定）
let levelArmed = false;          // 本關是否已按 OK 啟動（避免重複觸發倒數）
let levelCountdownActive = false; // 3-2-1 倒數中：鎖住操控、不判定過關
// v1.4 6/22 修正 3：1-1/1-2/1-3 過關條件用 pass zone（visible disc + state check）
let passZoneMeshes = [];
let passZoneProgress = [];
// 自由活動：氣球收集（球體，靠近即戳破，任意順序、不計時）
let balloons = [];
let balloonState = { collected: 0, total: 0, done: false };
let ringFaceHintAt = 0;  // 「機頭沒對準圈」提示的節流時間戳
const BALLOON_COLORS = [0xff4d6d, 0xffd166, 0x4dd0e1, 0x9b5de5, 0x4ade80, 0xff9f1c];

// 載入 chapter1.json
fetch('levels/chapter1.json')
    .then(r => r.json())
    .then(data => {
        chapterData = data;
        console.log(`%c[v1.3 Chapter 1] 載入 ${data.levels.length} 個關卡`, 'color:#4ade80;font-weight:bold');
        loadLevel('1-0');
    })
    .catch(e => console.warn('載入 chapter1.json 失敗：', e));

const ringColors = {
    red: 0xff4444,
    yellow: 0xfbbf24,
    green: 0x4ade80,
    blue: 0x3b82f6,
};

function clearLevelObjects() {
    // 移除所有現有圈
    rings.forEach(r => scene.remove(r));
    rings = [];
    missionRings = [];
    // 移除所有障礙物
    obstacles.forEach(o => scene.remove(o));
    obstacles = [];
    // 移除所有 pass zone discs
    passZoneMeshes.forEach(m => scene.remove(m));
    passZoneMeshes = [];
    passZoneProgress = [];
    // 移除所有氣球
    balloons.forEach(b => scene.remove(b.mesh));
    balloons = [];
    balloonState = { collected: 0, total: 0, done: false };
    // 隱藏 progress bar
    const bar = document.getElementById('progress-bar');
    if (bar) bar.style.display = 'none';
}

function loadLevel(levelId) {
    if (!chapterData) return;
    const level = chapterData.levels.find(l => l.id === levelId);
    if (!level) {
        console.warn('找不到關卡：', levelId);
        return;
    }
    clearLevelObjects();
    currentLevel = level;

    // 建立圈
    rings = level.rings.map((r, idx) => {
        const color = ringColors[r.color] || COLOR.yellow;
        const ring = new THREE.Mesh(
            new THREE.TorusGeometry(1.5, 0.12, 16, 32),
            new THREE.MeshPhongMaterial({
                color: color,
                emissive: color,
                emissiveIntensity: 0.3,
                shininess: 100,
                transparent: true,
                opacity: 1
            })
        );
        ring.position.set(r.x, r.y, r.z);
        ring.userData.idx = idx;
        ring.userData.label = r.label || String(idx + 1);
        scene.add(ring);
        missionRings.push({ ...r, passed: false });
        return ring;
    });
    programState.totalRings = rings.length;

    // 建立障礙物（軟方塊）
    obstacles = (level.obstacles || []).map(o => {
        const color = o.color ? parseInt(o.color.replace('#',''), 16) : 0x4ade80;
        const mesh = new THREE.Mesh(
            new THREE.BoxGeometry(o.size, o.size, o.size),
            new THREE.MeshPhongMaterial({
                color: color,
                transparent: true,
                opacity: 0.6,
                emissive: color,
                emissiveIntensity: 0.2
            })
        );
        mesh.position.set(o.x, o.y, o.z);
        mesh.userData.soft = true;  // 軟方塊 = 碰到會消失再出現
        // 標了 solid 的方塊：實心、不可被穿過（碰撞由 resolveObstacleCollisions 處理）
        mesh.userData.solid = !!o.solid;
        mesh.userData.half = o.size / 2;
        if (mesh.userData.solid) mesh.material.opacity = 0.85;  // 實心方塊畫得更不透明
        scene.add(mesh);
        return mesh;
    });

    // 重置 drone
    resetDrone();
    // 計時不在載入時開始：要等學生按「開始」+ 3-2-1 倒數後才從 0 起算
    levelStartTime = 0;
    levelArmed = false;
    levelCountdownActive = false;
    // 自由活動關（freeplay）不計時：左下顯示「自由活動」、右上徽章隱藏
    const lt0 = document.getElementById('level-timer');
    const td0 = document.getElementById('timer-display');
    if (level.freeplay) {
        if (lt0) lt0.textContent = '🎈 自由活動';
        if (td0) td0.style.display = 'none';
    } else {
        if (lt0) lt0.textContent = '⏱ 0.0s';
        if (td0) { td0.style.display = ''; td0.textContent = '0.0s'; }
    }
    programState.manualComplete = false;

    // v1.4 6/22 修正 3：建立 pass zone 視覺 discs + 初始化進度
    if (level.passZones && level.passZones.length) {
        passZoneProgress = new Array(level.passZones.length).fill(false);
        level.passZones.forEach((zone, i) => {
            // 只有「位置」型目標（前/後/左/右）才畫地面圈才有意義；
            // 高度 / 方位型目標畫在地上反而誤導，改靠右側進度條表示（push null 維持索引對齊）。
            if (zone.type !== 'position') { passZoneMeshes.push(null); return; }
            const disc = new THREE.Mesh(
                new THREE.RingGeometry(0.6, 1.2, 32),
                new THREE.MeshBasicMaterial({
                    color: 0x4ade80,
                    side: THREE.DoubleSide,
                    transparent: true,
                    opacity: 0.4
                })
            );
            disc.rotation.x = -Math.PI / 2;
            disc.position.set(zone.x || 0, 0.02, zone.z || 0);
            disc.userData.zoneIndex = i;
            scene.add(disc);
            passZoneMeshes.push(disc);
        });
        // 初始化 HUD progress bar
        initProgressBar(level.passZones);
        updatePassZoneProgress();  // 一進關卡就把第 1 步標成「進行中」
    }

    // 自由活動：建立氣球（彩色球體，靠近即戳破）
    if (level.balloons && level.balloons.length) {
        level.balloons.forEach((b, i) => {
            const color = BALLOON_COLORS[i % BALLOON_COLORS.length];
            const mesh = new THREE.Mesh(
                new THREE.SphereGeometry(0.7, 20, 16),
                new THREE.MeshPhongMaterial({
                    color, emissive: color, emissiveIntensity: 0.35,
                    shininess: 80, transparent: true, opacity: 0.95
                })
            );
            mesh.position.set(b.x, b.y, b.z);
            // 細繩（讓氣球看起來是飄的）
            const string = new THREE.Mesh(
                new THREE.CylinderGeometry(0.015, 0.015, 0.9, 6),
                new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 })
            );
            string.position.set(0, -0.8, 0);
            mesh.add(string);
            scene.add(mesh);
            balloons.push({ mesh, popped: false });
        });
        balloonState = { collected: 0, total: balloons.length, done: false };
        updateBalloonHUD();
    }

    // HUD 顯示切換：有圈才顯示鑽圈 HUD、有氣球才顯示氣球 HUD
    const missionHud = document.getElementById('mission-hud');
    if (missionHud) missionHud.style.display = (level.rings && level.rings.length) ? 'block' : 'none';
    const balloonHud = document.getElementById('balloon-hud');
    if (balloonHud) balloonHud.style.display = (level.balloons && level.balloons.length) ? 'block' : 'none';
    // returnHome 關卡：右側進度顯示「飛回起飛墊並降落」步驟（一開始為待辦）
    const rhStep = document.getElementById('returnhome-step');
    if (rhStep) {
        if (level.returnHome) updateReturnHomeStep('pending');
        else rhStep.style.display = 'none';
    }

    // 顯示教學提示
    showLevelIntro(level);
    setStateHUD(level.hud || level.name);
}

// v1.4 6/22 修正 3：每幀檢查 pass zone 過關條件
function checkPassZones() {
    if (!currentLevel || !currentLevel.passZones) return;
    currentLevel.passZones.forEach((zone, i) => {
        if (passZoneProgress[i]) return;  // 已過
        // 必須照順序過關：前一步沒完成，這一步尚未「啟用」。
        // 否則像「落地 / 回到原點 / 回正方位」這種步驟，會被「剛開始的初始狀態」誤判為完成。
        if (i > 0 && !passZoneProgress[i - 1]) return;
        let passed = false;
        if (zone.type === 'altitude') {
            const y = droneState.position.y;
            if (zone.minY !== undefined && y < zone.minY) return;
            if (zone.maxY !== undefined && y > zone.maxY) return;
            passed = true;
        } else if (zone.type === 'position') {
            const x = droneState.position.x;
            const y = droneState.position.y;
            const z = droneState.position.z;
            if (zone.minX !== undefined && x < zone.minX) return;
            if (zone.maxX !== undefined && x > zone.maxX) return;
            if (zone.minZ !== undefined && z < zone.minZ) return;
            if (zone.maxZ !== undefined && z > zone.maxZ) return;
            // 可選的高度要求（例如要求「在空中」而非趴在地上爬）
            if (zone.minY !== undefined && y < zone.minY) return;
            if (zone.maxY !== undefined && y > zone.maxY) return;
            passed = true;
        } else if (zone.type === 'heading') {
            // rotation.y 是 Three.js Euler 軸向：正 Y 為逆時針（從上方看）
            const yawDeg = ((droneState.rotation.y * 180 / Math.PI) % 360 + 360) % 360;
            const target = ((zone.targetYaw % 360) + 360) % 360;
            let diff = Math.abs(yawDeg - target);
            if (diff > 180) diff = 360 - diff;
            if (diff > (zone.tolerance || 20)) return;
            passed = true;
        }
        if (passed) {
            passZoneProgress[i] = true;
            // 視覺回饋：zone disc 變亮
            const mesh = passZoneMeshes[i];
            if (mesh) {
                mesh.material.color.setHex(0x10b981);
                mesh.material.opacity = 0.8;
            }
            updatePassZoneProgress();
            showToast(`✓ ${zone.label || ('步驟 ' + (i+1))}`, 'success');
            playRingSound();
            // 全部過了？
            if (passZoneProgress.every(p => p)) {
                showToast('🎉 過關！', 'success');
                playCompleteSound();
                if (currentLevel) wsReportComplete(currentLevel.id, Date.now() - levelStartTime);
                programState.manualComplete = true;
            }
        }
    });
}

function initProgressBar(zones) {
    const bar = document.getElementById('progress-bar');
    if (!bar) return;
    bar.style.display = 'block';
    const stepsEl = bar.querySelector('.steps');
    const textEl = bar.querySelector('.progress-text') || document.getElementById('progress-text');
    if (stepsEl) {
        stepsEl.innerHTML = '';
        zones.forEach((zone, i) => {
            const step = document.createElement('div');
            step.className = 'step';
            step.setAttribute('data-step', i);
            step.textContent = `${i+1}. ${zone.label || ('步驟 ' + (i+1))}`;
            stepsEl.appendChild(step);
        });
    }
    if (textEl) textEl.textContent = `0/${zones.length}`;
}

function updatePassZoneProgress() {
    if (!currentLevel || !currentLevel.passZones) return;
    const total = currentLevel.passZones.length;
    const done = passZoneProgress.filter(p => p).length;
    const textEl = document.getElementById('progress-text');
    if (textEl) textEl.textContent = `${done}/${total}`;
    // 找出目前「啟用中」的步驟：第一個尚未完成的步驟（照順序）
    const activeIdx = passZoneProgress.findIndex(p => !p);
    const bar = document.getElementById('progress-bar');
    if (bar) {
        bar.querySelectorAll('.step').forEach((step, i) => {
            step.classList.toggle('completed', passZoneProgress[i]);
            step.classList.toggle('active', i === activeIdx);
        });
    }
}

function showLevelIntro(level) {
    const modal = document.getElementById('level-intro');
    if (!modal) return;
    const titleEl = modal.querySelector('.level-intro-title');
    const bodyEl = modal.querySelector('.level-intro-body');
    if (titleEl) titleEl.textContent = `${level.id} · ${level.name}`;
    if (bodyEl) bodyEl.textContent = level.intro || '';
    modal.classList.add('show');
    // 不自動開始計時：等學生按「開始」。若太久沒按，當作 fallback 自動啟動。
    const armId = level.id;
    setTimeout(() => { if (currentLevel && currentLevel.id === armId) armLevelStart(); }, level.id === '1-0' ? 15000 : 20000);
}

// 按「開始」→ 關閉說明 → 3-2-1 倒數 → 開始計時（每關只觸發一次）
function armLevelStart() {
    if (levelArmed) return;
    levelArmed = true;
    const modal = document.getElementById('level-intro');
    if (modal) modal.classList.remove('show');
    // 自由活動關：不倒數、不計時，直接開飛
    if (currentLevel && currentLevel.freeplay) return;
    runCountdown(() => {
        levelStartTime = Date.now();   // 計時正式從 0 起算
    });
}

// 3 → 2 → 1 → GO! 倒數（期間鎖住操控）
function runCountdown(onGo) {
    levelCountdownActive = true;
    const el = document.getElementById('countdown-overlay');
    let n = 3;
    function tick() {
        if (!el) { levelCountdownActive = false; if (onGo) onGo(); return; }
        if (n > 0) {
            el.textContent = String(n);
            el.className = 'show';
            // 重新觸發 pop 動畫
            void el.offsetWidth;
            el.classList.add('show');
            playCountBeep(false);
            n--;
            setTimeout(tick, 700);
        } else {
            el.textContent = 'GO!';
            el.className = 'show go';
            playCountBeep(true);
            levelCountdownActive = false;
            if (onGo) onGo();
            setTimeout(() => { el.className = ''; }, 650);
        }
    }
    tick();
}

// 倒數提示音（短嗶；GO 較高音）。沿用 Web Audio，需使用者互動後才有聲（按 OK 即為互動）。
function playCountBeep(isGo) {
    const ctx = (typeof ensureAudio === 'function') ? ensureAudio() : null;
    if (!ctx || (typeof audioState !== 'undefined' && audioState.muted)) return;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = isGo ? 880 : 440;
    const t = ctx.currentTime, dur = isGo ? 0.45 : 0.18;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.25, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(ctx.destination);
    o.start(t); o.stop(t + dur + 0.02);
}

// 起點指示
const startMarker = new THREE.Mesh(
    new THREE.RingGeometry(0.8, 1.0, 32),
    new THREE.MeshBasicMaterial({ color: COLOR.white, side: THREE.DoubleSide })
);
startMarker.position.y = 0.06;
startMarker.rotation.x = -Math.PI / 2;
scene.add(startMarker);

// v1.3 地面陰影：drone 投影到地面，幫助國小學生判斷水平位置與高度
const groundShadow = new THREE.Mesh(
    new THREE.CircleGeometry(1.0, 32),
    new THREE.MeshBasicMaterial({
        color: 0x222222,
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
        side: THREE.DoubleSide
    })
);
groundShadow.rotation.x = -Math.PI / 2;  // 平貼地面
groundShadow.position.y = 0.05;  // 高於 startMarker 避免閃爍
groundShadow.renderOrder = 1;  // 在地面之上
scene.add(groundShadow);

// v1.3 飛行軌跡線：最近 100 個 drone 位置
const TRAIL_MAX = 100;
let trailPoints = [];
let trailLastSample = 0;
const trailGeometry = new THREE.BufferGeometry();
const trailPositions = new Float32Array(TRAIL_MAX * 3);
trailGeometry.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3));
trailGeometry.setDrawRange(0, 0);
const trailMaterial = new THREE.LineBasicMaterial({
    color: 0x66ccff,
    transparent: true,
    opacity: 0.7,
    depthWrite: false,
});
const trailLine = new THREE.Line(trailGeometry, trailMaterial);
trailLine.renderOrder = 2;
scene.add(trailLine);

function pushTrailPoint(pos) {
    if (trailPoints.length >= TRAIL_MAX) trailPoints.shift();
    trailPoints.push(pos.clone());
    // 寫入 BufferAttribute
    for (let i = 0; i < trailPoints.length; i++) {
        trailPositions[i * 3 + 0] = trailPoints[i].x;
        trailPositions[i * 3 + 1] = trailPoints[i].y;
        trailPositions[i * 3 + 2] = trailPoints[i].z;
    }
    trailGeometry.setDrawRange(0, trailPoints.length);
    trailGeometry.attributes.position.needsUpdate = true;
}
function clearTrail() {
    trailPoints = [];
    trailGeometry.setDrawRange(0, 0);
    trailGeometry.attributes.position.needsUpdate = true;
}

// =============================================================================
// 5. 無人機狀態
// =============================================================================
const droneState = {
    position: new THREE.Vector3(0, 0.4, 0),    // 起點在地面
    rotation: new THREE.Euler(0, 0, 0),         // 機頭朝 -Z
    velocity: new THREE.Vector3(0, 0, 0),
    propellerRotation: 0,
    isFlying: false,                            // 起飛與否
    isGrounded: true,
    frozen: false,                              // v1.3 緊急停止凍結
    returning: false,                           // v1.3 回家中
};

const HOME_POSITION = new THREE.Vector3(0, 0.4, 0);

// =============================================================================
// 5.5 v1.3 玩家模組（帳密 / 顯示名稱）
// =============================================================================
const player = {
    name: '',
    emoji: '',
};

function loadPlayer() {
    try {
        const saved = localStorage.getItem('creafly_player');
        if (saved) {
            const p = JSON.parse(saved);
            if (p && p.name && p.emoji) {
                player.name = p.name;
                player.emoji = p.emoji;
                return true;
            }
        }
    } catch (e) {
        console.warn('載入玩家資料失敗', e);
    }
    return false;
}

function savePlayer() {
    try {
        localStorage.setItem('creafly_player', JSON.stringify({
            name: player.name,
            emoji: player.emoji,
            createdAt: new Date().toISOString()
        }));
    } catch (e) {}
}

function showLoginModal() {
    const modal = document.getElementById('login-modal');
    if (!modal) return;
    // 預填上次的名字
    const nameInput = document.getElementById('login-name');
    if (nameInput && player.name) nameInput.value = player.name;
    // 清掉 emoji 選擇
    document.querySelectorAll('.emoji-btn').forEach(b => b.classList.remove('selected'));
    if (player.emoji) {
        const btn = document.querySelector(`.emoji-btn[data-emoji="${player.emoji}"]`);
        if (btn) btn.classList.add('selected');
    }
    modal.classList.add('show');
}

function hideLoginModal() {
    const modal = document.getElementById('login-modal');
    if (modal) modal.classList.remove('show');
    // 顯示 player HUD
    const hud = document.getElementById('player-hud');
    const display = document.getElementById('player-name-display');
    if (hud && display) {
        display.textContent = `${player.name}${player.emoji}`;
        hud.style.display = 'flex';
    }
}

function initPlayer() {
    // emoji 選擇
    document.querySelectorAll('.emoji-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.emoji-btn').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            player.emoji = btn.getAttribute('data-emoji');
        });
    });
    // 開始按鈕
    document.getElementById('login-start').addEventListener('click', () => {
        const name = (document.getElementById('login-name').value || '').trim();
        if (!name) { showToast('請輸入名字', 'error'); return; }
        if (!player.emoji) { showToast('請選一個動物', 'error'); return; }
        player.name = name;
    savePlayer();
    hideLoginModal();
    showToast(`✓ 歡迎 ${player.name}${player.emoji}！`, 'success');
    window.dispatchEvent(new Event('player-ready'));
    // 延遲一點連線
    setTimeout(connectToTeacher, 200);
});
    // 改名
    document.getElementById('player-rename').addEventListener('click', () => {
        showLoginModal();
    });
    // 啟動時檢查
    if (loadPlayer()) {
        hideLoginModal();
    } else {
        showLoginModal();
    }
}

// =============================================================================
// 5.6 v1.3 音訊模組（Web Audio API 程式生成）
// =============================================================================
const audioState = {
    ctx: null,           // AudioContext
    bgmOsc: null,        // BGM gain node
    bgmPlaying: false,
    muted: false,
};

function initAudio() {
    if (audioState.ctx) return audioState.ctx;
    try {
        audioState.ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
        console.warn('Web Audio API 不可用', e);
        return null;
    }
    return audioState.ctx;
}

function ensureAudio() {
    if (!audioState.ctx) initAudio();
    if (audioState.ctx && audioState.ctx.state === 'suspended') {
        audioState.ctx.resume();
    }
    return audioState.ctx;
}

// 過關音效：3 個上升音（C5-E5-G5）
function playRingSound() {
    const ctx = ensureAudio();
    if (!ctx || audioState.muted) return;
    const now = ctx.currentTime;
    const freqs = [523.25, 659.25, 783.99];  // C5, E5, G5
    freqs.forEach((f, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'square';
        osc.frequency.value = f;
        gain.gain.setValueAtTime(0, now + i * 0.08);
        gain.gain.linearRampToValueAtTime(0.08, now + i * 0.08 + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.08 + 0.2);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now + i * 0.08);
        osc.stop(now + i * 0.08 + 0.22);
    });
}

// 撞牆 / 撞地音效：低頻方波短暫
function playBumpSound() {
    const ctx = ensureAudio();
    if (!ctx || audioState.muted) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(120, now);
    osc.frequency.exponentialRampToValueAtTime(40, now + 0.15);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.12, now + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.2);
}

// 緊急停止音效：噪音衰減
function playStopSound() {
    const ctx = ensureAudio();
    if (!ctx || audioState.muted) return;
    const now = ctx.currentTime;
    const buf = ctx.createBuffer(1, ctx.sampleRate * 0.25, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
        data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 1000;
    src.connect(filter).connect(gain).connect(ctx.destination);
    src.start(now);
    src.stop(now + 0.26);
}

// 過關完成：上行琶音 + 結束音
function playCompleteSound() {
    const ctx = ensureAudio();
    if (!ctx || audioState.muted) return;
    const now = ctx.currentTime;
    const freqs = [523.25, 659.25, 783.99, 1046.5];  // C5 E5 G5 C6
    freqs.forEach((f, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.value = f;
        gain.gain.setValueAtTime(0, now + i * 0.1);
        gain.gain.linearRampToValueAtTime(0.1, now + i * 0.1 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.1 + 0.3);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now + i * 0.1);
        osc.stop(now + i * 0.1 + 0.32);
    });
}

// BGM：8-bit 風格 loop（30 秒）
// 背景音樂：改用 propwash 的 Magenta Metropolis（|e s c p|, CC BY 4.0；見 docs/ATTRIBUTIONS.md）
// 取代原本單調的方波旋律，改以 HTML <audio> 串流播放（省記憶體）。
// 預設關閉，由 #music-btn 開關；瀏覽器 autoplay 政策需使用者互動才能播放。
function startBGM() {
    const el = document.getElementById('bg-music');
    if (!el) return;
    el.volume = 0.15;
    const p = el.play();
    if (p && p.catch) p.catch(err => console.warn('背景音樂播放被瀏覽器阻擋（需使用者互動）：', err));
    audioState.bgmPlaying = true;
}

function stopBGM() {
    const el = document.getElementById('bg-music');
    if (el) el.pause();
    audioState.bgmPlaying = false;
}

function setMute(muted) {
    audioState.muted = muted;
    if (audioState.bgmOsc) {
        audioState.bgmOsc.gain.value = muted ? 0 : 0.07;
    }
}

// =============================================================================
// 6. 鍵盤 + 虛擬搖桿 控制
// =============================================================================
const keys = {};
window.addEventListener('keydown', e => {
    keys[e.key.toLowerCase()] = true;
    // Space 用 ' ' 進入 keys
    if (e.key === ' ') keys[' '] = true;
});
window.addEventListener('keyup', e => {
    keys[e.key.toLowerCase()] = false;
    if (e.key === ' ') keys[' '] = false;
});

// v1.3 空白鍵 = 起飛（地面）/ 緊急停止（空中）/ 恢復（凍結中）
window.addEventListener('keydown', e => {
    if (e.key !== ' ' || e.repeat) return;
    e.preventDefault();
    if (droneState.isGrounded) {
        // 起飛：交給 applyManualControls 處理（用 wantsTakeoff）
        // 這裡什麼都不做
    } else if (droneState.returning) {
        // 回家中不處理
    } else if (droneState.isFlying) {
        // 空中 → 緊急停止
        droneState.frozen = true;
        droneState.velocity.set(0, 0, 0);
        droneState.angularVelocity = 0;
        showToast('🛑 緊急停止 — 推桿恢復飛行', 'warning');
        playStopSound();
    }
});

// v1.3 凍結恢復：推桿 / 鍵盤移動 任一輸入就解除
function isControlInputActive() {
    if (typeof joystick !== 'undefined' &&
        (joystick.throttle !== 0 || joystick.yaw !== 0 ||
         joystick.roll !== 0 || joystick.pitch !== 0)) return true;
    if (keys['w'] || keys['a'] || keys['s'] || keys['d'] ||
        keys['shift'] || keys[' ']) return true;
    if (gamepadState && gamepadState.connected) {
        const a = gamepadState.axes;
        if (a && a.some(v => Math.abs(v) > 0.3)) return true;
    }
    return false;
}

// 虛擬搖桿輸入狀態（兩根搖桿，標準 FPV 配置）
const joystick = {
    throttle: 0,   // 左桿 上下 (-1 升 / +1 降)
    yaw: 0,        // 左桿 左右 (-1 左旋 / +1 右旋)
    pitch: 0,      // 右桿 上下 (-1 前進 / +1 後退)
    roll: 0,       // 右桿 左右 (-1 左飛 / +1 右飛)
    active: false, // 任何搖桿有輸入
};

// 自動偵測觸控裝置
const isTouchDevice = (
    'ontouchstart' in window ||
    navigator.maxTouchPoints > 0 ||
    window.matchMedia('(pointer: coarse)').matches
);
if (isTouchDevice || new URLSearchParams(location.search).has('joystick')) {
    document.body.classList.add('touch-device');
    document.body.classList.add('joystick-forced');
    document.getElementById('help-joystick').style.display = 'block';
    document.getElementById('help-keyboard').style.display = 'none';
}

// 模式切換按鈕（鍵盤 / 搖桿 互不衝突，可同時開）
document.getElementById('mode-toggle').addEventListener('click', () => {
    document.body.classList.toggle('joystick-forced');
    const forced = document.body.classList.contains('joystick-forced');
    const btn = document.getElementById('mode-toggle');
    btn.classList.toggle('active', forced);
    btn.textContent = forced ? '🎮 搖桿：開' : '🎮 搖桿：自動';
    showToast(forced ? '搖桿模式：開' : '搖桿模式：自動', '');
});

// 建立搖桿
function setupJoystick() {
    if (!window.nipplejs) {
        console.warn('nipplejs 載入失敗，跳過搖桿');
        return;
    }

    const commonOpts = {
        mode: 'static',
        position: { left: '50%', top: '50%' },
        color: 'white',
        size: 130,
        restJoystick: true,
        restOpacity: 0.5,
        dynamicPage: false,
    };

    // 左搖桿：油門 (升降) + 偏航 (旋轉)
    const leftStick = nipplejs.create({
        ...commonOpts,
        zone: document.getElementById('joystick-left'),
    });
    leftStick.on('move', (evt, data) => {
        // 對齊實體搖桿 W3C 標準：推上(-y) = 負值；推右(+x) = 正值
        if (isManualLocked()) {
            // 程式模式 / 執行中：忽略搖桿輸入（避免殘留值影響恢復）
            joystick.throttle = 0;
            joystick.yaw = 0;
            return;
        }
        joystick.throttle = data.vector.y;   // 推上(-y) → throttle 負 → 上升
        joystick.yaw      = data.vector.x;   // 推右(+x) → yaw 正 → 機頭向右
        joystick.active = true;
    });
    leftStick.on('end', () => {
        joystick.throttle = 0;
        joystick.yaw = 0;
        // active 由 resetActiveFlag 統一在動畫迴圈裡清除
    });

    // 右搖桿：俯仰 (前後) + 滾轉 (左右)
    const rightStick = nipplejs.create({
        ...commonOpts,
        zone: document.getElementById('joystick-right'),
    });
    rightStick.on('move', (evt, data) => {
        // 對齊實體搖桿：推上(-y) = 負值 = 向前；推右(+x) = 正值 = 右飛
        if (isManualLocked()) {
            joystick.pitch = 0;
            joystick.roll = 0;
            return;
        }
        joystick.pitch = data.vector.y;
        joystick.roll  = data.vector.x;
        joystick.active = true;
    });
    rightStick.on('end', () => {
        joystick.pitch = 0;
        joystick.roll = 0;
    });
}

const THRUST = 0.012;
const MANUAL_LIFT = 0.015;
const DRAG = 0.92;

// =============================================================================
// 6b. 實體搖桿（Web Gamepad API — USB / 藍牙 / Xbox / PS / 一般遊戲手把）
// =============================================================================
const gamepadState = {
    connected: false,
    index: null,
    id: '',
    mapping: '',
    axes: [0, 0, 0, 0],     // 0:左X 1:左Y 2:右X 3:右Y（標準 mapping 假設）
    buttons: [],
    prevButtons: [],
    hasRightStick: false,    // 自動偵測右桿是否存在
    inactivityFrames: 0,     // 右桿 axes 都 0 的幀數
};

// 校正狀態（早期宣告，因為 updateStatus 跟 animate 內會用到）
const calibration = {
    active: false,
    stepIdx: 0,
    startTime: 0,
    // 收集到的校正數據（4 軸 = axes[0..3] = leftX/leftY/rightX/rightY）
    center: [0, 0, 0, 0],   // 置中時的平均值
    min:    [0, 0, 0, 0],   // 畫圈時的最小值
    max:    [0, 0, 0, 0],   // 畫圈時的最大值
    range:  [1, 1, 1, 1],   // 自動算出的範圍
    detectedButtons: { takeoff: null, land: null, reset: null },
    lastBtnSample: [],
};

// 新流程：左桿 / 右桿分開，每個軸做「置中 5s + 畫圈 10s」取 max/min
const CALIB_STEPS = [
    { id: 'rest',        label: '🛑 放開所有搖桿',           hint: '不要碰任何按鍵或推桿 — 5 秒後自動繼續',   duration: 5000,  axes: [0,1,2,3], phase: 'rest' },
    { id: 'leftCenter',  label: '🕹️ 左搖桿置中',             hint: '完全放開左搖桿、不要動 — 5 秒',              duration: 5000,  axes: [0,1],    phase: 'center' },
    { id: 'leftCircle',  label: '🔄 左搖桿畫大圈',           hint: '把左搖桿轉到最外圈、順時鐘畫大圈、撐 10 秒', duration: 10000, axes: [0,1],    phase: 'circle' },
    { id: 'rightCenter', label: '🕹️ 右搖桿置中',             hint: '完全放開右搖桿、不要動 — 5 秒',              duration: 5000,  axes: [2,3],    phase: 'center' },
    { id: 'rightCircle', label: '🔄 右搖桿畫大圈',           hint: '把右搖桿轉到最外圈、順時鐘畫大圈、撐 10 秒', duration: 10000, axes: [2,3],    phase: 'circle' },
    { id: 'btnTakeoff',  label: '🔘 按「起飛」按鈕',         hint: '按一個你想要的按鈕（A / X / START 都可）',  button: 'takeoff' },
    { id: 'btnLand',     label: '🔘 按「降落」按鈕',         hint: '按一個你想要的按鈕',                            button: 'land' },
    { id: 'btnReset',    label: '🔘 按「重置」按鈕',         hint: '按一個你想要的按鈕',                            button: 'reset' },
];

// 搖桿設定（鎖定 Sam 定義的操控邏輯 = 美國手 Mode 2）
//   左桿：Y = throttle（升降），X = yaw（旋轉）
//   右桿：Y = pitch（前後），X = roll（左右）
//   軸向為 W3C Standard：推上 = -1、推左 = -1
const APP_VERSION = '1.4.0';

// =============================================================================
// v1.4 T-101: 手動 ↔ 程式 模式切換
//   - 預設手動（沿用 v1.3 行為）
//   - HUD 右上角按鈕切換：手動 = 鍵盤/觸控/搖桿；程式 = Blockly
//   - 程式執行中：手動鎖定（按鈕 disabled）
//   - 切換時 drone 位置/計時不重置
// =============================================================================
const MODE = { MANUAL: 'manual', PROGRAM: 'program' };
let currentMode = MODE.MANUAL;
let isProgramRunning = false;

function isManualLocked() {
    // 手動鎖定條件：程式執行中、程式模式、或 3-2-1 倒數中
    return isProgramRunning || currentMode !== MODE.MANUAL || levelCountdownActive;
}

function setMode(nextMode) {
    if (currentMode === nextMode) return;
    currentMode = nextMode;
    const body = document.body;
    body.classList.toggle('mode-manual', nextMode === MODE.MANUAL);
    body.classList.toggle('mode-program', nextMode === MODE.PROGRAM);
    // 同步 #mode-mp-toggle 按鈕文字
    const btn = document.getElementById('mode-mp-toggle');
    if (btn) btn.textContent = nextMode === MODE.MANUAL ? '🕹 手動' : '💻 程式';
    // 同步 status-hud 模式顯示
    const modeEl = document.getElementById('hud-mode');
    if (modeEl) {
        modeEl.textContent = nextMode === MODE.MANUAL ? '🕹 手動' : '💻 程式';
    }
    // 切到程式時：自動聚焦 Blockly workspace（讓學生直接拖積木）
    if (nextMode === MODE.PROGRAM && typeof workspace !== 'undefined' && workspace) {
        try { workspace.render(); } catch (e) {}
    }
    console.log(`[v${APP_VERSION}] 模式切換 → ${nextMode}`);
}

document.getElementById('mode-mp-toggle').addEventListener('click', () => {
    if (isProgramRunning) {
        showToast('⏳ 程式執行中，無法切換模式', 'error');
        return;
    }
    setMode(currentMode === MODE.MANUAL ? MODE.PROGRAM : MODE.MANUAL);
});

// v1.4 T-101: URL 參數快速切換（給 headless 截圖 / 老師深連結用）
//   ?mode=manual  → 強制手動
//   ?mode=program → 強制程式
const _modeParam = new URLSearchParams(location.search).get('mode');
if (_modeParam === 'program' || _modeParam === 'manual') {
    setTimeout(() => setMode(_modeParam === 'program' ? MODE.PROGRAM : MODE.MANUAL), 200);
}
// v1.4 B-101-001 fix: 攔截 Blockly.Extensions.register
// 1. Set 標記已見過的 extension 名稱（即使 Blockly 內部 throw 也不重複警告）
// 2. try/catch 包 orig()，把 throw 降級為 warn
// 3. 與 index.html 的早期防護互補（HTML 已在 Blockly 載入前裝好第一道）
const _seenBlocklyExts = new Set();
(function safeBlocklyExt() {
    if (typeof Blockly === 'undefined' || !Blockly.Extensions || !Blockly.Extensions.register) return;
    if (Blockly.Extensions._b101001Patched) return;  // index.html 早期防護已裝過
    const orig = Blockly.Extensions.register.bind(Blockly.Extensions);
    Blockly.Extensions.register = function(name, fn) {
        if (_seenBlocklyExts.has(name)) {
            console.warn('[v' + APP_VERSION + ' B-101-001] Blockly extension "' + name + '" already registered — skip');
            return;
        }
        _seenBlocklyExts.add(name);
        try {
            orig(name, fn);
        } catch (e) {
            console.warn('[v' + APP_VERSION + ' B-101-001] Blockly extension "' + name + '" register failed: ' + (e.message || e) + ' — already registered, ignored');
        }
    };
    Blockly.Extensions._b101001Patched = true;
})();
const gamepadConfig = {
    deadzone: parseFloat(new URLSearchParams(location.search).get('dz')) || 0.10,
    invertThrottle: false,
    invertPitch: false,
    swapSticks: false,
    // 軸配置：W3C 標準 mapping
    axes: { throttle: 1, pitch: 3, yaw: 0, roll: 2 },
    buttonMap: { takeoff: 0, land: 1, reset: 2 },
    // 校正資料：每個軸的 center（置中值）跟 range（範圍）
    center: [0, 0, 0, 0],
    range:  [1, 1, 1, 1],
};

// 自動偵測舊版 localStorage — 如果版本碼不同就清掉舊設定，避免軸向污染
try {
    const storedVer = localStorage.getItem('creafly_app_version');
    if (storedVer !== APP_VERSION) {
        // 升級 / 第一次：清掉舊的搖桿 / 校正 / 映射
        localStorage.removeItem('creafly_gamepad_calib');
        localStorage.removeItem('creafly_gamepad_mapping');
        localStorage.setItem('creafly_app_version', APP_VERSION);
        console.log(`[v${APP_VERSION}] 已清掉舊設定（stored: ${storedVer}）`);
    }
} catch (e) {}

// v1.1 強制重置：忽略舊 localStorage 的 invertThrottle/invertPitch，軸向邏輯已經驗證正確
gamepadConfig.invertThrottle = false;
gamepadConfig.invertPitch = false;
// 強制重置 axes 為 Sam 期望的標準布局
gamepadConfig.axes = { throttle: 1, pitch: 3, yaw: 0, roll: 2 };

// 載入之前的校正（如果有）
try {
    const saved = localStorage.getItem('creafly_gamepad_calib');
    if (saved) {
        const obj = JSON.parse(saved);
        Object.assign(gamepadConfig, obj);
        console.log('[校正] 載入上次的設定', gamepadConfig);
    }
} catch (e) {
    console.warn('載入校正設定失敗', e);
}

// URL 參數快速切換 mapping
const mapParam = new URLSearchParams(location.search).get('map');
if (mapParam === 'switch') {
    // Switch Pro Controller: 0=B, 1=A, 2=Y, 3=X
    gamepadConfig.buttonMap = { takeoff: 1, land: 0, reset: 3 };
} else if (mapParam === 'ipega') {
    // iPega 類 (non-standard): 升降用 D-pad，buttons 順序混亂
    gamepadConfig.invertThrottle = true;  // 推上 = +1
    gamepadConfig.buttonMap = { takeoff: 9, land: 8, reset: 0 };  // START / SELECT / A
}
const swapParam = new URLSearchParams(location.search).get('swap');
if (swapParam === '1') gamepadConfig.swapSticks = true;
const invParam = new URLSearchParams(location.search).get('inv');
if (invParam === 'y' || invParam === '1') {
    gamepadConfig.invertThrottle = true;
    gamepadConfig.invertPitch = true;
}

function detectGamepadSupport() {
    if (!('getGamepads' in navigator)) {
        console.warn('此瀏覽器不支援 Web Gamepad API');
        return false;
    }
    return true;
}

window.addEventListener('gamepadconnected', (e) => {
    const gp = e.gamepad;
    gamepadState.connected = true;
    gamepadState.index = gp.index;
    gamepadState.id = gp.id;
    gamepadState.mapping = gp.mapping || 'non-standard';
    gamepadState.axes = Array.from(gp.axes).slice(0, 4);
    gamepadState.buttons = gp.buttons.map(b => ({ value: b.value, pressed: b.pressed }));
    gamepadState.prevButtons = gamepadState.buttons.map(() => ({ value: 0, pressed: false }));

    document.body.classList.add('gamepad-connected');
    // 不自動展開 HUD，避免擋視線 — user 點「⚙ 搖桿設定」才展開
    const hud = document.getElementById('gamepad-hud');
    if (hud) {
        hud.querySelector('.gp-name').textContent = gp.id;
        hud.querySelector('.gp-mapping').textContent = gp.mapping || 'non-standard';
    }

    // v1.1 debug log — Sam 看到反方向時截圖給我
    console.log('%c[v' + APP_VERSION + ' gamepad connected]', 'color:#f1c40f;font-weight:bold;background:#222;padding:2px 6px');
    console.log({
        axes: { throttle: gamepadConfig.axes.throttle, pitch: gamepadConfig.axes.pitch, yaw: gamepadConfig.axes.yaw, roll: gamepadConfig.axes.roll },
        invert: { throttle: gamepadConfig.invertThrottle, pitch: gamepadConfig.invertPitch },
        rawAxes: gamepadState.axes,
        hint: 'push left stick up: axes[1] should be -1; push left stick left: axes[0] should be -1'
    });
    const helpGp = document.getElementById('help-gamepad');
    if (helpGp) helpGp.style.display = 'block';
    const helpKey = document.getElementById('help-keyboard');
    if (helpKey) helpKey.style.display = 'none';
    const helpJs = document.getElementById('help-joystick');
    if (helpJs) helpJs.style.display = 'none';
    showToast(`🎮 偵測到搖桿：${gp.id.substring(0, 40)} (mapping: ${gamepadState.mapping})`, 'success');

    // 顯示校正按鈕
    const calibBtn = document.getElementById('calib-start-btn');
    if (calibBtn) calibBtn.style.display = 'inline-block';

    // 不再自動展開 gamepad-hud，避免擋視線
    // Debug 模式：永久顯示面板
    if (new URLSearchParams(location.search).has('debug-gamepad')) {
        document.body.classList.add('debug-gamepad');
        const gpHud = document.getElementById('gamepad-hud');
        if (gpHud) gpHud.classList.add('show');
    }

    // 提示如果是非標準 mapping，教使用者用 URL 參數
    if (gamepadState.mapping === '' || gamepadState.mapping === 'non-standard') {
        setTimeout(() => {
            showToast('⚠ 非標準 mapping — 若按鍵錯亂，加 ?map=switch 或 ?map=ipega 試試', 'error');
        }, 2500);
    }
});

window.addEventListener('gamepaddisconnected', (e) => {
    if (gamepadState.index === e.gamepad.index) {
        gamepadState.connected = false;
        gamepadState.index = null;
        gamepadState.axes = [0, 0, 0, 0];
        gamepadState.buttons = [];
        document.body.classList.remove('gamepad-connected');
        const hud = document.getElementById('gamepad-hud');
        if (hud) hud.style.display = 'none';
        const helpGp = document.getElementById('help-gamepad');
        if (helpGp) helpGp.style.display = 'none';
        // 恢復鍵盤或虛擬搖桿說明
        if (isTouchDevice) {
            const helpJs = document.getElementById('help-joystick');
            if (helpJs) helpJs.style.display = 'block';
        } else {
            const helpKey = document.getElementById('help-keyboard');
            if (helpKey) helpKey.style.display = 'block';
        }
        showToast('搖桿已斷線', '');
    }
});

// 在主迴圈裡輪詢（Gamepad API 沒有 per-frame event）
function pollGamepad() {
    if (!gamepadState.connected) return;
    const gamepads = navigator.getGamepads();
    if (!gamepads) return;
    const gp = gamepads[gamepadState.index];
    if (!gp) return;
    gamepadState.prevButtons = gamepadState.buttons.map(b => ({ ...b }));
    gamepadState.axes = Array.from(gp.axes).slice(0, 4);

    // 補 0 到 4 軸（有些搖桿只回 2 軸）
    while (gamepadState.axes.length < 4) gamepadState.axes.push(0);

    gamepadState.buttons = gp.buttons.map(b => ({ value: b.value, pressed: b.pressed }));

    // 自動偵測右桿是否存在（axes[2] 或 axes[3] 連續 30 幀有大於 deadzone 的值）
    const ax2 = Math.abs(gamepadState.axes[2]);
    const ax3 = Math.abs(gamepadState.axes[3]);
    if (ax2 > 0.3 || ax3 > 0.3) {
        gamepadState.hasRightStick = true;
        gamepadState.inactivityFrames = 0;
    } else {
        gamepadState.inactivityFrames++;
        if (gamepadState.inactivityFrames > 60 && gamepadState.hasRightStick) {
            // 60 幀無輸入，可能是 idle
        }
    }
}

function applyDeadzone(v, dz = gamepadConfig.deadzone) {
    return Math.abs(v) < dz ? 0 : v;
}

function isButtonJustPressed(idx) {
    if (idx >= gamepadState.buttons.length) return false;
    return gamepadState.buttons[idx].pressed && !gamepadState.prevButtons[idx]?.pressed;
}

function applyGamepadControls() {
    if (!gamepadState.connected || isManualLocked()) return;

    // 從 axes 設定取出對應值（套用 center/range 校正）
    const rawAxes = gamepadState.axes;
    const dz = gamepadConfig.deadzone;
    const ax = (i) => {
        const raw = (rawAxes[i] || 0);
        const c = (gamepadConfig.center && gamepadConfig.center[i]) || 0;
        const r = (gamepadConfig.range  && gamepadConfig.range[i])  || 1;
        const norm = (raw - c) / r;
        const clamped = Math.max(-1, Math.min(1, norm));
        return Math.abs(clamped) < dz ? 0 : clamped;
    };

    let throttle = ax(gamepadConfig.axes.throttle);
    let pitch    = ax(gamepadConfig.axes.pitch);
    let yaw      = ax(gamepadConfig.axes.yaw);
    let roll     = ax(gamepadConfig.axes.roll);

    // 軸反轉
    if (gamepadConfig.invertThrottle) throttle = -throttle;
    if (gamepadConfig.invertPitch)    pitch    = -pitch;

    // 起飛：throttle 推上 > 0.5 OR 對應按鍵
    if (droneState.isGrounded && (throttle < -0.5 || isButtonJustPressed(gamepadConfig.buttonMap.takeoff))) {
        droneState.isGrounded = false;
        droneState.isFlying = true;
        showToast('🛫 起飛（搖桿）', 'success');
    }

    // 升降
    if (throttle !== 0) droneState.velocity.y += -throttle * MANUAL_LIFT;

    if (droneState.isFlying) {
        if (roll !== 0) {
            const dir = new THREE.Vector3(roll, 0, 0).normalize().applyEuler(droneState.rotation);
            droneState.velocity.add(dir.multiplyScalar(THRUST * Math.abs(roll)));
        }
        if (yaw !== 0) droneState.rotation.y += -yaw * 0.04;  // 推右(yaw+) → rotation.y 負 = CW = 機頭向右
        if (pitch !== 0) {
            const dir = new THREE.Vector3(0, 0, pitch).normalize().applyEuler(droneState.rotation);
            droneState.velocity.add(dir.multiplyScalar(THRUST * Math.abs(pitch)));
        }
    }

    // 按鈕：降落 / 重置
    if (isButtonJustPressed(gamepadConfig.buttonMap.land) && droneState.isFlying) {
        const from = droneState.position.y;
        const to = HOME_POSITION.y;
        const dur = 1500;
        const start = Date.now();
        const step = () => {
            const t = Math.min((Date.now() - start) / dur, 1);
            droneState.position.y = from + (to - from) * t;
            if (t < 1) requestAnimationFrame(step);
            else {
                droneState.isFlying = false;
                droneState.isGrounded = true;
            }
        };
        step();
        showToast('🛬 降落（搖桿）', 'success');
    }
    if (isButtonJustPressed(gamepadConfig.buttonMap.reset)) {
        resetDrone();
        showToast('已重置（搖桿）', '');
    }
}

function applyManualControls() {
    if (isManualLocked()) return; // v1.4 T-101: 程式模式或程式執行中 → 跳過手動控制

    // v1.3 緊急停止凍結中：檢查是否有輸入恢復
    if (droneState.frozen) {
        if (isControlInputActive()) {
            droneState.frozen = false;
            showToast('▶ 恢復飛行', 'success');
        } else {
            return; // 凍結中不處理任何控制
        }
    }

    // v1.3 回家中：交給 tween 處理，不接受任何控制
    if (droneState.returning) return;

    // 優先級：實體搖桿 > 鍵盤 > 虛擬搖桿（三者可疊加，但搖桿最權威）
    applyGamepadControls();

    // 起飛：按 Space 或左桿往上推
    const wantsTakeoff = keys[' '] || joystick.throttle < -0.3;
    if (wantsTakeoff && droneState.isGrounded) {
        droneState.isGrounded = false;
        droneState.isFlying = true;
    }

    // 上升下降（鍵盤 + 搖桿可同時）
    if (keys[' ']) droneState.velocity.y += MANUAL_LIFT;
    if (keys['shift']) droneState.velocity.y -= MANUAL_LIFT;
    if (joystick.throttle !== 0) droneState.velocity.y += -joystick.throttle * MANUAL_LIFT;

    // 水平移動（以機頭方向為準）
    if (droneState.isFlying) {
        // 前進 / 後退
        if (keys['w']) {
            const fwd = new THREE.Vector3(0, 0, -1).applyEuler(droneState.rotation);
            droneState.velocity.add(fwd.multiplyScalar(THRUST));
        }
        if (keys['s']) {
            const fwd = new THREE.Vector3(0, 0, 1).applyEuler(droneState.rotation);
            droneState.velocity.add(fwd.multiplyScalar(THRUST));
        }
        if (joystick.pitch !== 0) {
            const fwd = new THREE.Vector3(0, 0, joystick.pitch).normalize().applyEuler(droneState.rotation);
            droneState.velocity.add(fwd.multiplyScalar(THRUST * Math.abs(joystick.pitch)));
        }
        // 左飛 / 右飛
        if (keys['a']) {
            const lft = new THREE.Vector3(-1, 0, 0).applyEuler(droneState.rotation);
            droneState.velocity.add(lft.multiplyScalar(THRUST));
        }
        if (keys['d']) {
            const rgt = new THREE.Vector3(1, 0, 0).applyEuler(droneState.rotation);
            droneState.velocity.add(rgt.multiplyScalar(THRUST));
        }
        if (joystick.roll !== 0) {
            const rgt = new THREE.Vector3(joystick.roll, 0, 0).normalize().applyEuler(droneState.rotation);
            droneState.velocity.add(rgt.multiplyScalar(THRUST * Math.abs(joystick.roll)));
        }
        // 旋轉（鍵盤 + 搖桿 yaw）
        if (keys['arrowleft']) droneState.rotation.y += 0.03;
        if (keys['arrowright']) droneState.rotation.y -= 0.03;
        if (joystick.yaw !== 0) droneState.rotation.y += -joystick.yaw * 0.04;
    }
}

// =============================================================================
// 7. 程式狀態 & 動作系統
// =============================================================================
const programState = {
    running: false,
    abort: false,
    startTime: 0,
    ringsCollected: 0,
    totalRings: 3,
    manualComplete: false,
    awaitingReturn: false,  // 穿完圈、正在等玩家飛回原點
    returnPhase: null,      // 回家流程階段：null / 'return'(飛回) / 'land'(降落)
};

let programPromise = null;

function sleep(ms) {
    return new Promise((resolve, reject) => {
        const startTime = Date.now();
        const check = () => {
            if (programState.abort) {
                reject(new Error('使用者中斷'));
                return;
            }
            if (Date.now() - startTime >= ms) {
                resolve();
            } else {
                requestAnimationFrame(check);
            }
        };
        check();
    });
}

// 動畫 tween 工具（用 Date.now 讓 headless 截圖也能跑完）
function tween(from, to, duration, applyFn) {
    return new Promise((resolve, reject) => {
        const startTime = Date.now();
        const step = () => {
            if (programState.abort) {
                reject(new Error('使用者中斷'));
                return;
            }
            const t = Math.min((Date.now() - startTime) / duration, 1);
            const eased = t < 0.5 ? 2*t*t : 1 - Math.pow(-2*t+2, 2)/2;  // easeInOut
            const current = from + (to - from) * eased;
            applyFn(current);
            if (t < 1) {
                requestAnimationFrame(step);
            } else {
                resolve();
            }
        };
        step();
    });
}

// =============================================================================
// 8. CREAFLY 動作 API（給 Blockly 用）
// =============================================================================
async function cf_takeoff(height = 8) {
    ensureRunning();
    const from = droneState.position.y;
    const to = Math.max(height, 1.5);
    droneState.isGrounded = false;
    droneState.isFlying = true;
    setStateHUD('起飛中...');
    await tween(from, to, 1500, v => droneState.position.y = v);
    setStateHUD('飛行中');
}

async function cf_land() {
    ensureRunning();
    setStateHUD('降落中...');
    const from = droneState.position.y;
    const to = HOME_POSITION.y;
    await tween(from, to, 1500, v => droneState.position.y = v);
    droneState.velocity.set(0, 0, 0);
    droneState.isFlying = false;
    droneState.isGrounded = true;
    setStateHUD('已降落');
}

async function cf_forward(distance = 2) {
    ensureRunning();
    const dir = new THREE.Vector3(0, 0, -1).applyEuler(droneState.rotation).normalize();
    const startPt = droneState.position.clone();
    const target = startPt.clone().add(dir.clone().multiplyScalar(distance));
    setStateHUD(`前進 ${distance}m`);
    const duration = Math.max(300, Math.abs(distance) * 500);
    await tween(0, 1, duration, t => {
        droneState.position.lerpVectors(startPt, target, t);
    });
    setStateHUD('飛行中');
}

async function cf_backward(distance = 2) {
    return cf_forward(-Math.abs(distance));
}

async function cf_left(distance = 2) {
    ensureRunning();
    const dir = new THREE.Vector3(-1, 0, 0).applyEuler(droneState.rotation).normalize();
    const startPt = droneState.position.clone();
    const target = startPt.clone().add(dir.clone().multiplyScalar(distance));
    setStateHUD(`左飛 ${distance}m`);
    const duration = Math.max(300, Math.abs(distance) * 500);
    await tween(0, 1, duration, t => {
        droneState.position.lerpVectors(startPt, target, t);
    });
    setStateHUD('飛行中');
}

async function cf_right(distance = 2) {
    ensureRunning();
    const dir = new THREE.Vector3(1, 0, 0).applyEuler(droneState.rotation).normalize();
    const startPt = droneState.position.clone();
    const target = startPt.clone().add(dir.clone().multiplyScalar(distance));
    setStateHUD(`右飛 ${distance}m`);
    const duration = Math.max(300, Math.abs(distance) * 500);
    await tween(0, 1, duration, t => {
        droneState.position.lerpVectors(startPt, target, t);
    });
    setStateHUD('飛行中');
}

async function cf_hover(seconds = 1) {
    ensureRunning();
    setStateHUD(`懸停 ${seconds}s`);
    await sleep(seconds * 1000);
    setStateHUD('飛行中');
}

async function cf_rotateClockwise(angle = 90) {
    ensureRunning();
    const from = droneState.rotation.y;
    // 順時針 = 機頭方向順時鐘 = rotation.y 負方向（從上方看 Y 軸）
    const to = from - THREE.MathUtils.degToRad(angle);
    setStateHUD(`順時針 ${angle}°`);
    await tween(from, to, 800, v => droneState.rotation.y = v);
    setStateHUD('飛行中');
}

async function cf_rotateCounterClockwise(angle = 90) {
    ensureRunning();
    const from = droneState.rotation.y;
    // 逆時針 = rotation.y 正方向
    const to = from + THREE.MathUtils.degToRad(angle);
    setStateHUD(`逆時針 ${angle}°`);
    await tween(from, to, 800, v => droneState.rotation.y = v);
    setStateHUD('飛行中');
}

function cf_log(msg) {
    console.log('[CREAFLY]', msg);
}

// v1.4 T-103: 時間型計時 API
// 從程式開始到現在的秒數（float），可用於「if elapsed > 5」這類條件
function cf_elapsed() {
    if (!programState.startTime) return 0;
    return (Date.now() - programState.startTime) / 1000;
}

// 重設計時器回 0（每個關卡開始會自動呼叫一次）
function cf_timerReset() {
    programState.startTime = Date.now();
    setStateHUD('⏱ 計時器重設');
}

// 暫停 N 秒（與 hover 同義，但語意上屬於「時間型」操作）
async function cf_wait(seconds = 1) {
    return cf_hover(seconds);
}

function ensureRunning() {
    if (!programState.running) throw new Error('程式未執行');
    if (programState.abort) throw new Error('使用者中斷');
}

// 暴露給 Blockly 用（轉成 JS code 後 eval）
// v1.4 T-102: 9 個動作 API 對應 9 個 Blockly 積木
// v1.4 T-103: 加 elapsed / timerReset / wait
window.CREAFLY = {
    takeoff: cf_takeoff,
    land: cf_land,
    hover: cf_hover,
    wait: cf_wait,
    forward: cf_forward,
    backward: cf_backward,
    left: cf_left,
    right: cf_right,
    rotateClockwise: cf_rotateClockwise,
    rotateCounterClockwise: cf_rotateCounterClockwise,
    elapsed: cf_elapsed,
    timerReset: cf_timerReset,
    log: cf_log,
};

// =============================================================================
// 9. Blockly 整合
// =============================================================================
function defineCreaFlyBlocks() {
    // v1.4 T-102: 9 個動作積木，3 個分類（動作 / 移動 / 旋轉）

    // ========== 動作分類（顏色 160 青綠）==========
    // 起飛
    Blockly.Blocks['cf_takeoff'] = {
        init: function() {
            this.appendDummyInput().appendField('🛫 起飛 (高度)');
            this.appendValueInput('HEIGHT')
                .setCheck('Number')
                .appendField('到');
            this.appendDummyInput().appendField('m');
            this.setInputsInline(true);
            this.setPreviousStatement(true, null);
            this.setNextStatement(true, null);
            this.setColour(160);
            this.setTooltip('垂直上升到指定高度（公尺），最少 1.5m');
        }
    };
    Blockly.JavaScript['cf_takeoff'] = function(block) {
        const height = Blockly.JavaScript.valueToCode(block, 'HEIGHT',
            Blockly.JavaScript.ORDER_ATOMIC) || '8';
        return `await CREAFLY.takeoff(${height});\n`;
    };

    // 降落
    Blockly.Blocks['cf_land'] = {
        init: function() {
            this.appendDummyInput().appendField('🛬 降落');
            this.setPreviousStatement(true, null);
            this.setNextStatement(true, null);
            this.setColour(160);
            this.setTooltip('緩降回起飛墊');
        }
    };
    Blockly.JavaScript['cf_land'] = function() {
        return 'await CREAFLY.land();\n';
    };

    // 懸停
    Blockly.Blocks['cf_hover'] = {
        init: function() {
            this.appendDummyInput().appendField('⏸ 懸停 (秒數)');
            this.appendValueInput('SEC')
                .setCheck('Number')
                .appendField('');
            this.appendDummyInput().appendField('秒');
            this.setInputsInline(true);
            this.setPreviousStatement(true, null);
            this.setNextStatement(true, null);
            this.setColour(160);
            this.setTooltip('在原地懸停 N 秒（不移動、不旋轉）');
        }
    };
    Blockly.JavaScript['cf_hover'] = (b) => `await CREAFLY.hover(${num(b, 'SEC', 1)});\n`;

    // ========== 移動分類（顏色 210 藍）==========
    function makeMoveBlock(name, icon, label) {
        Blockly.Blocks[name] = {
            init: function() {
                this.appendDummyInput().appendField(`${icon} ${label} (距離)`);
                this.appendValueInput('DIST')
                    .setCheck('Number')
                    .appendField('');
                this.appendDummyInput().appendField('m');
                this.setInputsInline(true);
                this.setPreviousStatement(true, null);
                this.setNextStatement(true, null);
                this.setColour(210);
                this.setTooltip(`沿當前機頭方向${label}指定距離（公尺）`);
            }
        };
    }
    makeMoveBlock('cf_forward',  '⬆', '前進');
    makeMoveBlock('cf_backward', '⬇', '後退');
    makeMoveBlock('cf_left',     '⬅', '左移');
    makeMoveBlock('cf_right',    '➡', '右移');

    Blockly.JavaScript['cf_forward']  = (b) => `await CREAFLY.forward(${num(b, 'DIST', 2)});\n`;
    Blockly.JavaScript['cf_backward'] = (b) => `await CREAFLY.backward(${num(b, 'DIST', 2)});\n`;
    Blockly.JavaScript['cf_left']     = (b) => `await CREAFLY.left(${num(b, 'DIST', 2)});\n`;
    Blockly.JavaScript['cf_right']    = (b) => `await CREAFLY.right(${num(b, 'DIST', 2)});\n`;

    // ========== 旋轉分類（顏色 20 橘）==========
    function makeRotateBlock(name, icon, label) {
        Blockly.Blocks[name] = {
            init: function() {
                this.appendDummyInput().appendField(`${icon} ${label} (角度)`);
                this.appendValueInput('ANGLE')
                    .setCheck('Number')
                    .appendField('');
                this.appendDummyInput().appendField('°');
                this.setInputsInline(true);
                this.setPreviousStatement(true, null);
                this.setNextStatement(true, null);
                this.setColour(20);
                this.setTooltip(`${label}指定角度（從上方看）`);
            }
        };
    }
    makeRotateBlock('cf_rotate_cw',  '↻', '順時針');
    makeRotateBlock('cf_rotate_ccw', '↺', '逆時針');

    Blockly.JavaScript['cf_rotate_cw']  = (b) => `await CREAFLY.rotateClockwise(${num(b, 'ANGLE', 90)});\n`;
    Blockly.JavaScript['cf_rotate_ccw'] = (b) => `await CREAFLY.rotateCounterClockwise(${num(b, 'ANGLE', 90)});\n`;

    // ========== v1.4 T-103 進階積木 ==========
    // 邏輯 / 迴圈 / 變數 / 時間型計時（4 大類）
    // 不做 Sensors 類（per ADR-001 距離感測器砍掉）

    // ===== 邏輯（內建 + 包裝） =====
    // Blockly 內建：controls_if, logic_compare, logic_operation, logic_negate, logic_boolean
    // 全部直接用 Blockly 內建，無需自己寫

    // ===== 迴圈（內建 + 自訂 forever） =====
    // 內建：controls_repeat_ext（重複 N 次）、controls_whileUntil（當...時）
    // 自訂：cf_forever（無限迴圈 + 30s timeout，避免 dead loop 卡死）
    Blockly.Blocks['cf_forever'] = {
        init: function() {
            this.appendDummyInput().appendField('🔁 無限迴圈 (最長 30s)');
            this.appendStatementInput('DO').appendField('執行');
            this.setPreviousStatement(true, null);
            this.setNextStatement(true, null);
            this.setColour(120);
            this.setTooltip('無限重複執行內部動作，最多跑 30 秒自動停止（避免卡死）');
        }
    };
    Blockly.JavaScript['cf_forever'] = function(block) {
        const body = Blockly.JavaScript.statementToCode(block, 'DO');
        return `{
    const _foreverStart = CREAFLY.elapsed();
    while (CREAFLY.elapsed() - _foreverStart < 30) {
        ensureRunning();
        ${body}
        await CREAFLY.wait(0.02);
    }
}\n`;
    };

    // ===== 變數（內建） =====
    // 內建：variables_set, math_change, variables_get
    // 預設變數 count / time 在 injectBlockly 裡 createVariable

    // ===== 時間型計時（自訂 4 個） =====
    // 取代原本的距離感測（per ADR-001）
    Blockly.Blocks['cf_elapsed'] = {
        init: function() {
            this.appendDummyInput().appendField('⏱ 經過秒數');
            this.setOutput(true, 'Number');
            this.setColour(290);
            this.setTooltip('從程式開始到現在經過的秒數（float）。例如：搭配 wait 計算 elapsed 差值 = 飛行時間');
        }
    };
    Blockly.JavaScript['cf_elapsed'] = function() {
        return ['CREAFLY.elapsed()', Blockly.JavaScript.ORDER_FUNCTION_CALL];
    };

    Blockly.Blocks['cf_wait'] = {
        init: function() {
            this.appendDummyInput().appendField('⏸ 等待');
            this.appendValueInput('SEC')
                .setCheck('Number')
                .appendField('');
            this.appendDummyInput().appendField('秒');
            this.setInputsInline(true);
            this.setPreviousStatement(true, null);
            this.setNextStatement(true, null);
            this.setColour(290);
            this.setTooltip('暫停 N 秒（drone 不動作但計時繼續走）');
        }
    };
    Blockly.JavaScript['cf_wait'] = (b) => `await CREAFLY.wait(${num(b, 'SEC', 1)});\n`;

    Blockly.Blocks['cf_every'] = {
        init: function() {
            this.appendDummyInput().appendField('⏰ 每');
            this.appendValueInput('SEC')
                .setCheck('Number')
                .appendField('');
            this.appendDummyInput().appendField('秒執行');
            this.appendStatementInput('DO').appendField('');
            this.setInputsInline(true);
            this.setPreviousStatement(true, null);
            this.setNextStatement(true, null);
            this.setColour(290);
            this.setTooltip('每 N 秒觸發一次內部動作（pseudo interrupt）。內部用 while + elapsed 檢查實作，30s timeout 保護。');
        }
    };
    Blockly.JavaScript['cf_every'] = function(block) {
        const sec = Blockly.JavaScript.valueToCode(block, 'SEC', Blockly.JavaScript.ORDER_ATOMIC) || '1';
        const body = Blockly.JavaScript.statementToCode(block, 'DO');
        return `{
    const _everyStart = CREAFLY.elapsed();
    let _everyLast = CREAFLY.elapsed();
    while (CREAFLY.elapsed() - _everyStart < 30) {
        ensureRunning();
        if (CREAFLY.elapsed() - _everyLast >= ${sec}) {
            _everyLast = CREAFLY.elapsed();
            ${body}
        }
        await CREAFLY.wait(0.02);
    }
}\n`;
    };

    Blockly.Blocks['cf_timer_reset'] = {
        init: function() {
            this.appendDummyInput().appendField('⏱ 計時器重設');
            this.setPreviousStatement(true, null);
            this.setNextStatement(true, null);
            this.setColour(290);
            this.setTooltip('把 elapsed() 計時器歸零（從現在開始算）');
        }
    };
    Blockly.JavaScript['cf_timer_reset'] = function() {
        return 'CREAFLY.timerReset();\n';
    };

    function num(block, name, fallback) {
        return Blockly.JavaScript.valueToCode(block, name,
            Blockly.JavaScript.ORDER_ATOMIC) || String(fallback);
    }
}

function injectBlockly() {
    // v1.4 T-102: 3 個積木分類（動作 / 移動 / 旋轉）+ 通用控制分類
    const toolbox = `
<xml id="toolbox" style="display:none">
  <category name="🛫 動作" colour="160">
    <block type="cf_takeoff">
      <value name="HEIGHT">
        <block type="math_number"><field name="NUM">8</field></block>
      </value>
    </block>
    <block type="cf_land"></block>
    <block type="cf_hover">
      <value name="SEC">
        <block type="math_number"><field name="NUM">1</field></block>
      </value>
    </block>
  </category>
  <category name="🧭 移動" colour="210">
    <block type="cf_forward">
      <value name="DIST">
        <block type="math_number"><field name="NUM">2</field></block>
      </value>
    </block>
    <block type="cf_backward">
      <value name="DIST">
        <block type="math_number"><field name="NUM">2</field></block>
      </value>
    </block>
    <block type="cf_left">
      <value name="DIST">
        <block type="math_number"><field name="NUM">2</field></block>
      </value>
    </block>
    <block type="cf_right">
      <value name="DIST">
        <block type="math_number"><field name="NUM">2</field></block>
      </value>
    </block>
  </category>
  <category name="🔄 旋轉" colour="20">
    <block type="cf_rotate_cw">
      <value name="ANGLE">
        <block type="math_number"><field name="NUM">90</field></block>
      </value>
    </block>
    <block type="cf_rotate_ccw">
      <value name="ANGLE">
        <block type="math_number"><field name="NUM">90</field></block>
      </value>
    </block>
  </category>
  <category name="📝 邏輯" colour="200">
    <block type="controls_if"></block>
    <block type="logic_compare"></block>
    <block type="logic_operation"></block>
    <block type="logic_negate"></block>
    <block type="logic_boolean"></block>
  </category>
  <category name="🔁 迴圈" colour="120">
    <block type="controls_repeat_ext">
      <value name="TIMES">
        <block type="math_number"><field name="NUM">3</field></block>
      </value>
    </block>
    <block type="controls_whileUntil"></block>
    <block type="cf_forever"></block>
  </category>
  <category name="📦 變數" custom="VARIABLE" colour="330">
    <block type="variables_set"></block>
    <block type="math_change">
      <value name="DELTA">
        <block type="math_number"><field name="NUM">1</field></block>
      </value>
    </block>
  </category>
  <category name="⏱ 時間" colour="290">
    <block type="cf_elapsed"></block>
    <block type="cf_wait">
      <value name="SEC">
        <block type="math_number"><field name="NUM">1</field></block>
      </value>
    </block>
    <block type="cf_every">
      <value name="SEC">
        <block type="math_number"><field name="NUM">1</field></block>
      </value>
    </block>
    <block type="cf_timer_reset"></block>
  </category>
  <category name="🔢 數字" colour="230">
    <block type="math_number"><field name="NUM">0</field></block>
    <block type="math_arithmetic"></block>
  </category>
</xml>`;

    const blocklyDiv = document.getElementById('blockly-div');
    // v1.4 B-101-001 fix: 包 try/catch，捕捉 Blockly.inject 內部 throw
    let workspace;
    try {
        workspace = Blockly.inject(blocklyDiv, {
            toolbox: toolbox,
            grid: { spacing: 20, length: 3, colour: '#ddd', snap: true },
            zoom: { controls: true, wheel: true, startScale: 0.85, maxScale: 2, minScale: 0.5 },
            trashcan: true,
            renderer: 'zelos',
            theme: Blockly.Themes.Modern,
        });
    } catch (e) {
        console.warn('[v' + APP_VERSION + ' B-101-001] Blockly.inject failed: ' + (e.message || e) + ' — retrying');
        // 第二次嘗試：通常第二次會成功（第二次註冊會被 safe wrapper 跳過）
        try {
            workspace = Blockly.inject(blocklyDiv, {
                toolbox: toolbox,
                grid: { spacing: 20, length: 3, colour: '#ddd', snap: true },
                zoom: { controls: true, wheel: true, startScale: 0.85, maxScale: 2, minScale: 0.5 },
                trashcan: true,
                renderer: 'zelos',
                theme: Blockly.Themes.Modern,
            });
        } catch (e2) {
            console.error('[v' + APP_VERSION + ' B-101-001] Blockly.inject retry also failed: ' + (e2.message || e2));
            throw e2;  // 真的沒救，let 主程式炸掉提示
        }
    }

    // v1.4 T-102: 預載範例 = 9 個積木展示（起飛 8m → 前進 2m → 順時針 90° → 降落）
    const starterXml = `
<xml xmlns="https://developers.google.com/blockly/xml">
  <block type="cf_takeoff" x="50" y="50">
    <value name="HEIGHT">
      <block type="math_number"><field name="NUM">8</field></block>
    </value>
    <next>
      <block type="cf_forward">
        <value name="DIST">
          <block type="math_number"><field name="NUM">2</field></block>
        </value>
        <next>
          <block type="cf_rotate_cw">
            <value name="ANGLE">
              <block type="math_number"><field name="NUM">90</field></block>
            </value>
            <next>
              <block type="cf_land"></block>
            </next>
          </block>
        </next>
      </block>
    </next>
  </block>
</xml>`;
    const dom = Blockly.utils.xml.textToDom(starterXml);
    Blockly.Xml.domToWorkspace(dom, workspace);

    // v1.4 T-103: 預設變數 count（計數）、time（自訂時間）
    // 用 createVariable 而非純顯示，學生才能在「變數」分類直接看到
    if (!workspace.getVariable('count')) {
        workspace.createVariable('count', '', 'count');
    }
    if (!workspace.getVariable('time')) {
        workspace.createVariable('time', '', 'time');
    }

    return workspace;
}

// =============================================================================
// 10. 程式執行
// =============================================================================
function runProgram(workspace) {
    if (programState.running) return;

    // 重置狀態
    resetDrone();
    programState.running = true;
    programState.abort = false;
    programState.ringsCollected = 0;
    programState.startTime = Date.now();
    // v1.4 T-101: 標記程式執行中（鎖定手動 + 切換按鈕）
    isProgramRunning = true;
    document.body.classList.add('program-running');
    setRunningButtons(true);

    const code = Blockly.JavaScript.workspaceToCode(workspace);
    const asyncFn = `(async () => { ${code} })`;
    let programPromise;
    try {
        programPromise = eval(asyncFn)();
    } catch (e) {
        showToast('編譯失敗：' + e.message, 'error');
        programState.running = false;
        isProgramRunning = false;
        document.body.classList.remove('program-running');
        setRunningButtons(false);
        return;
    }

    programPromise.then(() => {
        if (programState.ringsCollected >= programState.totalRings) {
            const elapsed = ((Date.now() - programState.startTime) / 1000).toFixed(1);
            showToast(`🎉 完成！穿過 3 個圈，用時 ${elapsed}s`, 'success');
        } else {
            showToast('程式結束，但只穿過 ' + programState.ringsCollected + ' 個圈', '');
        }
        programState.running = false;
        isProgramRunning = false;
        document.body.classList.remove('program-running');
        setRunningButtons(false);
    }).catch(e => {
        if (e.message !== '使用者中斷') {
            showToast('執行錯誤：' + e.message, 'error');
            console.error(e);
        } else {
            showToast('已中斷', '');
        }
        programState.running = false;
        isProgramRunning = false;
        document.body.classList.remove('program-running');
        setRunningButtons(false);
    });
}

function stopProgram() {
    if (!programState.running) return;
    programState.abort = true;
}

function resetDrone() {
    droneState.position.copy(HOME_POSITION);
    droneState.rotation.set(0, 0, 0);
    droneState.velocity.set(0, 0, 0);
    droneState.isFlying = false;
    droneState.isGrounded = true;
    droneState.frozen = false;
    droneState.returning = false;
    missionRings.forEach(r => r.passed = false);
    rings.forEach((r, i) => { r.visible = true; r.material.opacity = 1; });
    programState.ringsCollected = 0;
    if (typeof clearTrail === 'function') clearTrail();
    updateRingHUD();
    setStateHUD('待命');
}

// v1.3 回家：一鍵飛回起飛墊（3 秒 tween，期間凍結控制）
function goHome() {
    if (droneState.returning) return;
    if (droneState.isGrounded && droneState.position.distanceTo(HOME_POSITION) < 0.5) {
        showToast('🏠 已經在起飛墊上了', '');
        return;
    }
    droneState.returning = true;
    droneState.frozen = false;  // 解除凍結（如果要回家，先取消凍結）
    droneState.velocity.set(0, 0, 0);
    const from = droneState.position.clone();
    const fromYaw = droneState.rotation.y;
    const dur = 3000;
    const start = Date.now();
    const homeBtn = document.getElementById('home-btn');
    if (homeBtn) homeBtn.disabled = true;
    showToast('🏠 回家中…', 'success');
    const step = () => {
        const t = Math.min((Date.now() - start) / dur, 1);
        const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;  // easeInOut
        droneState.position.x = from.x + (HOME_POSITION.x - from.x) * eased;
        droneState.position.y = from.y + (HOME_POSITION.y - from.y) * eased;
        droneState.position.z = from.z + (HOME_POSITION.z - from.z) * eased;
        // 朝向 0（機頭朝 -Z）
        let yawDiff = fromYaw - 0;
        while (yawDiff > Math.PI) yawDiff -= Math.PI * 2;
        while (yawDiff < -Math.PI) yawDiff += Math.PI * 2;
        droneState.rotation.y = fromYaw - yawDiff * eased;
        if (t < 1) {
            requestAnimationFrame(step);
        } else {
            droneState.position.copy(HOME_POSITION);
            droneState.rotation.set(0, 0, 0);
            droneState.velocity.set(0, 0, 0);
            droneState.isFlying = false;
            droneState.isGrounded = true;
            droneState.returning = false;
            if (homeBtn) homeBtn.disabled = false;
            showToast('🏠 到家了', 'success');
        }
    };
    step();
}

function setRunningButtons(isRunning) {
    document.getElementById('btn-run').disabled = isRunning;
    document.getElementById('btn-stop').disabled = !isRunning;
}

// =============================================================================
// 11. HUD
// =============================================================================
function setStateHUD(text) {
    document.getElementById('hud-state').textContent = text;
}

function updateRingHUD() {
    document.getElementById('rings-passed').textContent = programState.ringsCollected;
    for (let i = 0; i < 3; i++) {
        const dot = document.getElementById('dot-' + i);
        dot.className = 'ring-dot';
        if (i < programState.ringsCollected) {
            dot.classList.add('done');
        } else if (i === programState.ringsCollected && programState.running) {
            dot.classList.add('current');
        }
    }
}

function updateStatus() {
    document.getElementById('hud-alt').textContent = droneState.position.y.toFixed(1);
    if (programState.running && programState.ringsCollected < programState.totalRings) {
        const elapsed = ((Date.now() - programState.startTime) / 1000).toFixed(1);
        document.getElementById('timer-display').textContent = elapsed + 's';
    }
    // 搖桿即時值
    if (gamepadState.connected) {
        const el = document.getElementById('gamepad-axes');
        if (el) {
            el.textContent = gamepadState.axes
                .slice(0, 4)
                .map(v => v.toFixed(2).padStart(5))
                .join(' | ');
        }
        // 按鈕即時面板
        const btnRow = document.getElementById('gamepad-buttons');
        if (btnRow) {
            const parts = [];
            for (let i = 0; i < Math.min(17, gamepadState.buttons.length); i++) {
                const b = gamepadState.buttons[i];
                const pressed = b.pressed;
                const analog = b.value > 0.05 && b.value < 0.95;
                const cls = pressed ? (analog ? 'analog on' : 'on') : '';
                parts.push(`<span class="gp-btn ${cls}">${i}</span>`);
            }
            btnRow.innerHTML = parts.join('');
        }
    }

    // PS4 視覺搖桿即時更新
    updatePs4Visual();

    // axes 即時條形圖
    updateAxisBars();

    // 校正 overlay 即時顯示
    if (calibration.active) {
        const cax = document.getElementById('calib-axes');
        if (cax) {
            cax.textContent = 'axes: ' + gamepadState.axes
                .slice(0, 4)
                .map(v => v.toFixed(2).padStart(5))
                .join(' | ');
        }
        const cbtns = document.getElementById('calib-btns');
        if (cbtns) {
            const parts = [];
            for (let i = 0; i < Math.min(17, gamepadState.buttons.length); i++) {
                const cls = gamepadState.buttons[i]?.pressed ? 'on' : '';
                parts.push(`<span class="calib-btn ${cls}">${i}</span>`);
            }
            cbtns.innerHTML = parts.join('');
        }
    }
}

// PS4 視覺搖桿：每幀根據 gamepadState 更新樣式
function updateAxisBars() {
    for (let i = 0; i < 4; i++) {
        const fillEl = document.getElementById('axis-fill-' + i);
        const numEl  = document.getElementById('axis-num-' + i);
        if (!fillEl || !numEl) continue;
        const v = gamepadState.axes[i] || 0;
        if (v >= 0) {
            fillEl.style.left = '50%';
            fillEl.style.width = (v * 50) + '%';
            fillEl.classList.remove('negative');
        } else {
            fillEl.style.left = (50 + v * 50) + '%';
            fillEl.style.width = (-v * 50) + '%';
            fillEl.classList.add('negative');
        }
        // 死區內灰
        const dz = gamepadConfig.deadzone || 0.10;
        if (Math.abs(v) < dz) {
            fillEl.style.opacity = '0.4';
        } else {
            fillEl.style.opacity = '1';
        }
        numEl.textContent = v.toFixed(2);
    }
}

function updatePs4Visual() {
    if (!gamepadState.connected) return;

    // 兩根桿：根據 axes 位置移動 cap
    const stickRange = 12;  // 像素
    const capL = document.getElementById('ps4-stick-cap-l');
    const capR = document.getElementById('ps4-stick-cap-r');
    const lxAxis = currentMapping.leftStickX;
    const lyAxis = currentMapping.leftStickY;
    const rxAxis = currentMapping.rightStickX;
    const ryAxis = currentMapping.rightStickY;
    const lx = (lxAxis !== undefined && gamepadState.axes[lxAxis] !== undefined) ? gamepadState.axes[lxAxis] : 0;
    const ly = (lyAxis !== undefined && gamepadState.axes[lyAxis] !== undefined) ? gamepadState.axes[lyAxis] : 0;
    const rx = (rxAxis !== undefined && gamepadState.axes[rxAxis] !== undefined) ? gamepadState.axes[rxAxis] : 0;
    const ry = (ryAxis !== undefined && gamepadState.axes[ryAxis] !== undefined) ? gamepadState.axes[ryAxis] : 0;
    if (capL) {
        // 推上 (ly=-1) → translateY 負 → cap 往螢幕上（與實體搖桿視覺一致）
        capL.style.transform = `translate(${(lx * stickRange).toFixed(1)}px, ${(ly * stickRange).toFixed(1)}px)`;
    }
    if (capR) {
        capR.style.transform = `translate(${(rx * stickRange).toFixed(1)}px, ${(ry * stickRange).toFixed(1)}px)`;
    }
    // 類比桿「被推」時加亮
    const stickL = document.getElementById('ps4-stick-left');
    const stickR = document.getElementById('ps4-stick-right');
    if (stickL) stickL.classList.toggle('active', Math.abs(lx) + Math.abs(ly) > 0.3);
    if (stickR) stickR.classList.toggle('active', Math.abs(rx) + Math.abs(ry) > 0.3);
    // 更新軸標籤（顯示目前對映到哪個 axes index）
    const labelL = document.getElementById('ps4-stick-label-l');
    const labelR = document.getElementById('ps4-stick-label-r');
    if (labelL) labelL.textContent = `LX${lxAxis} LY${lyAxis}`;
    if (labelR) labelR.textContent = `RX${rxAxis} RY${ryAxis}`;

    // 面按鍵 / D-pad / 肩膀鍵：根據 currentMapping 與按鈕狀態
    const btnState = (i) => i < gamepadState.buttons.length ? gamepadState.buttons[i].pressed : false;
    const setActive = (selector, idx) => {
        const el = document.querySelector(selector);
        if (el) el.classList.toggle('active', btnState(idx));
    };
    // 用 currentMapping 把每個視覺按鍵對到實際 button index
    const cm = currentMapping;
    if (cm) {
        setActive('.ps4-tri', cm.triangle);
        setActive('.ps4-circ', cm.circle);
        setActive('.ps4-cros', cm.cross);
        setActive('.ps4-sq', cm.square);
        setActive('.ps4-l1', cm.l1);
        setActive('.ps4-r1', cm.r1);
        // 類比扳機 (L2/R2) — 假設按鈕
        const l2el = document.querySelector('.ps4-l2');
        const r2el = document.querySelector('.ps4-r2');
        const l2val = cm.l2 < gamepadState.buttons.length ? gamepadState.buttons[cm.l2].value : 0;
        const r2val = cm.r2 < gamepadState.buttons.length ? gamepadState.buttons[cm.r2].value : 0;
        const l2fill = document.getElementById('ps4-l2-fill');
        const r2fill = document.getElementById('ps4-r2-fill');
        if (l2fill) l2fill.style.width = (l2val * 100) + '%';
        if (r2fill) r2fill.style.width = (r2val * 100) + '%';
        if (l2el) l2el.classList.toggle('active', l2val > 0.5);
        if (r2el) r2el.classList.toggle('active', r2val > 0.5);
        // D-pad 用 axes 處理（簡化：D-pad 通常是按鈕 12-15）
        if (cm.dpadUp !== undefined) {
            setActive('.ps4-dpad-up', cm.dpadUp);
            setActive('.ps4-dpad-down', cm.dpadDown);
            setActive('.ps4-dpad-left', cm.dpadLeft);
            setActive('.ps4-dpad-right', cm.dpadRight);
        }
        setActive('.ps4-share', cm.share);
        setActive('.ps4-options', cm.options);
        setActive('.ps4-ps', cm.ps);
    }
}

// 互動式 mapping：每個視覺按鍵點下去會進入 listening 模式
let mappingMode = null;   // { target: 'triangle' | 'leftStickX' | ..., currentValue }
let mappingTargetEl = null;

const currentMapping = {
    // 預設 standard mapping
    triangle: 3, circle: 1, cross: 0, square: 2,
    l1: 4, r1: 5, l2: 6, r2: 7,
    share: 8, options: 9, ps: 10,
    dpadUp: 12, dpadDown: 13, dpadLeft: 14, dpadRight: 15,
    leftStickX: 0, leftStickY: 1, rightStickX: 2, rightStickY: 3,
};

// 載入之前的 mapping
try {
    const savedMap = localStorage.getItem('creafly_gamepad_mapping');
    if (savedMap) Object.assign(currentMapping, JSON.parse(savedMap));
} catch (e) {}

function startMappingMode(targetKey, el) {
    if (!gamepadState.connected) {
        showToast('請先插上搖桿', 'error');
        return;
    }
    // 如果已經在 listening 同樣的 key，取消
    if (mappingMode && mappingMode.target === targetKey) {
        endMappingMode();
        return;
    }
    mappingMode = { target: targetKey, captured: false };
    mappingTargetEl = el;
    const ctrl = document.getElementById('ps4-controller');
    if (ctrl) ctrl.classList.add('listening');
    if (el) {
        el.setAttribute('data-pin-listening', '');
        if (el.classList.contains('ps4-stick')) el.classList.add('armed');
    }
    showToast(`對映「${labelForKey(targetKey)}」：推/按任一輸入，按 ESC 取消`, '');
}

function endMappingMode() {
    if (mappingTargetEl) {
        mappingTargetEl.removeAttribute('data-pin-listening');
        if (mappingTargetEl.classList.contains('ps4-stick')) mappingTargetEl.classList.remove('armed');
    }
    mappingMode = null;
    mappingTargetEl = null;
    const ctrl = document.getElementById('ps4-controller');
    if (ctrl) ctrl.classList.remove('listening');
}

function labelForKey(k) {
    const map = {
        triangle: '△ 三角', circle: '○ 圓圈', cross: '✕ 叉叉', square: '□ 方塊',
        l1: 'L1', r1: 'R1', l2: 'L2', r2: 'R2',
        share: 'SHARE', options: 'OPTIONS', ps: 'PS',
        dpadUp: 'D-Pad 上', dpadDown: 'D-Pad 下', dpadLeft: 'D-Pad 左', dpadRight: 'D-Pad 右',
        leftStickX: '左桿 X 軸', leftStickY: '左桿 Y 軸',
        rightStickX: '右桿 X 軸', rightStickY: '右桿 Y 軸',
    };
    return map[k] || k;
}

// 偵測第一個變化（listening 模式）
function tickMapping() {
    if (!mappingMode) return;
    const rawAxes = gamepadState.axes;
    const btns = gamepadState.buttons;
    const prev = gamepadState.prevButtons;

    // 檢查按鈕
    for (let i = 0; i < btns.length; i++) {
        if (btns[i].pressed && !(prev[i] && prev[i].pressed)) {
            captureMapping(mappingMode.target, { type: 'button', index: i });
            return;
        }
    }
    // 檢查軸
    for (let i = 0; i < rawAxes.length; i++) {
        if (Math.abs(rawAxes[i]) > 0.6) {
            captureMapping(mappingMode.target, { type: 'axis', index: i });
            return;
        }
    }
}

function captureMapping(target, value) {
    if (value.type === 'button') {
        currentMapping[target] = value.index;
    } else if (value.type === 'axis') {
        // 軸映射用「左/右」或「上/下」分離
        if (target.endsWith('X') || target.endsWith('Y')) {
            const stick = target.startsWith('left') ? 'leftStick' : 'rightStick';
            currentMapping[target] = value.index;
        }
    }
    // 同步到 gamepadConfig.axes（影響實際控制）
    // 映射：左 X → yaw, 左 Y → throttle, 右 X → roll, 右 Y → pitch
    if (currentMapping.leftStickX !== undefined)  gamepadConfig.axes.yaw      = currentMapping.leftStickX;
    if (currentMapping.leftStickY !== undefined)  gamepadConfig.axes.throttle = currentMapping.leftStickY;
    if (currentMapping.rightStickX !== undefined) gamepadConfig.axes.roll     = currentMapping.rightStickX;
    if (currentMapping.rightStickY !== undefined) gamepadConfig.axes.pitch    = currentMapping.rightStickY;
    // 同步按鍵
    if (target === 'triangle' || target === 'cross' || target === 'square' || target === 'circle') {
        // 自動猜測起飛/降落/重置
        if (target === 'cross')   gamepadConfig.buttonMap.takeoff = currentMapping.cross;
        if (target === 'circle')  gamepadConfig.buttonMap.land    = currentMapping.circle;
        if (target === 'square')  gamepadConfig.buttonMap.reset   = currentMapping.square;
    }
    // 儲存
    try {
        localStorage.setItem('creafly_gamepad_mapping', JSON.stringify(currentMapping));
        localStorage.setItem('creafly_gamepad_calib', JSON.stringify({
            axes: gamepadConfig.axes,
            buttonMap: gamepadConfig.buttonMap,
        }));
    } catch (e) {}

    showToast(`✓ 對映「${labelForKey(target)}」→ ${value.type === 'button' ? `button ${value.index}` : `axes[${value.index}]`}`, 'success');
    endMappingMode();
}

// =============================================================================
// 12. 物理 / 動畫主迴圈
// =============================================================================
function checkRingCollisions() {
    rings.forEach((ring, i) => {
        if (!ring.visible) return;
        const dist = droneState.position.distanceTo(ring.position);
        if (dist >= 1.5) return;
        // 旋轉鑽圈關：圈標了 faceYaw → 必須「機頭朝向正確方位」才算穿過（強制旋轉）
        const faceYaw = missionRings[i] && missionRings[i].faceYaw;
        if (faceYaw !== undefined && faceYaw !== null) {
            const yawDeg = ((droneState.rotation.y * 180 / Math.PI) % 360 + 360) % 360;
            const target = ((faceYaw % 360) + 360) % 360;
            let d = Math.abs(yawDeg - target);
            if (d > 180) d = 360 - d;
            if (d > (missionRings[i].faceTol || 35)) {
                // 到圈了但機頭沒對準 → 提示轉向（節流，避免每幀洗版）
                const now = (typeof performance !== 'undefined') ? performance.now() : 0;
                if (now - ringFaceHintAt > 1500) {
                    ringFaceHintAt = now;
                    setStateHUD('🔄 轉向紅圈、機頭對準再穿過！');
                    showToast('🔄 機頭要對準紅圈才算過！先轉向', 'warning');
                }
                return;
            }
        }
        ring.visible = false;
        ring.material.opacity = 0.3;
        missionRings[i].passed = true;
        programState.ringsCollected++;
        updateRingHUD();
        showToast(`✓ 穿過圈 ${i + 1}`, 'success');
        playRingSound();
    });
    // 手動模式：所有圈都過了也顯示完成（不結束遊戲）
    const allRingsDone = programState.totalRings > 0 && programState.ringsCollected >= programState.totalRings;
    if (!programState.running && allRingsDone && !programState.manualComplete) {
        if (currentLevel && currentLevel.returnHome) {
            // 穿完圈 → 飛回起飛墊（原點）→ 降落在墊上，才算過關
            const dx = droneState.position.x - HOME_POSITION.x;
            const dz = droneState.position.z - HOME_POSITION.z;
            const distHome = Math.sqrt(dx * dx + dz * dz);  // 水平距離，不看高度
            const overPad = distHome < 1.5;
            const landed = droneState.isGrounded;           // 已降落（碰到地面）
            if (overPad && landed) {
                manualLevelComplete();
            } else {
                programState.awaitingReturn = true;
                // 兩階段引導：先飛回原點上方，再降落
                const phase = overPad ? 'land' : 'return';
                if (programState.returnPhase !== phase) {
                    programState.returnPhase = phase;
                    if (phase === 'return') {
                        setStateHUD('🏠 全部穿過了！飛回起飛墊（原點）');
                        showToast('全部圈圈都穿過了！飛回起飛墊上方', 'success');
                    } else {
                        setStateHUD('🛬 到墊上方了！降落在起飛墊上');
                        showToast('🛬 降下去、降落在起飛墊上就完成！', 'success');
                    }
                    updateReturnHomeStep(phase);
                }
            }
        } else {
            manualLevelComplete();
        }
    }
    // 重置時把完成狀態清掉
    if (programState.ringsCollected < programState.totalRings) {
        programState.manualComplete = false;
        programState.awaitingReturn = false;
        programState.returnPhase = null;
    }
}

function manualLevelComplete() {
    programState.manualComplete = true;
    programState.awaitingReturn = false;
    programState.returnPhase = null;
    if (currentLevel && currentLevel.returnHome) updateReturnHomeStep('done');
    const elapsed = Date.now() - levelStartTime;
    showToast(`🎉 過關！用時 ${(elapsed/1000).toFixed(1)}s`, 'success');
    playCompleteSound();
    // 上報給老師
    if (currentLevel) wsReportComplete(currentLevel.id, elapsed);
}

// 右側關卡進度：returnHome 關卡的「飛回起飛墊 → 降落」提示
function updateReturnHomeStep(phase) {
    const el = document.getElementById('returnhome-step');
    if (!el) return;
    const map = {
        pending: { t: '🏁 最後：飛回起飛墊並降落', cls: '' },
        return:  { t: '🏠 飛回起飛墊（原點）', cls: 'active' },
        land:    { t: '🛬 降落在起飛墊上', cls: 'active' },
        done:    { t: '✓ 已降落，完成！', cls: 'done' },
    };
    const m = map[phase] || map.pending;
    el.textContent = m.t;
    el.className = 'rh-step ' + m.cls;
    el.style.display = 'block';
}

// 自由活動：每幀檢查氣球是否被戳破（靠近即破，任意順序、不結束遊戲）
function checkBalloons() {
    if (!balloons.length) return;
    balloons.forEach((b, i) => {
        if (b.popped) return;
        // 氣球半徑 0.7 + drone 容差 → 1.4 內算戳破
        if (droneState.position.distanceTo(b.mesh.position) < 1.4) {
            b.popped = true;
            b.mesh.visible = false;
            balloonState.collected++;
            updateBalloonHUD();
            showToast(`🎈 戳破 ${balloonState.collected}/${balloonState.total}`, 'success');
            playRingSound();
        }
    });
    // 全部戳破：慶祝一次（自由活動，不鎖關、不強制結束）
    if (!balloonState.done && balloonState.collected >= balloonState.total) {
        balloonState.done = true;
        showToast('🎉 12 顆氣球全部戳破！太厲害了！', 'success');
        playCompleteSound();
        if (currentLevel) wsReportComplete(currentLevel.id, Date.now() - levelStartTime);
    }
}

function updateBalloonHUD() {
    const el = document.getElementById('balloon-count');
    if (el) el.textContent = `${balloonState.collected}/${balloonState.total}`;
}

// 實心方塊碰撞：把 drone 當成半徑 DRONE_RADIUS 的球，AABB 阻擋，沿最小穿透軸推出
const DRONE_RADIUS = 0.5;
function resolveObstacleCollisions() {
    let bumped = false;
    obstacles.forEach(o => {
        if (!o.userData.solid) return;
        const half = o.userData.half + DRONE_RADIUS;  // 方塊半邊長 + drone 半徑
        const c = o.position, p = droneState.position;
        const dx = p.x - c.x, dy = p.y - c.y, dz = p.z - c.z;
        // 不在膨脹後的方塊範圍內 → 沒撞到
        if (Math.abs(dx) >= half || Math.abs(dy) >= half || Math.abs(dz) >= half) return;
        // 在裡面：找穿透最淺的軸，把 drone 推到該面外，並歸零該軸速度
        const px = half - Math.abs(dx), py = half - Math.abs(dy), pz = half - Math.abs(dz);
        const m = Math.min(px, py, pz);
        if (m === px) { p.x = c.x + (dx < 0 ? -half : half); droneState.velocity.x = 0; }
        else if (m === py) { p.y = c.y + (dy < 0 ? -half : half); droneState.velocity.y = 0; }
        else { p.z = c.z + (dz < 0 ? -half : half); droneState.velocity.z = 0; }
        bumped = true;
    });
    // 撞牆音效（沿用撞地音效，避免每幀狂播：靠 velocity 已被歸零自然收斂）
    if (bumped && droneState.isFlying && typeof playBumpSound === 'function') playBumpSound();
}

function animate() {
    requestAnimationFrame(animate);

    // 輪詢實體搖桿狀態
    pollGamepad();

    // 校正偵測
    tickCalibration();

    // 互動式 mapping 偵測
    tickMapping();

    // 手動控制
    if (!programState.running) {
        applyManualControls();
        // 物理
        droneState.position.add(droneState.velocity);
        droneState.velocity.multiplyScalar(DRAG);
        if (droneState.velocity.length() < 0.001) droneState.velocity.set(0, 0, 0);

        // 地板碰撞
        if (droneState.position.y < HOME_POSITION.y) {
            const wasFlying = droneState.isFlying;
            droneState.position.y = HOME_POSITION.y;
            droneState.velocity.y = 0;
            droneState.isGrounded = true;
            droneState.isFlying = false;
            if (wasFlying) playBumpSound();  // 撞地音效
        }
    } else {
        // 程式執行中：物理由 tween 控制，但仍做地板保護
        if (droneState.position.y < HOME_POSITION.y) {
            droneState.position.y = HOME_POSITION.y;
        }
    }

    // 實心方塊碰撞：擋住 drone 不讓它穿過去（只對標了 solid 的障礙物）
    resolveObstacleCollisions();

    // 3-2-1 倒數中不判定過關（避免倒數期間誤觸）
    if (!levelCountdownActive) {
        // 不論手動 / 程式模式，每幀都檢查穿圈
        checkRingCollisions();
        // v1.4 6/22 修正 3：1-1/1-2/1-3 過關條件檢查
        checkPassZones();
        // 自由活動：氣球戳破檢查
        checkBalloons();
    }
    updateLevelTimer();

    // 套用到模型
    droneModel.position.copy(droneState.position);
    droneModel.rotation.copy(droneState.rotation);

    // v1.3 地面陰影：X/Z 跟著 drone，半徑隨高度變大
    groundShadow.position.x = droneState.position.x;
    groundShadow.position.z = droneState.position.z;
    const shadowRadius = Math.max(0.8, Math.min(2.5, 0.8 + droneState.position.y * 0.1));
    groundShadow.scale.set(shadowRadius, shadowRadius, 1);
    // 凍結 / 回家中：陰影變色提示
    if (droneState.frozen) {
        groundShadow.material.color.setHex(0xff4444);  // 紅 = 凍結
    } else if (droneState.returning) {
        groundShadow.material.color.setHex(0x44ff44);  // 綠 = 回家
    } else {
        groundShadow.material.color.setHex(0x222222);  // 黑 = 正常
    }

    // v1.3 飛行軌跡：drone 飛過的路徑線（每 0.1s 採樣一次，或移動超過 0.3m）
    if (droneState.isFlying && !droneState.frozen && !droneState.returning) {
        const now = performance.now();
        if (now - trailLastSample > 100) {
            const last = trailPoints[trailPoints.length - 1];
            if (!last || last.distanceTo(droneState.position) > 0.3) {
                pushTrailPoint(droneState.position);
                trailLastSample = now;
            }
        }
    }

    // 螺旋槳旋轉
    droneState.propellerRotation += 0.6;
    propellers.forEach((p, i) => {
        p.rotation.y = droneState.propellerRotation * (i % 2 ? 1 : -1);
    });

    // 雲漂
    clouds.forEach((c, i) => {
        c.position.x += Math.sin(Date.now() * 0.0008 + i) * 0.02;
        c.position.z += Math.cos(Date.now() * 0.0008 + i) * 0.02;
    });

    // 任務圈動畫（旋轉、漂浮）
    rings.forEach((r, i) => {
        if (r.visible) {
            r.rotation.y += 0.015;
            r.position.y = missionRings[i].y + Math.sin(Date.now() * 0.001 + i) * 0.2;
        }
    });

    // 鏡頭跟隨（簡單的第三人稱）
    const camOffset = new THREE.Vector3(0, 4, 12);
    camOffset.applyEuler(new THREE.Euler(0, droneState.rotation.y, 0));
    const targetCamPos = droneState.position.clone().add(camOffset);
    camera.position.lerp(targetCamPos, 0.06);
    camera.lookAt(droneState.position);

    updateStatus();
    renderer.render(scene, camera);
}

// =============================================================================
// 13. 視窗大小適配
// =============================================================================
function resize() {
    const w = sceneCanvas.clientWidth;
    const h = sceneCanvas.clientHeight;
    if (w === 0 || h === 0) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
new ResizeObserver(resize).observe(sceneCanvas);

// =============================================================================
// 14. 啟動
// =============================================================================
defineCreaFlyBlocks();
const workspace = injectBlockly();
setupJoystick();
detectGamepadSupport();
resize();
initPlayer();  // v1.3 玩家登入
animate();

document.getElementById('btn-run').addEventListener('click', () => runProgram(workspace));
document.getElementById('btn-stop').addEventListener('click', stopProgram);
document.getElementById('btn-reset').addEventListener('click', resetDrone);

updateRingHUD();
setStateHUD('待命');

// 觸控裝置首次訪問提示
if (isTouchDevice && !sessionStorage.getItem('creafly_hint_shown')) {
    sessionStorage.setItem('creafly_hint_shown', '1');
    setTimeout(() => showToast('👆 用畫面下方的兩根搖桿控制無人機', ''), 800);
}

// Debug 模式：沒搖桿時也顯示面板，提示插上搖桿
if (new URLSearchParams(location.search).has('debug-gamepad')) {
    document.body.classList.add('debug-gamepad');
    if (!gamepadState.connected) {
        const hud = document.getElementById('gamepad-hud');
        if (hud) {
            hud.classList.add('show');
            hud.querySelector('.gp-name').textContent = '（未連線 — 插上 USB / 藍牙搖桿）';
            hud.querySelector('.gp-mapping').textContent = 'debug mode';
        }
        const helpGp = document.getElementById('help-gamepad');
        if (helpGp) helpGp.style.display = 'block';
        const helpKey = document.getElementById('help-keyboard');
        if (helpKey) helpKey.style.display = 'none';
    }
}

// URL 自動啟動校正（給教學用）
if (new URLSearchParams(location.search).has('calib')) {
    setTimeout(() => {
        if (typeof startCalibration === 'function') startCalibration();
    }, 1500);
}

// 測試模式：自動注入假 gamepad 訊號（看 PS4 視覺反應）
if (new URLSearchParams(location.search).has('test-gamepad')) {
    let t = 0;
    setInterval(() => {
        t += 0.1;
        if (!gamepadState.connected) {
            gamepadState.connected = true;
            gamepadState.id = 'Test Gamepad (Fake)';
            gamepadState.mapping = 'standard';
            document.body.classList.add('gamepad-connected');
            // 不自動展開 HUD，避免擋視線（除錯時手動展開）
            if (new URLSearchParams(location.search).has('debug-gamepad')) {
                const gpHud = document.getElementById('gamepad-hud');
                if (gpHud) {
                    gpHud.classList.add('show');
                    const nameEl = gpHud.querySelector('.gp-name');
                    const mapEl = gpHud.querySelector('.gp-mapping');
                    if (nameEl) nameEl.textContent = 'Test Gamepad (Fake)';
                    if (mapEl) mapEl.textContent = 'standard';
                }
            }
            showToast('🎮 測試搖桿已連線（自動注入訊號）', 'success');
        }
        gamepadState.axes = [Math.sin(t) * 0.8, Math.cos(t) * 0.6, Math.sin(t * 0.7) * 0.5, Math.cos(t * 0.5) * 0.4];
        gamepadState.buttons = new Array(17).fill(0).map((_, i) => {
            const phase = Math.sin(t * (1 + i * 0.2));
            return { pressed: phase > 0.7, value: phase > 0.7 ? 1 : 0, touched: false };
        });
    }, 100);
}

// =============================================================================
// 6c. 搖桿校正 Wizard
// =============================================================================
function startCalibration() {
    if (!gamepadState.connected) {
        showToast('請先插上搖桿', 'error');
        return;
    }
    calibration.active = true;
    calibration.stepIdx = 0;
    calibration.samples = [];
    calibration.detectedAxes = { throttle: null, pitch: null, yaw: null, roll: null };
    calibration.detectedDirs = { throttle: -1, pitch: -1, yaw: 1, roll: 1 };  // 預設
    calibration.detectedButtons = { takeoff: null, land: null, reset: null };
    calibration.deadzoneSamples = [];
    calibration.lastBtnSample = gamepadState.buttons.map(() => false);
    // 預先 init 暫存陣列（避免 tickCalibration 讀 undefined[0] 炸）
    calibration._sum  = [0, 0, 0, 0];
    calibration._cnt  = [0, 0, 0, 0];
    calibration._init = [false, false, false, false];
    // 按鍵步驟：等到「按下→放開」後才進下一步
    calibration.buttonCaptured = false;
    document.getElementById('calib-overlay').classList.add('show');
    document.getElementById('calib-result').style.display = 'none';
    document.getElementById('calib-save').style.display = 'none';
    document.getElementById('calib-timer-wrap').style.display = 'block';
    document.getElementById('calib-timer-fill').style.width = '0%';
    renderCalibProgress();
    runCalibStep();
    // 啟動獨立 setInterval 驅動 timer（每 100ms 更新一次進度條，不依賴 animate）
    if (window._calibTimer) clearInterval(window._calibTimer);
    window._calibTimer = setInterval(updateCalibTimer, 100);
}

function endCalibration(save) {
    calibration.active = false;
    if (window._calibTimer) { clearInterval(window._calibTimer); window._calibTimer = null; }
    document.getElementById('calib-overlay').classList.remove('show');
    document.getElementById('calib-timer-wrap').style.display = 'none';
    if (save) {
        // 計算每軸的 range（取 center 兩側最大飄移）
        const newRange = [1, 1, 1, 1];
        for (let i = 0; i < 4; i++) {
            const c = calibration.center[i] || 0;
            const downRange = Math.abs(calibration.min[i] - c);
            const upRange   = Math.abs(calibration.max[i] - c);
            // 若該軸沒被收集到（min === max === 0），預設 range = 1（不校正）
            newRange[i] = Math.max(downRange, upRange, 0.5);
        }
        // 寫進 gamepadConfig
        gamepadConfig.center = calibration.center.slice();
        gamepadConfig.range  = newRange;
        ['takeoff', 'land', 'reset'].forEach(k => {
            if (calibration.detectedButtons[k] !== null) {
                gamepadConfig.buttonMap[k] = calibration.detectedButtons[k];
            }
        });
        saveGamepadConfig();
        showToast('✓ 校正完成 — center/range 已套用', 'success');
        console.log('%c[v' + APP_VERSION + ' 校正結果]', 'color:#2ecc71;font-weight:bold;background:#222;padding:2px 6px', {
            center: gamepadConfig.center,
            range:  gamepadConfig.range,
            buttons: gamepadConfig.buttonMap,
        });
        renderCalibResult();
    } else {
        showToast('校正取消', '');
    }
}

function renderCalibProgress() {
    const prog = document.getElementById('calib-progress');
    prog.innerHTML = '';
    CALIB_STEPS.forEach((_, i) => {
        const dot = document.createElement('div');
        dot.className = 'calib-dot';
        if (i < calibration.stepIdx) dot.classList.add('active');
        if (i === calibration.stepIdx) dot.classList.add('current');
        prog.appendChild(dot);
    });
}

function runCalibStep() {
    if (!calibration.active) return;
    if (calibration.stepIdx >= CALIB_STEPS.length) {
        // 全部完成
        document.getElementById('calib-save').style.display = 'inline-block';
        document.getElementById('calib-step-label').textContent = '🎉 校正完成！';
        document.getElementById('calib-hint').textContent = '按「儲存並套用」或「取消」';
        return;
    }

    const step = CALIB_STEPS[calibration.stepIdx];
    document.getElementById('calib-step-label').innerHTML = step.label + ' <span class="calib-arrow">👆</span>';
    document.getElementById('calib-hint').textContent = step.hint;
    calibration.startTime = Date.now();
    // 重設 timer bar
    const fillEl = document.getElementById('calib-timer-fill');
    if (fillEl) fillEl.style.width = '0%';
    const txtEl = document.getElementById('calib-timer-text');
    if (txtEl && step.duration) txtEl.textContent = Math.ceil(step.duration / 1000) + 's';
    // 軸步驟顯示 timer；按鍵步驟隱藏
    const timerWrap = document.getElementById('calib-timer-wrap');
    if (timerWrap) timerWrap.style.display = step.axes ? 'block' : 'none';
}

function skipCalibStep() {
    calibration.stepIdx++;
    renderCalibProgress();
    runCalibStep();
}

// 獨立 timer driver — 每 100ms 跑一次，確保動畫卡住時 timer 還是會前進
function updateCalibTimer() {
    if (!calibration.active) return;
    const step = CALIB_STEPS[calibration.stepIdx];
    if (!step || !step.axes || !step.duration) return;
    const elapsed = Date.now() - calibration.startTime;
    const pct = Math.min(100, (elapsed / step.duration) * 100);
    const fillEl = document.getElementById('calib-timer-fill');
    if (fillEl) fillEl.style.width = pct + '%';
    const txtEl = document.getElementById('calib-timer-text');
    if (txtEl) txtEl.textContent = Math.max(0, Math.ceil((step.duration - elapsed) / 1000)) + 's';
}

// 在主迴圈裡跑校正偵測
function tickCalibration() {
    if (!calibration.active) return;
    const step = CALIB_STEPS[calibration.stepIdx];
    if (!step) return;

    const rawAxes = gamepadState.axes;
    const btns = gamepadState.buttons;

    // ===== 軸資料收集步驟 =====
    if (step.axes) {
        for (const i of step.axes) {
            const v = rawAxes[i] || 0;
            if (step.phase === 'rest' || step.phase === 'center') {
                // 累加 → 結算時取平均
                calibration._sum[i] = (calibration._sum[i] || 0) + v;
                calibration._cnt[i] = (calibration._cnt[i] || 0) + 1;
            } else if (step.phase === 'circle') {
                if (!calibration._init[i]) {
                    calibration.min[i] = v;
                    calibration.max[i] = v;
                    calibration._init[i] = true;
                } else {
                    if (v < calibration.min[i]) calibration.min[i] = v;
                    if (v > calibration.max[i]) calibration.max[i] = v;
                }
            }
        }
        // 更新 timer bar
        const elapsed = Date.now() - calibration.startTime;
        const pct = Math.min(100, (elapsed / step.duration) * 100);
        const fillEl = document.getElementById('calib-timer-fill');
        if (fillEl) fillEl.style.width = pct + '%';
        const txtEl = document.getElementById('calib-timer-text');
        if (txtEl) txtEl.textContent = Math.max(0, Math.ceil((step.duration - elapsed) / 1000)) + 's';

        if (elapsed >= step.duration) {
            // 結算
            if (step.phase === 'rest' || step.phase === 'center') {
                for (const i of step.axes) {
                    const cnt = calibration._cnt[i] || 1;
                    calibration.center[i] = (calibration._sum[i] || 0) / cnt;
                }
            }
            // 清暫存
            for (let i = 0; i < 4; i++) {
                calibration._sum[i]  = 0;
                calibration._cnt[i]  = 0;
                calibration._init[i] = false;
            }
            calibration.stepIdx++;
            renderCalibProgress();
            runCalibStep();
        }
        return;
    }

    // ===== 按鍵偵測步驟 =====
    if (step.button) {
        const anyPressed = btns.some(b => b.pressed);
        if (anyPressed) {
            // 偵測邊緣（剛按下），但要等「完全放開」才進下一步
            if (!calibration.buttonCaptured) {
                for (let i = 0; i < btns.length; i++) {
                    if (btns[i].pressed && !calibration.lastBtnSample[i]) {
                        calibration.detectedButtons[step.button] = i;
                        calibration.buttonCaptured = true;
                        showToast(`✓ 抓到 button ${i}（放開後進到下一步）`, 'success');
                        break;
                    }
                }
            }
            // 持續更新 lastBtnSample
            calibration.lastBtnSample = btns.map(b => b.pressed);
        } else if (calibration.buttonCaptured) {
            // 已抓到按鍵 + 所有按鍵都放開 → 進到下一步
            calibration.buttonCaptured = false;
            calibration.lastBtnSample = btns.map(b => b.pressed);
            calibration.stepIdx++;
            renderCalibProgress();
            setTimeout(runCalibStep, 100);
            return;
        } else {
            // 還沒按過任何按鍵 — 持續更新 lastBtnSample
            calibration.lastBtnSample = btns.map(b => b.pressed);
        }
    }
}

function renderCalibResult() {
    const r = document.getElementById('calib-result');
    r.style.display = 'block';
    const c = gamepadConfig.center, rng = gamepadConfig.range;
    const fmt = (i) => `center=${c[i].toFixed(3)} / range=${rng[i].toFixed(3)}`;
    r.innerHTML = `
        <b>校正結果：</b><br>
        • 死區：<b>${gamepadConfig.deadzone.toFixed(3)}</b><br>
        • 左 X (旋轉 yaw)：<b>axes[0]</b> — ${fmt(0)}<br>
        • 左 Y (升降 throttle)：<b>axes[1]</b> — ${fmt(1)}<br>
        • 右 X (橫移 roll)：<b>axes[2]</b> — ${fmt(2)}<br>
        • 右 Y (前後 pitch)：<b>axes[3]</b> — ${fmt(3)}<br>
        • 起飛鍵：<b>button ${gamepadConfig.buttonMap.takeoff}</b>　
        降落：<b>${gamepadConfig.buttonMap.land}</b>　
        重置：<b>${gamepadConfig.buttonMap.reset}</b>
    `;
}

document.getElementById('calib-start-btn').addEventListener('click', startCalibration);
document.getElementById('calib-fab').addEventListener('click', startCalibration);
document.getElementById('calib-skip').addEventListener('click', skipCalibStep);
document.getElementById('calib-cancel').addEventListener('click', () => endCalibration(false));
document.getElementById('calib-save').addEventListener('click', () => endCalibration(true));

// v1.3 回家按鈕
document.getElementById('home-btn').addEventListener('click', goHome);

// v1.3 關卡教學 modal「開始」按鈕
document.getElementById('level-intro-start').addEventListener('click', () => {
    armLevelStart();
});

// v1.3 關卡選擇器
document.querySelectorAll('.level-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const levelId = btn.getAttribute('data-level');
        document.querySelectorAll('.level-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        loadLevel(levelId);
    });
});

// v1.3 計時器更新（每幀）
function updateLevelTimer() {
    if (!currentLevel || currentLevel.freeplay) return;  // 自由活動關不計時
    // levelStartTime=0 表示尚未開始（倒數前）→ 顯示 0.0s
    const elapsed = levelStartTime ? (Date.now() - levelStartTime) / 1000 : 0;
    const t = elapsed.toFixed(1);
    const timerEl = document.getElementById('level-timer');
    if (timerEl) timerEl.textContent = `⏱ ${t}s`;
    // 右上角徽章同步顯示同一個關卡計時（程式執行中由 updateStatus 顯示程式計時，不覆蓋）
    if (!programState.running) {
        const td = document.getElementById('timer-display');
        if (td) td.textContent = `${t}s`;
    }
}

// v1.3 靜音按鈕
document.getElementById('mute-btn').addEventListener('click', () => {
    const btn = document.getElementById('mute-btn');
    audioState.muted = !audioState.muted;
    setMute(audioState.muted);
    btn.textContent = audioState.muted ? '🔇 靜音中' : '🔊 音效';
    btn.classList.toggle('muted', audioState.muted);
    showToast(audioState.muted ? '🔇 音效關閉' : '🔊 音效開啟', '');
});

// 第一次互動後解鎖 Web Audio（音效用）。背景音樂改為預設關閉、由 #music-btn 手動開啟，
// 不再自動播放（避免一進場就放音樂）。
window.addEventListener('pointerdown', () => ensureAudio(), { once: false });
window.addEventListener('keydown', () => ensureAudio(), { once: false });

// 背景音樂開關
document.getElementById('music-btn').addEventListener('click', () => {
    const btn = document.getElementById('music-btn');
    if (audioState.bgmPlaying) {
        stopBGM();
        btn.textContent = '🎵 音樂：關';
        btn.classList.remove('active');
        showToast('🎵 背景音樂關閉', '');
    } else {
        startBGM();
        btn.textContent = '🎵 音樂：開';
        btn.classList.add('active');
        showToast('🎵 背景音樂開啟', '');
    }
});

// =============================================================================
// 5.7 v1.3 學生 WebSocket client（連到老師 server）
// =============================================================================
const wsState = {
    ws: null,
    connected: false,
    reconnectTimer: null,
};

function connectToTeacher() {
    // 已有「連線中(CONNECTING)」或「已連線(OPEN)」的 socket 就別再開一條，
    // 否則會建立第二條連線，且舊 socket 的 onopen 會送到新的、還在 CONNECTING 的 socket → InvalidStateError。
    if (wsState.ws && (wsState.ws.readyState === WebSocket.CONNECTING || wsState.ws.readyState === WebSocket.OPEN)) return;
    // WS 與頁面同主機同 port：HTTPS→wss、HTTP→ws（Railway 等雲端只開一個 port）
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${window.location.host}/`;
    let ws;
    try {
        ws = new WebSocket(url);
    } catch (e) {
        console.warn('WebSocket 連線失敗：', e);
        scheduleReconnect();
        return;
    }
    wsState.ws = ws;
    ws.onopen = () => {
        if (wsState.ws !== ws) return;  // 已被更新的連線取代，忽略
        wsState.connected = true;
        console.log('[v1.3 WS] 已連線到老師 server');
        // 註冊玩家（用本地 ws，確保送在「剛開啟的這條」連線上）
        if (player.name && player.emoji) {
            ws.send(JSON.stringify({
                type: 'register',
                name: player.name,
                emoji: player.emoji
            }));
        }
        showToast('🟢 已連線到課程', 'success');
    };
    ws.onmessage = (ev) => {
        try {
            const msg = JSON.parse(ev.data);
            if (msg.type === 'welcome') {
                console.log('[v1.3 WS] welcome', msg.id);
            } else if (msg.type === 'load_level' && chapterData) {
                const level = chapterData.levels.find(l => l.id === msg.levelId);
                if (level) {
                    loadLevel(msg.levelId);
                    showToast(`📋 老師載入關卡：${level.name}`, 'success');
                }
            } else if (msg.type === 'reset_all') {
                if (currentLevel) loadLevel(currentLevel.id);
                else resetDrone();
                showToast('🔄 老師廣播：重置', 'success');
            } else if (msg.type === 'race_start' && chapterData) {
                loadLevel(msg.levelId || '1-4');
                programState.raceStartTime = Date.now();
                programState.raceActive = true;
                showToast('🏁 比賽開始！', 'success');
            } else if (msg.type === 'show_message') {
                showToast(msg.text || '', msg.level || '');
            }
        } catch (e) {}
    };
    ws.onclose = () => {
        if (wsState.ws !== ws) return;  // 舊連線關閉，不觸發重連
        wsState.connected = false;
        console.log('[v1.3 WS] 連線關閉');
        scheduleReconnect();
    };
    ws.onerror = (e) => {
        console.warn('[v1.3 WS] 錯誤', e);
    };
}

function scheduleReconnect() {
    if (wsState.reconnectTimer) return;
    wsState.reconnectTimer = setTimeout(() => {
        wsState.reconnectTimer = null;
        connectToTeacher();
    }, 3000);
}

function wsReportComplete(levelId, timeMs) {
    if (!wsState.ws || wsState.ws.readyState !== WebSocket.OPEN) return;
    wsState.ws.send(JSON.stringify({
        type: 'complete_level',
        levelId,
        timeMs
    }));
}

function wsReportProgress(levelId) {
    if (!wsState.ws || wsState.ws.readyState !== WebSocket.OPEN) return;
    wsState.ws.send(JSON.stringify({
        type: 'progress',
        levelId
    }));
}

// 玩家設好名字後，自動連線 + 註冊
window.addEventListener('player-ready', connectToTeacher);

// 互動式 mapping — 點 PS4 視覺上的按鍵進入對映模式
document.querySelectorAll('#ps4-controller [data-key]').forEach(el => {
    el.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const key = el.getAttribute('data-key');
        if (!key) return;
        startMappingMode(key, el);
    });
    // 同時阻止 mousedown 預設行為（避免觸碰選取文字等）
    el.addEventListener('mousedown', (e) => e.preventDefault());
});

// 推桿的「對映」用 click 處理（hover 出現 📌）
['ps4-stick-left', 'ps4-stick-right'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const stick = id === 'ps4-stick-left' ? 'leftStick' : 'rightStick';
        startMappingMode(stick, el);
    });
});

// 重置映射按鈕
document.getElementById('gp-reset-btn').addEventListener('click', () => {
    if (!confirm('確定要清除所有自訂搖桿映射？')) return;
    try {
        localStorage.removeItem('creafly_gamepad_mapping');
        localStorage.removeItem('creafly_gamepad_calib');
    } catch (e) {}
    showToast('已重置 — 重新整理頁面', 'success');
    setTimeout(() => location.reload(), 1000);
});

// ESC 取消 listening 模式
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && mappingMode) {
        showToast('已取消對映', '');
        endMappingMode();
    }
});

// 設定模式 toggle（展開/收起 gamepad-hud）
document.getElementById('gp-settings-toggle').addEventListener('click', () => {
    const hud = document.getElementById('gamepad-hud');
    const btn = document.getElementById('gp-settings-toggle');
    if (!hud) return;
    const isOpen = hud.classList.toggle('show');
    btn.classList.toggle('active', isOpen);
    btn.textContent = isOpen ? '✕ 收起' : '⚙ 搖桿設定';
    if (isOpen) showToast('搖桿設定面板已展開', 'success');
});

// 全部重置按鈕
document.getElementById('gp-reset-all-btn').addEventListener('click', () => {
    if (!confirm('確定要清掉所有搖桿設定（localStorage）並重新整理？')) return;
    try {
        localStorage.removeItem('creafly_gamepad_calib');
        localStorage.removeItem('creafly_gamepad_mapping');
        localStorage.removeItem('creafly_app_version');
    } catch (e) {}
    showToast('已清除 — 重新整理中…', 'success');
    setTimeout(() => location.reload(), 500);
});

// ===== 即時 tuning（升降反轉 / 死區）=====
function refreshTuningUI() {
    const invT = document.getElementById('inv-throttle-btn');
    const dz   = document.getElementById('deadzone-slider');
    const dzv  = document.getElementById('deadzone-val');
    if (invT) {
        invT.textContent = gamepadConfig.invertThrottle ? '開' : '關';
        invT.classList.toggle('on', gamepadConfig.invertThrottle);
    }
    if (dz)   dz.value = gamepadConfig.deadzone;
    if (dzv)  dzv.textContent = gamepadConfig.deadzone.toFixed(2);
}
refreshTuningUI();

document.getElementById('inv-throttle-btn').addEventListener('click', () => {
    gamepadConfig.invertThrottle = !gamepadConfig.invertThrottle;
    saveGamepadConfig();
    refreshTuningUI();
    showToast(`升降反轉：${gamepadConfig.invertThrottle ? '開' : '關'} — 前推桿現在${gamepadConfig.invertThrottle ? '下降' : '上升'}`, 'success');
});
document.getElementById('deadzone-slider').addEventListener('input', (e) => {
    gamepadConfig.deadzone = parseFloat(e.target.value);
    document.getElementById('deadzone-val').textContent = gamepadConfig.deadzone.toFixed(2);
    saveGamepadConfig();
});

function saveGamepadConfig() {
    try {
        localStorage.setItem('creafly_gamepad_calib', JSON.stringify(gamepadConfig));
    } catch (e) {}
}

// URL 自動開校正（給截圖 / demo 用）
if (new URLSearchParams(location.search).has('calib')) {
    setTimeout(() => {
        if (!gamepadState.connected) {
            showToast('請先插上搖桿再開始校正', 'error');
            return;
        }
        startCalibration();
    }, 1500);
}

// Demo 模式：沒搖桿也強制開校正 overlay（給截圖用）
if (new URLSearchParams(location.search).has('calib-demo')) {
    setTimeout(() => {
        // 跳過 gamepadState.connected 檢查
        calibration.active = true;
        calibration.stepIdx = 0;
        calibration.samples = [];
        document.getElementById('calib-overlay').classList.add('show');
        renderCalibProgress();
        runCalibStep();
    }, 1500);
}

// 開發模式：URL 加 ?autorun 可自動執行程式（給截圖用）
if (new URLSearchParams(location.search).has('autorun')) {
    setTimeout(() => {
        showToast('Auto-run 啟動', '');
        document.getElementById('btn-run').click();
    }, 1500);
}

// 對外 debug
window._creafly = {
    droneState, missionRings, workspace, programState,
    loadLevel, scene,
    get currentLevel() { return currentLevel; },
    HOME_POSITION,
};
