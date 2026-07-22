const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const server = http.createServer((req, res) => {
    // 去掉 query string
    const urlPath = req.url.split('?')[0];
    let filePath = '.' + urlPath;
    if (filePath === './' || filePath === '.') {
        filePath = './index.html';
    }
    if (urlPath === '/teacher' || urlPath === '/teacher/') {
        filePath = './teacher.html';
    }
    if (urlPath === '/lesson' || urlPath === '/lesson/') {
        filePath = './lesson.html';   // 老師專用解答投影頁（通關碼保護）
    }

    // 🎮 搖桿測試頁（controllertestweb/）— 整個目錄掛在 /gamepad/ 下，相對路徑才能正確解析
    if (urlPath === '/gamepad') {
        res.writeHead(302, { Location: '/gamepad/' });
        res.end();
        return;
    }
    if (urlPath === '/gamepad/') {
        filePath = './controllertestweb/index.html';
    } else if (urlPath.startsWith('/gamepad/')) {
        filePath = './controllertestweb/' + urlPath.slice('/gamepad/'.length);
    }

    const extname = path.extname(filePath);
    const contentType = {
        '.html': 'text/html; charset=utf-8',
        '.js':   'text/javascript; charset=utf-8',
        '.css':  'text/css; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.png':  'image/png',
        '.svg':  'image/svg+xml',
        '.ico':  'image/x-icon',
        '.mp3':  'audio/mpeg',
        '.wav':  'audio/wav',
        '.hdr':  'application/octet-stream',  // RGBE / Radiance HDR
        '.glb':  'model/gltf-binary',
    }[extname] || 'text/plain; charset=utf-8';

    fs.readFile(filePath, (error, content) => {
        if (error) {
            if(error.code === 'ENOENT') {
                res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end('404 Not Found: ' + filePath);
            } else {
                res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end('500 Server error: ' + error.code);
            }
        } else {
            res.writeHead(200, {
                'Content-Type': contentType,
                'Cache-Control': 'no-store, no-cache, must-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0',
            });
            res.end(content, 'utf-8');
        }
    });
});

// ===== v1.3 WebSocket：學生 ↔ 老師 =====
// 與 HTTP 共用同一個 server / port（Railway 等 PaaS 只對外開一個 port）。
// 用 URL path 區分老師 / 學生（見下方 connection handler）。
const wss = new WebSocketServer({ server });
const students = new Map();   // ws → { name, emoji, level, time, connected }
const teachers = new Set();   // 老師 dashboard 連線
let studentCounter = 0;

function broadcastToTeachers(msg) {
    const data = JSON.stringify(msg);
    for (const t of teachers) {
        if (t.readyState === 1) t.send(data);
    }
}
function studentListPayload() {
    return {
        type: 'student_list',
        students: Array.from(students.values()).map(s => ({
            id: s.id,
            name: s.name,
            emoji: s.emoji,
            connected: s.ws.readyState === 1,
            level: s.level,
            time: s.time,
        }))
    };
}
function broadcastToStudents(msg) {
    const data = JSON.stringify(msg);
    for (const s of students.values()) {
        if (s.ws.readyState === 1) s.ws.send(data);
    }
}

// =====================================================================
// 大亂鬥 Arena（多人即時搶氣球）—— 伺服器權威
// =====================================================================
const ARENA = { status: 'idle', mode: 'balloon', field: 'grid', balloons: [], endTime: 0, durationSec: 180, ghostCount: 1, winner: null };
const ARENA_BALLOON_COUNT = 50;
const ARENA_BOUNDS = { x: 22, z: 22, ymin: 1.5, ymax: 10 };
const ARENA_RESPAWN_MS = 2500;
const ARENA_CATCH_DIST = 2.2;  // 鬼抓人：鬼撞到逃跑者的距離（鬼較大）
const ARENA_STUN_MS = 3000;        // 鬼抓人：被抓後暈眩＋傳送回出生點的時間，時間到自動復活（不淘汰，可以一直玩）
const ARENA_INVINCIBLE_MS = 2000;  // 鬼抓人：暈眩結束、傳送回出生點之後，額外的無敵時間（可以動，但鬼抓不到），讓他有機會跑走
const ARENA_TAG_WIN_MULT = 3;      // 鬼隊勝利門檻：全場總抓捕數 >= 跑者人數 × 此倍數才算鬼隊贏，否則跑者隊贏
function isStunned(s) { return !!(s.stunnedUntil && Date.now() < s.stunnedUntil); }
function isInvincible(s) { return !!(s.invincibleUntil && Date.now() < s.invincibleUntil); }  // 暈眩中也算無敵（涵蓋整段抓不到的時間）

