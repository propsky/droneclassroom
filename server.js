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
    return arenaPlayers().map(s => ({ id: s.id, name: s.name, emoji: s.emoji, score: s.score || 0, role: s.role || 'runner', eaten: !!s.eaten }))
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
    return { id: s.id, name: s.name, emoji: s.emoji, score: s.score || 0, role: s.role || 'runner', eaten: !!s.eaten };
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
    players.forEach((s, i) => { s.role = ghostSet.has(i) ? 'ghost' : 'runner'; s.eaten = false; });
}
function arenaAliveRunners() { return arenaPlayers().filter(s => s.role === 'runner' && !s.eaten); }
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
    for (const s of students.values()) if (s.arena) { s.score = 0; s.role = 'runner'; s.eaten = false; }
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
            // 鬼抓人：鬼撞到逃跑者 → 逃跑者被吃掉
            const ps = arenaPlayers();
            const ghosts = ps.filter(s => s.role === 'ghost');
            for (const r of ps) {
                if (r.role !== 'runner' || r.eaten) continue;
                for (const g of ghosts) {
                    const dx = (r.ax || 0) - (g.ax || 0), dy = (r.ay || 0) - (g.ay || 0), dz = (r.az || 0) - (g.az || 0);
                    if (dx * dx + dy * dy + dz * dz < ARENA_CATCH_DIST * ARENA_CATCH_DIST) {
                        r.eaten = true;
                        g.score = (g.score || 0) + 1;  // 鬼的抓捕數
                        broadcastArena({ type: 'arena_eaten', id: r.id, by: g.id, byName: g.name });
                        broadcastArenaScores();
                        break;
                    }
                }
            }
            // 勝負
            if (arenaAliveRunners().length === 0) arenaEnd('ghosts');   // 全被吃 → 鬼勝
            else if (now >= ARENA.endTime) arenaEnd('runners');         // 時間到還有人活 → 人勝
        }
    }
    const players = arenaPlayers();
    if (players.length) {
        broadcastArena({ type: 'arena_players', players: players.map(s => ({ id: s.id, name: s.name, emoji: s.emoji, role: s.role || 'runner', eaten: !!s.eaten, x: s.ax || 0, y: s.ay || 0.4, z: s.az || 0, yaw: s.ayaw || 0 })) });
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
            }
        } catch (e) {}
    });
    ws.on('close', () => {
        console.log(`[WS] 學生斷線：${s.name}${s.emoji}`);
        const wasArena = s.arena;
        students.delete(ws);
        broadcastToTeachers(studentListPayload());
        if (wasArena) broadcastArenaScores();  // 更新大亂鬥排行（其他人會在下個 tick 移除其分身）
    });
});

const port = process.env.PORT || 3000;
server.listen(port, '0.0.0.0', () => {
    console.log(`CREAFLY Drone Simulator running at http://localhost:${port}/`);
    console.log(`[v1.3] 老師後台：http://localhost:${port}/teacher`);
    console.log(`[v1.3] WebSocket 與 HTTP 共用 port ${port}（path: / 學生、/teacher 老師）`);
});
