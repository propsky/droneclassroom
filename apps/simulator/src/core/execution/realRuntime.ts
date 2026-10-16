// 真機執行後端：cf_* 動作改送本機 WebSocket 橋接，並等飛機做完。
// 預設 ws://localhost:8765/ws，比例 1 m = 10 cm。載入時不連線，頁面仍從模擬模式啟動。
// 斷線、失聯、飛機拒絕都是硬錯誤，不會改回只播畫面。
// 前後左右仍會送出（一次一個、等回覆）。真機韌體目前以 range 拒絕（光流尚未就緒），
// 這裡改寫成學生看得懂的說明。假橋接預設接受；加 --reject-planar 可重現拒絕。
import type { LinkLamp, RealLinkStatus } from '@creafly/shared';
import { bus, type ToastKind } from '../events';
import { DroneClient, DroneError, type DroneLink } from './droneClient';
import { DEFAULT_BRIDGE_URL, DEFAULT_CM_PER_METER, getBridgeUrl, getCmPerMeter } from './realPrefs';
import type { MotionRuntime } from './runtime';

export { DEFAULT_BRIDGE_URL, DEFAULT_CM_PER_METER };

/** 真機限制（協定：公分、度、秒） */
export const LIMITS = {
  takeoffMin: 20,
  takeoffMax: 150,
  moveMax: 200,
  vertMax: 100,
  yawMax: 360,
  hoverMin: 0.1,
  hoverMax: 60,
} as const;

const TELEMETRY_FRESH_MS = 1500;
const USER_STOP = '使用者中斷';

const ABORT_TEXT: Record<number, string> = {
  1: '心跳逾時',
  2: '遙控器搖桿接管',
  3: '緊急停止',
  4: '電量過低',
  5: '光流失效',
  6: '傾角保護',
};

/** 前後左右被韌體 range 拒絕時，給學生的說明 */
export const PLANAR_UNSUPPORTED_TEXT =
  '真機目前不支援前後左右移動（光流尚未就緒）。這個動作已被拒絕，後面的積木不會再飛。';

const REJECT_TEXT: Record<string, string> = {
  lowbat: '電量不足，真機拒絕起飛',
  range: '數值超出真機允許的範圍',
  planar: PLANAR_UNSUPPORTED_TEXT,
  state: '真機目前的狀態不能做這個動作（例如還沒起飛就移動）',
  locked: '真機還在空中，不能進入或離開程式模式',
};

export const STATUS_TEXT: Record<RealLinkStatus | 'sim', string> = {
  sim: '模擬器模式',
  'bridge-down': '連不上橋接程式',
  viewer: '另一個視窗正在控制真機，這裡只能觀看',
  'no-aircraft': '橋接程式已連上，但飛機沒有回應（飛機開機了嗎？遙控器對上了嗎？）',
  ready: '飛機已連通',
};

export interface RealLinkSnapshot {
  status: RealLinkStatus;
  lamp: LinkLamp;
  heightCm?: number;
  voltageV?: number;
}

export interface RealRuntimeDeps {
  /** 不傳就用 DroneClient。測試傳假橋接。 */
  drone?: DroneLink;
  /** 1 模擬公尺等於幾公分。預設 10。 */
  getScale?: () => number;
  notify?: (text: string, kind: ToastKind) => void;
  /** 測試時鐘（毫秒） */
  now?: () => number;
  /** 只有 connect() 會用。預設 ws://localhost:8765/ws。 */
  url?: string;
}

export interface RealMotionRuntime extends MotionRuntime {
  linkStatus(): RealLinkStatus;
  active(): boolean;
  preflight(): Promise<{ ok: boolean; text: string }>;
  /** 程式開始：清掉上一輪的失敗／停止旗標 */
  onRunStart(): void;
  /** 學生按停止，或程式被中斷。已起飛且橋接還在就送緊急停止。 */
  onUserStop(): Promise<void>;
  stop(): Promise<void>;
  /** 程式結束：還在空中就降落並離開程式模式 */
  onRunEnd(): Promise<void>;
  /** 緊急停止：已連線就送硬停（懸停後降落），不管程式有沒有在跑 */
  emergencyStop(): Promise<void>;
  /** 先硬停，再拆掉 WebSocket */
  disconnect(): Promise<void>;
  connect(url?: string): Promise<string>;
  close(): void;
  snapshot(): RealLinkSnapshot;
}