function arenaRandPos() {
    return {
        x: +((Math.random() * 2 - 1) * ARENA_BOUNDS.x).toFixed(2),
        y: +(ARENA_BOUNDS.ymin + Math.random() * (ARENA_BOUNDS.ymax - ARENA_BOUNDS.ymin)).toFixed(2),
        z: +((Math.random() * 2 - 1) * ARENA_BOUNDS.z).toFixed(2),
    };
}
function arenaInitBalloons() {
    ARENA.balloons = [];
    for (let i = 0; i < ARENA_BALLOON_COUNT; i++) ARENA.balloons.push({ id: i, ...arenaRandPos(), alive: true, respawnAt: 0 });
}
arenaInitBalloons();

const arenaPlayers = () => [...students.values()].filter(s => s.arena && s.ws.readyState === 1);
function broadcastArena(msg) {
    const data = JSON.stringify(msg);
    for (const s of arenaPlayers()) s.ws.send(data);
}
function arenaRanking() {
    return arenaPlayers().map(s => ({ id: s.id, name: s.name, emoji: s.emoji, score: s.score || 0, role: s.role || 'runner', stunned: isStunned(s), invincible: isInvincible(s), caughtCount: s.caughtCount || 0 }))
        .sort((a, b) => b.score - a.score);
}
// 把所有大亂鬥玩家平均散佈在一個圓上，避免 16 台疊在同一個出生點
function assignArenaSpawns() {
    const players = arenaPlayers();
    const n = players.length;
    const r = n <= 1 ? 0 : Math.min(20, 9 + n * 0.6);
    players.forEach((s, i) => {
        const ang = (i / Math.max(1, n)) * Math.PI * 2;
        s.spawnX = +(Math.cos(ang) * r).toFixed(2);
        s.spawnZ = +(Math.sin(ang) * r).toFixed(2);
    });
}
function arenaSpawns() {
    return arenaPlayers().map(s => ({ id: s.id, x: s.spawnX || 0, z: s.spawnZ || 0 }));
}
function arenaPlayerInfo(s) {
    return { id: s.id, name: s.name, emoji: s.emoji, score: s.score || 0, role: s.role || 'runner', stunned: isStunned(s), invincible: isInvincible(s), caughtCount: s.caughtCount || 0 };
}
function arenaSnapshot() {
    return {
        type: 'arena_state',
        status: ARENA.status,
        mode: ARENA.mode,
        field: ARENA.field,
        endTime: ARENA.endTime,
        durationSec: ARENA.durationSec,
        balloons: ARENA.mode === 'balloon' ? ARENA.balloons.filter(b => b.alive).map(b => ({ id: b.id, x: b.x, y: b.y, z: b.z })) : [],
        players: arenaPlayers().map(arenaPlayerInfo),
        spawns: arenaSpawns(),
    };
}
// 鬼抓人：開賽時隨機指派 ghostCount 個鬼，其餘為逃跑者
function assignArenaRoles() {
    const players = arenaPlayers();
    const n = players.length;
    const gc = Math.max(1, Math.min(ARENA.ghostCount || 1, Math.max(1, n - 1)));
    // 洗牌
    const idx = players.map((_, i) => i);
    for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
    const ghostSet = new Set(idx.slice(0, gc));
    players.forEach((s, i) => { s.role = ghostSet.has(i) ? 'ghost' : 'runner'; s.stunnedUntil = 0; s.invincibleUntil = 0; s.caughtCount = 0; });
}
function broadcastArenaScores() {
    const msg = { type: 'arena_scores', scores: arenaRanking(), status: ARENA.status, endTime: ARENA.endTime, mode: ARENA.mode, field: ARENA.field };
    broadcastArena(msg);
    broadcastToTeachers(msg);
}
function arenaStart(durationSec, mode, ghostCount, field) {
    ARENA.durationSec = durationSec;
    ARENA.mode = (mode === 'tag') ? 'tag' : 'balloon';
    ARENA.field = (field === 'playground') ? 'playground' : 'grid';
    ARENA.ghostCount = ghostCount || 1;
    ARENA.winner = null;
    for (const s of students.values()) if (s.arena) { s.score = 0; s.role = 'runner'; s.stunnedUntil = 0; s.invincibleUntil = 0; s.caughtCount = 0; }
    arenaInitBalloons();
    assignArenaSpawns();   // 指派各玩家的出生點（散佈在圓上）
    ARENA.status = 'countdown';
    broadcastArena(arenaSnapshot());
    let n = 3;
    const tick = () => {
        if (n > 0) { broadcastArena({ type: 'arena_countdown', n }); n--; setTimeout(tick, 1000); }
        else {
            if (ARENA.mode === 'tag') assignArenaRoles();  // 倒數結束才指派鬼（GO 才變身）
            ARENA.status = 'running';
            ARENA.endTime = Date.now() + durationSec * 1000;
            broadcastArena({ type: 'arena_go', mode: ARENA.mode, field: ARENA.field, endTime: ARENA.endTime, spawns: arenaSpawns(), players: arenaPlayers().map(arenaPlayerInfo) });
            broadcastArenaScores();
            console.log(`[Arena] 開始！${ARENA.mode} ${durationSec}s，${arenaPlayers().length} 人，鬼 ${ARENA.mode === 'tag' ? arenaPlayers().filter(s => s.role === 'ghost').length : 0}`);
        }
    };
    tick();
}
function arenaEnd(winner) {
    ARENA.status = 'ended';
    ARENA.winner = winner;
    const msg = { type: 'arena_end', mode: ARENA.mode, winner, ranking: arenaRanking(), players: arenaPlayers().map(arenaPlayerInfo) };
    broadcastArena(msg);
    broadcastToTeachers(msg);   // 老師後台也要收到結束/勝負
    broadcastArenaScores();
    console.log(`[Arena] 結束：${ARENA.mode} winner=${winner}`);
}

