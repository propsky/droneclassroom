// 本機假橋接：讓 droneClient 在沒有飛機、沒有 stm32 橋接時走同一條 WebSocket JSON。
// 不會連真機。正式環境的網頁（例如 Cloudflare Pages）也連不到這台，橋接必須開在學生自己的電腦。
//
//   pnpm --filter @creafly/simulator fake-bridge
//   pnpm --filter @creafly/simulator fake-bridge -- --no-aircraft
//   pnpm --filter @creafly/simulator fake-bridge -- --lowbat
//   pnpm --filter @creafly/simulator fake-bridge -- --abort-at=2
//   pnpm --filter @creafly/simulator fake-bridge -- --timeout-at=1
//   pnpm --filter @creafly/simulator fake-bridge -- --slow
//
// 第一個連上的客戶端是控制者；之後的連線只能看遙測，指令會被忽略。
import { WebSocketServer } from 'ws';

const PORT = 8765;
const args = process.argv.slice(2);
const has = (name) => args.includes(`--${name}`);
const num = (name) => {
  const hit = args.find((arg) => arg.startsWith(`--${name}=`));
  return hit ? Number(hit.slice(name.length + 3)) : 0;
};

const noAircraft = has('no-aircraft');
const lowbat = has('lowbat');
const abortAt = num('abort-at');
const timeoutAt = num('timeout-at');
const slow = has('slow');
const MOTION = new Set(['takeoff', 'land', 'hover', 'move', 'yaw']);

const wss = new WebSocketServer({ port: PORT, path: '/ws' });
const sockets = new Set();
let controller = null;
let motionCount = 0;

function send(ws, obj) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}

function later(ms, fn) {
  const timer = setTimeout(fn, ms);
  timer.unref?.();
}

wss.on('connection', (ws) => {
  sockets.add(ws);
  const isController = controller === null;
  if (isController) controller = ws;
  const role = isController ? 'controller' : 'viewer';
  console.log(role === 'controller' ? '控制者連上' : '觀看者連上（只看、不收指令）');

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (msg.cmd === 'hello') {
      send(ws, { evt: 'hello', role, drone: 'fake-bridge', fw: '0.9' });
      if (noAircraft && role === 'controller') send(ws, { evt: 'error', msg: '找不到遙控器' });
      return;
    }
    if (role !== 'controller' || msg.cmd === 'heartbeat' || msg.id === undefined) return;

    const id = msg.id;
    const cmd = msg.cmd;
    later(slow ? 200 : 15, () => send(ws, { id, status: 'ack' }));

    if (MOTION.has(cmd)) {
      motionCount += 1;
      const n = motionCount;
      if (lowbat && cmd === 'takeoff') {
        later(slow ? 400 : 40, () => send(ws, { id, status: 'rejected', reason: 'lowbat' }));
        return;
      }
      if (abortAt && n === abortAt) {
        later(slow ? 400 : 40, () => {
          send(ws, { evt: 'state', state: 'abort' });
          send(ws, { evt: 'abort', reason: 2 });
          later(80, () => send(ws, { evt: 'state', state: 'idle' }));
        });
        return;
      }
      if (timeoutAt && n === timeoutAt) {
        later(slow ? 400 : 40, () => send(ws, { id, status: 'timeout' }));
        return;
      }
    }

    const doneDelay = slow ? 400 : 40;
    later(doneDelay, () => {
      if (cmd === 'enter') send(ws, { evt: 'state', state: 'ready' });
      else if (cmd === 'exit' || cmd === 'land') send(ws, { evt: 'state', state: 'idle' });
      else if (cmd === 'takeoff') send(ws, { evt: 'state', state: 'hovering' });
      else if (cmd === 'stop') {
        send(ws, { evt: 'state', state: 'abort' });
        send(ws, { evt: 'abort', reason: 3 });
        later(80, () => send(ws, { evt: 'state', state: 'idle' }));
      }
      send(ws, { id, status: 'done' });
    });
  });

  ws.on('close', () => {
    sockets.delete(ws);
    if (controller === ws) {
      controller = null;
      console.log('控制者離開');
    }
  });
});

wss.on('listening', () => {
  const flags = [noAircraft && 'no-aircraft', lowbat && 'lowbat', abortAt && `abort-at=${abortAt}`, timeoutAt && `timeout-at=${timeoutAt}`, slow && 'slow']
    .filter(Boolean)
    .join(' ');
  console.log(`假橋接 ws://localhost:${PORT}/ws${flags ? `（${flags}）` : ''}`);
});

wss.on('error', (err) => {
  console.error(err.message);
  process.exit(1);
});

if (!noAircraft) {
  setInterval(() => {
    const telemetry = { h: 0, vbat: lowbat ? 3.4 : 4.15, link: 100 };
    for (const ws of sockets) send(ws, { t: telemetry });
  }, 200).unref?.();
}
