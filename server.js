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
            }
        } catch (e) {}
    });
    ws.on('close', () => {
        console.log(`[WS] 學生斷線：${s.name}${s.emoji}`);
        students.delete(ws);
        broadcastToTeachers(studentListPayload());
    });
});

const port = process.env.PORT || 3000;
server.listen(port, '0.0.0.0', () => {
    console.log(`CREAFLY Drone Simulator running at http://localhost:${port}/`);
    console.log(`[v1.3] 老師後台：http://localhost:${port}/teacher`);
    console.log(`[v1.3] WebSocket 與 HTTP 共用 port ${port}（path: / 學生、/teacher 老師）`);
});