// =====================================================================
// ⚽ 無人機足球 3v3（多人連線對戰）—— 伺服器權威（T-501 骨幹）
//   與大亂鬥 Arena 並存、旗標獨立（s.soccer vs s.arena）。
//   球＝無人機本身（無共用球）；只有前鋒穿對方門得分（計分在 T-503）。
//   場地常數需與 client（T-502）同一份：長軸 z（兩門連線）、寬 x、中線 z=0。
// =====================================================================
const SOCCER_FIELD = { halfX: 7, halfZ: 14, top: 12, goalZ: 10, goalY: 9, goalR: 1.2, midZ: 0 };
const SOCCER_DURATION_DEFAULT = 180;   // 1 局 3 分鐘（測試可送較短 durationSec）
// 每隊站位端 / 攻門 / 守門（z 軸）：藍隊站 -z 端、攻 +z 門；紅隊站 +z 端、攻 -z 門
const SOCCER_TEAMS = {
    blue: { stationZ: -SOCCER_FIELD.halfZ, attackGoalZ: +SOCCER_FIELD.goalZ, defendGoalZ: -SOCCER_FIELD.goalZ },
    red:  { stationZ: +SOCCER_FIELD.halfZ, attackGoalZ: -SOCCER_FIELD.goalZ, defendGoalZ: +SOCCER_FIELD.goalZ },
};
const SOCCER = {
    status: 'idle',            // idle | countdown | running | done
    mode: '1x3min',
    endTime: 0,
    durationSec: SOCCER_DURATION_DEFAULT,
    scores: { blue: 0, red: 0 },
    armed: { blue: true, red: true },   // 半場重置用（T-503 計分時讀/寫）
    winner: null,
};