/** 把一段距離拆成每段不超過 limit 的等分（單一指令有上限）。 */
export function splitDistance(value: number, limit: number): number[] {
  const n = Math.max(1, Math.ceil(Math.abs(value) / limit - 1e-9));
  const parts: number[] = [];
  for (let i = 0; i < n; i += 1) parts.push(value / n);
  return parts;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function reasonOf(err: object): string | number | undefined {
  if (!('reason' in err)) return undefined;
  const reason = err.reason;
  if (typeof reason === 'string' || typeof reason === 'number') return reason;
  return undefined;
}

/** 把橋接錯誤換成學生看得懂的中文。 */
export function describeDroneError(err: unknown): string {
  if (!err || typeof err !== 'object' || !('code' in err) || !err.code) {
    if (err instanceof Error) return err.message;
    return String(err);
  }
  const code = String(err.code);
  const reason = reasonOf(err);
  switch (code) {
    case 'REJECTED':
      return (typeof reason === 'string' ? REJECT_TEXT[reason] : undefined) ?? '真機拒絕了這個動作';
    case 'TIMEOUT':
      return '真機沒有在時間內到位';
    case 'ABORT': {
      const text = typeof reason === 'number' ? ABORT_TEXT[reason] : undefined;
      return `真機中止飛行：${text ?? `原因 ${String(reason)}`}`;
    }
    case 'NOACK':
      return '真機沒有回應（飛機關機了？遙控器沒對上？）';
    case 'CLOSED':
      return '和橋接程式的連線斷了';
    case 'NOTREADY':
      return (typeof reason === 'string' ? STATUS_TEXT[reason as RealLinkStatus] : undefined) ?? '真機還沒連通';
    default:
      return err instanceof Error ? err.message : String(err);
  }
}

function lampFor(status: RealLinkStatus): LinkLamp {
  if (status === 'ready') return 'green';
  if (status === 'bridge-down') return 'red';
  return 'yellow';
}

function defaultNotify(text: string, kind: ToastKind): void {
  bus.emit('toast', { text, kind });
}

export function createRealMotionRuntime(deps: RealRuntimeDeps = {}): RealMotionRuntime {
  const drone = deps.drone ?? new DroneClient({ name: 'classroom' });
  const getScale = deps.getScale ?? getCmPerMeter;
  const notify = deps.notify ?? defaultNotify;
  const now = deps.now ?? (() => Date.now());
  let url = deps.url ?? getBridgeUrl();
  let lastTelemetry: number | null = null;
  let begun = false;
  let userStopped = false;
  let failed = false;
  let stopSent = false;

  drone.on('telemetry', () => {
    lastTelemetry = now();
  });

  function linkStatus(): RealLinkStatus {
    if (!drone.connected) return 'bridge-down';
    if (drone.role !== 'controller') return 'viewer';
    const fresh = lastTelemetry !== null && now() - lastTelemetry <= TELEMETRY_FRESH_MS;
    if (!fresh || drone.telemetry.link === 0) return 'no-aircraft';
    return 'ready';
  }

  function snapshot(): RealLinkSnapshot {
    const status = linkStatus();
    const snap: RealLinkSnapshot = { status, lamp: lampFor(status) };
    if (typeof drone.telemetry.h === 'number') snap.heightCm = drone.telemetry.h;
    if (typeof drone.telemetry.vbat === 'number') snap.voltageV = drone.telemetry.vbat;
    return snap;
  }

  function cm(meters: number): number {
    return round1(meters * getScale());
  }

  async function failAction(err: unknown): Promise<never> {
    if (userStopped) throw new Error(USER_STOP);
    failed = true;
    const text = describeDroneError(err);
    notify(`🚁 ${text}`, 'error');
    throw new Error(text);
  }

  function isRangeReject(err: unknown): boolean {
    return !!err && typeof err === 'object' && 'code' in err && err.code === 'REJECTED' && 'reason' in err && err.reason === 'range';
  }

  /** 前後左右被 range 拒絕時，換成說明光流尚未就緒的句子 */
  function rewritePlanarReject(err: unknown): unknown {
    if (isRangeReject(err)) return new DroneError('REJECTED', 'planar');
    return err;
  }

  async function runAction(fn: () => Promise<void>, rewrite?: (err: unknown) => unknown): Promise<void> {
    if (failed) throw new Error(USER_STOP);
    const status = linkStatus();
    if (status !== 'ready') {
      await failAction(new DroneError('NOTREADY', status));
    }
    try {
      await fn();
    } catch (err) {
      await failAction(rewrite ? rewrite(err) : err);
    }
  }

  async function sendHardStop(): Promise<void> {
    if (!drone.connected || stopSent) return;
    stopSent = true;
    await drone.stop().then(
      () => undefined,
      () => undefined,
    );
  }

  async function ensureProgramMode(): Promise<void> {
    if (!begun || drone.state === 'idle') {
      await drone.begin();
      begun = true;
    }
  }

  async function moveReal(dxM: number, dyM: number, dzM: number): Promise<void> {
    const dx = cm(dxM);
    const dy = cm(dyM);
    const dz = cm(dzM);
    const n = Math.max(
      splitDistance(dx, LIMITS.moveMax).length,
      splitDistance(dy, LIMITS.moveMax).length,
      splitDistance(dz, LIMITS.vertMax).length,
    );
    for (let i = 0; i < n; i += 1) {
      await drone.move(round1(dx / n), round1(dy / n), round1(dz / n));
    }
  }

  async function yawReal(deg: number): Promise<void> {
    const parts = splitDistance(deg, LIMITS.yawMax);
    for (const part of parts) await drone.rotateCW(part);
  }

  async function onUserStop(): Promise<void> {
    userStopped = true;
    if (begun) await sendHardStop();
  }

  async function emergencyStop(): Promise<void> {
    userStopped = true;
    failed = true;
    await sendHardStop();
  }

  const runtime: RealMotionRuntime = {
    isConnected: () => linkStatus() === 'ready',
    linkStatus,
    active: () => linkStatus() === 'ready',
    snapshot,
    async connect(nextUrl?: string): Promise<string> {
      if (nextUrl) url = nextUrl;
      else url = deps.url ?? getBridgeUrl();
      stopSent = false;
      return drone.connect(url);
    },
    close() {
      drone.close();
    },
    emergencyStop,
    async disconnect() {
      await emergencyStop();
      drone.close();
      stopSent = false;
    },
    async preflight() {
      const status = linkStatus();
      if (status !== 'ready') return { ok: false, text: STATUS_TEXT[status] };
      try {
        await drone.ping();
        return { ok: true, text: STATUS_TEXT.ready };
      } catch (err) {
        return { ok: false, text: describeDroneError(err) };
      }
    },
    onRunStart() {
      begun = false;
      userStopped = false;
      failed = false;
      stopSent = false;
    },
    onUserStop,
    stop: onUserStop,
    async onRunEnd() {
      if (!begun) return;
      begun = false;
      if (!drone.connected) return;
      try {
        await drone.end();
      } catch (err) {
        notify(`🚁 收尾失敗：${describeDroneError(err)}。請用遙控器接手！`, 'error');
      }
    },
    takeoff(height = 8) {
      return runAction(async () => {
        await ensureProgramMode();
        const want = cm(height);
        const target = Math.min(LIMITS.takeoffMax, Math.max(LIMITS.takeoffMin, want));
        if (target !== want) notify(`真機起飛高度限制在 20–150 cm，改飛 ${target} cm`, '');
        await drone.takeoff(target);
      });
    },
    land: () => runAction(() => drone.land()),
    hover(seconds = 1) {
      return runAction(async () => {
        const span = Number(seconds);
        if (!(span >= LIMITS.hoverMin)) return;
        const parts = splitDistance(span, LIMITS.hoverMax);
        for (const part of parts) await drone.hover(round1(part));
      });
    },
    // 迴圈積木會密集呼叫 wait，不送真機
    wait(seconds = 1) {
      return sleepSeconds(seconds);
    },
    forward: (distance = 2) => runAction(() => moveReal(distance, 0, 0), rewritePlanarReject),
    backward: (distance = 2) => runAction(() => moveReal(-Math.abs(distance), 0, 0), rewritePlanarReject),
    right: (distance = 2) => runAction(() => moveReal(0, distance, 0), rewritePlanarReject),
    left: (distance = 2) => runAction(() => moveReal(0, -Math.abs(distance), 0), rewritePlanarReject),
    up: (distance = 1) => runAction(() => moveReal(0, 0, distance)),
    down: (distance = 1) => runAction(() => moveReal(0, 0, -Math.abs(distance))),
    rotateClockwise: (degrees = 90) => runAction(() => yawReal(degrees)),
    rotateCounterClockwise: (degrees = 90) => runAction(() => yawReal(-Math.abs(degrees))),
  };

  return runtime;
}

function sleepSeconds(seconds: number): Promise<void> {
  const ms = Math.max(0, seconds) * 1000;
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    (timer as { unref?: () => void }).unref?.();
  });
}

/** 預設後端。沒有人呼叫 connect() 之前不會打開 WebSocket。 */
export const realMotionRuntime = createRealMotionRuntime();