const soccerPlayers = () => [...students.values()].filter(s => s.soccer && s.ws.readyState === 1);
const soccerTeam = (team) => soccerPlayers().filter(s => s.team === team);
function broadcastSoccer(msg) {
    const data = JSON.stringify(msg);
    for (const s of soccerPlayers()) s.ws.send(data);
}
// 自動平均分隊：新加入者補進人少的隊（藍/紅人數差 ≤ 1）
function autoAssignTeam(s) {
    const others = soccerPlayers().filter(p => p !== s);
    const blue = others.filter(p => p.team === 'blue').length;
    const red = others.filter(p => p.team === 'red').length;
    s.team = (blue <= red) ? 'blue' : 'red';
}
// 確保某隊恰 1 名前鋒：0 名→補第一人；>1 名→只留第一個
function ensureStriker(team) {
    const members = soccerTeam(team);
    if (!members.length) return;
    const strikers = members.filter(s => s.striker);
    if (strikers.length === 1) return;
    const keep = strikers[0] || members[0];
    members.forEach(s => { s.striker = (s === keep); });
}
function soccerStrikerOf(team) { return soccerTeam(team).find(s => s.striker); }
// 老師指定前鋒（每隊強制恰 1 名）
function setStriker(studentId) {
    const s = soccerPlayers().find(p => p.id === studentId);
    if (!s || !s.team) return false;
    soccerTeam(s.team).forEach(p => { p.striker = (p === s); });
    return true;
}
// 老師指定隊伍（藍/紅）：手動分隊，取代自動平均分隊；換隊時原隊 / 新隊都要重新確保前鋒恰 1 名
function setTeam(studentId, team) {
    if (team !== 'blue' && team !== 'red') return false;
    const s = soccerPlayers().find(p => p.id === studentId);
    if (!s || s.team === team) return false;
    const oldTeam = s.team;
    s.team = team;
    s.striker = false;
    if (oldTeam) ensureStriker(oldTeam);
    ensureStriker(team);
    return true;
}
// 出生點：前鋒站中間（x≈0），防守沿 x 兩側排開；皆在自隊站位端、略內縮
function assignSoccerSpawns() {
    for (const team of ['blue', 'red']) {
        const members = soccerTeam(team);
        const z = +(SOCCER_TEAMS[team].stationZ * 0.85).toFixed(2);
        const striker = members.find(s => s.striker);
        const defenders = members.filter(s => !s.striker);
        if (striker) { striker.spawnX = 0; striker.spawnZ = z; }
        defenders.forEach((s, i) => {
            const side = (i % 2 === 0) ? -1 : 1;
            const mag = SOCCER_FIELD.halfX * (0.5 + 0.35 * Math.floor(i / 2));
            s.spawnX = +(side * mag).toFixed(2);
            s.spawnZ = z;
        });
    }
}
function soccerPlayerInfo(s) {
    return { id: s.id, name: s.name, emoji: s.emoji, team: s.team || null, striker: !!s.striker };
}
function soccerSpawns() {
    return soccerPlayers().map(s => ({ id: s.id, x: s.spawnX || 0, z: s.spawnZ || 0 }));
}
function soccerSnapshot() {
    return {
        type: 'soccer_state',
        status: SOCCER.status, mode: SOCCER.mode,
        endTime: SOCCER.endTime, durationSec: SOCCER.durationSec,
        scores: SOCCER.scores, armed: SOCCER.armed, winner: SOCCER.winner,
        players: soccerPlayers().map(soccerPlayerInfo),
        spawns: soccerSpawns(),
        field: SOCCER_FIELD,
    };
}
function broadcastSoccerState() {
    const snap = soccerSnapshot();
    broadcastSoccer(snap);
    broadcastToTeachers(snap);
}
function broadcastSoccerScores() {
    const msg = { type: 'soccer_scores', scores: SOCCER.scores, armed: SOCCER.armed, status: SOCCER.status, endTime: SOCCER.endTime };
    broadcastSoccer(msg);
    broadcastToTeachers(msg);
}
function soccerJoin(s) {
    s.soccer = true;
    s.arena = false;                 // 與大亂鬥互斥
    if (s.team !== 'blue' && s.team !== 'red') autoAssignTeam(s);
    if (s.striker === undefined) s.striker = false;
    ensureStriker(s.team);
    s.ws.send(JSON.stringify(soccerSnapshot()));
    broadcastSoccerState();
    console.log(`[Soccer] ${s.name}${s.emoji} 加入 → ${s.team}${s.striker ? '（前鋒）' : ''}`);
}
function soccerLeave(s) {
    const wasStriker = s.striker, team = s.team;
    s.soccer = false; s.striker = false;
    if (wasStriker && team) ensureStriker(team);   // 前鋒離開 → 遞補
    broadcastSoccerState();
}
function soccerStart(durationSec) {
    SOCCER.durationSec = Math.max(5, durationSec || SOCCER_DURATION_DEFAULT);
    SOCCER.scores = { blue: 0, red: 0 };
    SOCCER.armed = { blue: true, red: true };
    SOCCER.winner = null;
    ensureStriker('blue'); ensureStriker('red');   // 開賽前未指定的隊 → 自動補第一人
    assignSoccerSpawns();
    SOCCER.status = 'countdown';
    broadcastSoccerState();
    let n = 3;
    const tick = () => {
        if (SOCCER.status !== 'countdown') return;   // 中途被 reset → 停止倒數
        if (n > 0) { broadcastSoccer({ type: 'soccer_countdown', n }); n--; setTimeout(tick, 1000); }
        else {
            SOCCER.status = 'running';
            SOCCER.endTime = Date.now() + SOCCER.durationSec * 1000;
            broadcastSoccer({ type: 'soccer_go', endTime: SOCCER.endTime, spawns: soccerSpawns(), players: soccerPlayers().map(soccerPlayerInfo), field: SOCCER_FIELD });
            broadcastSoccerScores();
            console.log(`[Soccer] 開始！${SOCCER.durationSec}s，藍 ${soccerTeam('blue').length} 紅 ${soccerTeam('red').length}`);
        }
    };
    tick();
}
function soccerEnd(reason) {
    SOCCER.status = 'done';
    const { blue, red } = SOCCER.scores;
    SOCCER.winner = blue > red ? 'blue' : (red > blue ? 'red' : 'draw');
    const msg = { type: 'soccer_end', reason, winner: SOCCER.winner, scores: SOCCER.scores, players: soccerPlayers().map(soccerPlayerInfo) };
    broadcastSoccer(msg);
    broadcastToTeachers(msg);
    broadcastSoccerScores();
    console.log(`[Soccer] 結束：藍 ${blue} : ${red} 紅 → winner=${SOCCER.winner}（${reason}）`);
}
// 重設賽局 / 開新場：回 idle、比分歸零、清前鋒；clearTeams 連分隊重洗
function soccerReset(clearTeams) {
    SOCCER.status = 'idle';
    SOCCER.scores = { blue: 0, red: 0 };
    SOCCER.armed = { blue: true, red: true };
    SOCCER.winner = null;
    SOCCER.endTime = 0;
    const players = soccerPlayers();
    players.forEach(s => { s.striker = false; if (clearTeams) s.team = null; });
    if (clearTeams) players.forEach((s, i) => { s.team = (i % 2 === 0) ? 'blue' : 'red'; });
    broadcastSoccerState();
    console.log(`[Soccer] 重設${clearTeams ? '（重新分隊）' : ''}，在場 ${players.length} 人`);
}

// 伺服器 tick：氣球重生、結束判定、廣播所有玩家位置（~12Hz）
setInterval(() => {
    const now = Date.now();
    if (ARENA.status === 'running') {
        if (ARENA.mode === 'balloon') {
            for (const b of ARENA.balloons) {
                if (!b.alive && b.respawnAt && now >= b.respawnAt) {
                    Object.assign(b, arenaRandPos(), { alive: true, respawnAt: 0 });
                    broadcastArena({ type: 'arena_balloon', id: b.id, alive: true, x: b.x, y: b.y, z: b.z });
                }
            }
            if (now >= ARENA.endTime) arenaEnd('time');
        } else if (ARENA.mode === 'tag') {
            // 鬼抓人：鬼撞到逃跑者 → 暈眩＋傳送回出生點，不淘汰、時間到自動復活繼續玩
            const ps = arenaPlayers();
            const ghosts = ps.filter(s => s.role === 'ghost');
            const runners = ps.filter(s => s.role === 'runner');
            for (const r of runners) {
                if (isInvincible(r)) continue;  // 暈眩中或剛復活的無敵時間內，都抓不到
                for (const g of ghosts) {
                    const dx = (r.ax || 0) - (g.ax || 0), dy = (r.ay || 0) - (g.ay || 0), dz = (r.az || 0) - (g.az || 0);
                    if (dx * dx + dy * dy + dz * dz < ARENA_CATCH_DIST * ARENA_CATCH_DIST) {
                        r.stunnedUntil = now + ARENA_STUN_MS;
                        r.invincibleUntil = now + ARENA_STUN_MS + ARENA_INVINCIBLE_MS;
                        r.caughtCount = (r.caughtCount || 0) + 1;
                        g.score = (g.score || 0) + 1;  // 鬼的抓捕數
                        broadcastArena({ type: 'arena_caught', id: r.id, by: g.id, byName: g.name, stunMs: ARENA_STUN_MS });
                        if (r.ws.readyState === 1) r.ws.send(JSON.stringify({ type: 'arena_respawn', x: r.spawnX || 0, z: r.spawnZ || 0, stunMs: ARENA_STUN_MS, invincibleMs: ARENA_INVINCIBLE_MS }));
                        broadcastArenaScores();
                        break;
                    }
                }
            }
            // 勝負：時間到才判定 —— 鬼隊總抓捕數達門檻（跑者人數 × 倍數）算鬼隊贏，否則跑者隊贏
            if (now >= ARENA.endTime) {
                const totalCatches = ghosts.reduce((sum, g) => sum + (g.score || 0), 0);
                const target = Math.max(1, runners.length * ARENA_TAG_WIN_MULT);
                arenaEnd(totalCatches >= target ? 'ghosts' : 'runners');
            }
        }
    }
    const players = arenaPlayers();
    if (players.length) {
        broadcastArena({ type: 'arena_players', players: players.map(s => ({ id: s.id, name: s.name, emoji: s.emoji, role: s.role || 'runner', stunned: isStunned(s), invincible: isInvincible(s), x: s.ax || 0, y: s.ay || 0.4, z: s.az || 0, yaw: s.ayaw || 0 })) });
    }
    // ⚽ 足球 tick：半場重置 + 時間到判勝 + 廣播所有足球玩家位置（隊色/前鋒分身用）
    if (SOCCER.status === 'running') {
        // 半場重置：得分後 armed=false 的隊，其前鋒過中線回自家半場 → 恢復可得分
        for (const team of ['blue', 'red']) {
            if (SOCCER.armed[team]) continue;
            const st = soccerStrikerOf(team);
            if (!st) continue;
            const ownHalfNeg = SOCCER_TEAMS[team].stationZ < 0;   // 藍隊自家半場 z<0、紅隊 z>0
            if (ownHalfNeg ? ((st.sz || 0) < 0) : ((st.sz || 0) > 0)) { SOCCER.armed[team] = true; broadcastSoccerScores(); }
        }
    }
    if (SOCCER.status === 'running' && now >= SOCCER.endTime) soccerEnd('time');
    const sp = soccerPlayers();
    if (sp.length) {
        broadcastSoccer({ type: 'soccer_players', players: sp.map(s => ({ id: s.id, name: s.name, emoji: s.emoji, team: s.team || null, striker: !!s.striker, x: s.sx || 0, y: s.sy || 0.4, z: s.sz || 0, yaw: s.syaw || 0 })) });
    }
}, 80);

wss.on('connection', (ws, req) => {
    // 簡單區分：URL path /student vs /teacher
    const path = req.url.split('?')[0];
    if (path === '/teacher') {
        teachers.add(ws);
        ws.send(JSON.stringify(studentListPayload()));
        ws.on('close', () => teachers.delete(ws));
        ws.on('message', (raw) => {
            try {
                const msg = JSON.parse(raw);
                if (msg.type === 'broadcast') {
                    // 老師廣播：load_level / reset_all / race_start / show_message
                    broadcastToStudents(msg.payload);
                } else if (msg.type === 'arena_start') {
                    // 老師開始大亂鬥（mode: balloon | tag；field: grid | playground）
                    arenaStart(Math.max(30, msg.durationSec || 180), msg.mode, msg.ghostCount, msg.field);
                } else if (msg.type === 'arena_state_req') {
                    ws.send(JSON.stringify(arenaSnapshot()));
                } else if (msg.type === 'soccer_start') {
                    soccerStart(msg.durationSec);
                } else if (msg.type === 'soccer_state_req') {
                    ws.send(JSON.stringify(soccerSnapshot()));
                } else if (msg.type === 'soccer_set_striker') {
                    if (setStriker(msg.studentId)) broadcastSoccerState();
                } else if (msg.type === 'soccer_set_team') {
                    if (setTeam(msg.studentId, msg.team)) broadcastSoccerState();
                } else if (msg.type === 'soccer_reset') {
                    soccerReset(!!msg.clearTeams);
                }
            } catch (e) {}
        });
        return;
    }
    // 學生
    const id = 's' + (++studentCounter);
    const s = { id, ws, name: '?', emoji: '?', level: null, time: null };
    students.set(ws, s);
    ws.send(JSON.stringify({ type: 'welcome', id }));
    broadcastToTeachers(studentListPayload());

    ws.on('message', (raw) => {
        try {
            const msg = JSON.parse(raw);
            if (msg.type === 'register') {
                s.name = msg.name;
                s.emoji = msg.emoji;
                // 同名 = 重連：移除舊的同名連線（避免老師後台堆積離線幽靈列），
                // 並沿用舊進度（學生重新整理後排行/成績不會消失）。
                for (const [otherWs, other] of students) {
                    if (other !== s && other.name === s.name) {
                        if (other.level != null && s.level == null) {
                            s.level = other.level;
                            s.time = other.time;
                        }
                        students.delete(otherWs);
                        try { otherWs.close(4000, 'replaced by reconnect'); } catch (e) {}
                        console.log(`[WS] ${s.name}${s.emoji} 重連，取代舊連線 ${other.id}`);
                    }
                }
                console.log(`[WS] 學生上線：${s.name}${s.emoji} (${s.id})`);
                broadcastToTeachers(studentListPayload());
            } else if (msg.type === 'complete_level') {
                s.level = msg.levelId;
                s.time = msg.timeMs;
                console.log(`[WS] ${s.name}${s.emoji} 完成 ${s.level} 用時 ${(s.time/1000).toFixed(1)}s`);
                broadcastToTeachers({
                    type: 'student_update',
                    student: { id: s.id, name: s.name, emoji: s.emoji, level: s.level, time: s.time }
                });
            } else if (msg.type === 'progress') {
                s.level = msg.levelId;
                broadcastToTeachers({
                    type: 'student_update',
                    student: { id: s.id, name: s.name, emoji: s.emoji, level: s.level, time: s.time }
                });
            } else if (msg.type === 'arena_join') {
                s.arena = true;
                if (s.score == null) s.score = 0;
                s.ax = 0; s.ay = 0.4; s.az = 0; s.ayaw = 0;
                ws.send(JSON.stringify(arenaSnapshot()));
                broadcastArenaScores();
            } else if (msg.type === 'arena_leave') {
                s.arena = false;
                broadcastArenaScores();
            } else if (msg.type === 'arena_pos') {
                s.ax = msg.x; s.ay = msg.y; s.az = msg.z; s.ayaw = msg.yaw;
            } else if (msg.type === 'arena_pop') {
                if (ARENA.status === 'running' && s.arena) {
                    const b = ARENA.balloons[msg.id];
                    if (b && b.alive) {
                        b.alive = false;
                        b.respawnAt = Date.now() + ARENA_RESPAWN_MS;
                        s.score = (s.score || 0) + 1;
                        broadcastArena({ type: 'arena_balloon', id: b.id, alive: false });
                        broadcastArenaScores();
                    }
                }
            } else if (msg.type === 'soccer_join') {
                soccerJoin(s);
            } else if (msg.type === 'soccer_leave') {
                soccerLeave(s);
            } else if (msg.type === 'soccer_pos') {
                s.sx = msg.x; s.sy = msg.y; s.sz = msg.z; s.syaw = msg.yaw;
            } else if (msg.type === 'soccer_goal') {
                // T-503 計分：伺服器權威驗證 — 必須是前鋒、該隊 armed、且位置確在對方門環內
                if (SOCCER.status === 'running' && s.soccer && s.striker && s.team && SOCCER.armed[s.team]) {
                    const cfg = SOCCER_TEAMS[s.team];
                    const nearGoal = Math.abs((s.sz || 0) - cfg.attackGoalZ) < 1.0
                        && Math.abs(s.sx || 0) < SOCCER_FIELD.goalR
                        && Math.abs((s.sy || 0) - SOCCER_FIELD.goalY) < SOCCER_FIELD.goalR;
                    if (nearGoal) {
                        SOCCER.scores[s.team] = (SOCCER.scores[s.team] || 0) + 1;
                        SOCCER.armed[s.team] = false;   // 半場重置：前鋒須過中線才能再得分
                        const ok = { type: 'soccer_goal_ok', team: s.team, by: s.id, byName: s.name, scores: SOCCER.scores };
                        broadcastSoccer(ok); broadcastToTeachers(ok); broadcastSoccerScores();
                        console.log(`[Soccer] ⚽ ${s.name}（${s.team}）進球！藍 ${SOCCER.scores.blue} : ${SOCCER.scores.red} 紅`);
                    }
                }
            }
        } catch (e) {}
    });
    ws.on('close', () => {
        console.log(`[WS] 學生斷線：${s.name}${s.emoji}`);
        const wasArena = s.arena;
        const wasSoccer = s.soccer, wasStriker = s.striker, soccerTeamId = s.team;
        students.delete(ws);
        broadcastToTeachers(studentListPayload());
        if (wasArena) broadcastArenaScores();  // 更新大亂鬥排行（其他人會在下個 tick 移除其分身）
        if (wasSoccer) {
            s.soccer = false; s.striker = false;
            if (wasStriker && soccerTeamId) ensureStriker(soccerTeamId);   // 前鋒斷線 → 遞補
            broadcastSoccerState();
        }
    });
});

const port = process.env.PORT || 3000;
server.listen(port, '0.0.0.0', () => {
    console.log(`CREAFLY Drone Simulator running at http://localhost:${port}/`);
    console.log(`[v1.3] 老師後台：http://localhost:${port}/teacher`);
    console.log(`[v1.3] WebSocket 與 HTTP 共用 port ${port}（path: / 學生、/teacher 老師）`);
});
