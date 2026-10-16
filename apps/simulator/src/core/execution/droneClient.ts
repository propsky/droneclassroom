// 真機橋接的 WebSocket JSON 客戶端。
// 移植自 real-drone/drone.js（協定對齊 stm32-drone-blockly docs/07，規格版本 0.9）。
// 這是 TypeScript 重寫，給 core/execution 用；載入時不連線，WebSocket 建構子可注入給測試。

export const ACK_TIMEOUT_MS = 300;
export const MAX_RESEND = 3;
export const HEARTBEAT_MS = 100;
export const SPEC_VERSION = '0.9';

const AIRBORNE = ['takingoff', 'hovering', 'moving', 'yawing'];

export type DroneErrorCode = 'REJECTED' | 'TIMEOUT' | 'ABORT' | 'NOACK' | 'CLOSED' | 'NOTREADY';

export type DroneRole = 'controller' | 'viewer';

export interface DroneTelemetry {
  h?: number;
  vbat?: number;
  link?: number;
  x?: number;
  y?: number;
  yaw?: number;
  front?: number;
}

/** 測試可替換的最小 socket。瀏覽器 WebSocket 可直接當建構子傳入。 */
export interface MiniSocket {
  onopen: ((ev?: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev?: unknown) => void) | null;
  onclose: ((ev?: unknown) => void) | null;
  send(data: string): void;
  close(): void;
}

export type SocketCtor = new (url: string) => MiniSocket;

export type DroneEvent = 'telemetry' | 'state' | 'abort' | 'error' | 'close' | 'print';

export interface DroneClientOptions {
  /** hello 裡帶的名稱（橋接紀錄用） */
  name?: string;
  /** 自訂 WebSocket 建構子（測試用） */
  WebSocket?: SocketCtor;
  /** ack 逾時，預設 300ms */
  ackTimeoutMs?: number;
  /** ack 最多重送次數，預設 3（不含第一次送出） */
  maxResend?: number;
  /** 連線／hello 逾時，預設 2000ms */
  connectTimeoutMs?: number;
}

/** code：REJECTED、TIMEOUT、ABORT、NOACK、CLOSED、NOTREADY。reason 是拒絕原因或 abort 原因碼。 */
export class DroneError extends Error {
  readonly code: string;
  readonly reason: string | number | null;

  constructor(code: string, reason?: string | number | null) {
    super(reason === undefined || reason === null ? code : `${code}（${reason}）`);
    this.name = 'DroneError';
    this.code = code;
    this.reason = reason === undefined ? null : reason;
  }
}

interface Waiter {
  cmd: string;
  acked: boolean;
  settled: boolean;
  ack: () => void;
  resolve: () => void;
  reject: (error: DroneError) => void;
  ackedPromise: Promise<void>;
  done: Promise<void>;
}

interface Inbound {
  t?: DroneTelemetry;
  status?: string;
  id?: number;
  reason?: string | number;
  evt?: string;
  role?: string;
  state?: string;
  msg?: string;
  drone?: string;
  fw?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    (timer as { unref?: () => void }).unref?.();
  });
}

/**
 * 積木端與橋接之間的客戶端。
 * 每個動作：取下一個 id（1–255）→ 送出 → ack 逾時就同 id 重送 → 等 done。
 * 動作一次一個；stop() 不排隊，立刻送。
 */
export class DroneClient {
  readonly name: string;
  connected = false;
  role: DroneRole | null = null;
  /** hello 的回覆（drone、fw、role） */
  info: Inbound | null = null;
  state: string | null = null;
  telemetry: DroneTelemetry = {};
  /** 最近一次 abort 的原因碼 */
  aborted: string | number | null = null;
  /** 橋接最近一次回報的錯誤文字 */
  lastError: string | null = null;

  private readonly socketOverride: SocketCtor | undefined;
  private readonly ackTimeoutMs: number;
  private readonly maxResend: number;
  private readonly connectTimeoutMs: number;
  private ws: MiniSocket | null = null;
  private id = 0;
  private readonly waiters = new Map<number, Waiter>();
  private chain: Promise<void> = Promise.resolve();
  /** abort／stop 時加一，讓還在排隊的動作不要再送出去 */
  private epoch = 0;
  private hbStop: (() => void) | null = null;
  private timer0 = Date.now();
  private helloResolve: ((role: string) => void) | null = null;
  private readonly handlers: Partial<Record<DroneEvent, Array<(arg?: unknown) => void>>> = {};

  constructor(opts: DroneClientOptions = {}) {
    this.name = opts.name ?? 'classroom';
    this.socketOverride = opts.WebSocket;
    this.ackTimeoutMs = opts.ackTimeoutMs ?? ACK_TIMEOUT_MS;
    this.maxResend = opts.maxResend ?? MAX_RESEND;
    this.connectTimeoutMs = opts.connectTimeoutMs ?? 2000;
  }

  /** 連線並送 hello；回傳角色。逾時或連不上丟 DroneError('CLOSED')。 */
  connect(url: string): Promise<string> {
    const Ctor = this.socketOverride ?? (globalThis.WebSocket as SocketCtor | undefined);
    if (!Ctor) return Promise.reject(new DroneError('CLOSED', '這個環境沒有 WebSocket'));
    if (this.connected) return Promise.reject(new DroneError('CLOSED', '已經連線了，請先 close()'));
    this.resetLink();
    return new Promise((resolve, reject) => {
      let settled = false;
      let ws: MiniSocket | undefined;
      const fail = (reason: string) => {
        if (settled) return;
        settled = true;
        try {
          ws?.close();
        } catch {
          /* 已經關了 */
        }
        reject(new DroneError('CLOSED', reason));
      };
      try {
        ws = new Ctor(url);
      } catch (e) {
        fail(e instanceof Error ? e.message : String(e));
        return;
      }
      const socket = ws;
      this.ws = socket;
      const timer = setTimeout(() => fail('連線逾時'), this.connectTimeoutMs);
      (timer as { unref?: () => void }).unref?.();
      this.helloResolve = (role) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(role);
      };
      // 同一個客戶端可以斷線後再連；舊連線遲到的事件一律忽略
      socket.onopen = () => {
        if (this.ws !== socket) return;
        this.connected = true;
        this.send({ cmd: 'hello', ver: SPEC_VERSION, name: this.name });
      };
      socket.onmessage = (ev) => {
        if (this.ws !== socket) return;
        if (typeof ev.data !== 'string') return;
        let msg: Inbound;
        try {
          msg = JSON.parse(ev.data) as Inbound;
        } catch {
          return;
        }
        this.onMessage(msg);
      };
      socket.onerror = () => fail(`連不上 ${url}`);
      socket.onclose = () => {
        clearTimeout(timer);
        fail('連線被關閉');
        if (this.ws === socket) this.onClose();
      };
    });
  }

  /**
   * 主動斷線。馬上生效（不等瀏覽器的關閉通知），之後可以再 connect()。
   * 伺服器要一小段時間才知道舊連線關了；馬上重連可能暫時拿到 viewer。
   */
  close(): void {
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      try {
        ws.close();
      } catch {
        /* 已經關了 */
      }
    }
    this.onClose();
  }

  on(event: DroneEvent, handler: (arg?: unknown) => void): this {
    const list = this.handlers[event] ?? [];
    list.push(handler);
    this.handlers[event] = list;
    return this;
  }

  takeoff(h = 50): Promise<void> {
    return this.action('takeoff', { h });
  }

  land(): Promise<void> {
    return this.action('land');
  }

  hover(s = 3): Promise<void> {
    return this.action('hover', { s });
  }

  move(dx = 0, dy = 0, dz = 0): Promise<void> {
    return this.action('move', { dx: dx || 0, dy: dy || 0, dz: dz || 0 });
  }

  forward(d = 50): Promise<void> {
    return this.move(d, 0, 0);
  }

  backward(d = 50): Promise<void> {
    return this.move(-d, 0, 0);
  }

  right(d = 50): Promise<void> {
    return this.move(0, d, 0);
  }

  left(d = 50): Promise<void> {
    return this.move(0, -d, 0);
  }

  up(d = 20): Promise<void> {
    return this.move(0, 0, d);
  }

  down(d = 20): Promise<void> {
    return this.move(0, 0, -d);
  }

  rotateCW(deg = 90): Promise<void> {
    return this.action('yaw', { deg });
  }

  rotateCCW(deg = 90): Promise<void> {
    return this.action('yaw', { deg: -deg });
  }

  ping(): Promise<void> {
    return this.action('ping');
  }

  /** 緊急停止：不排隊，馬上送。 */
  stop(): Promise<void> {
    this.epoch += 1;
    return this.request('stop');
  }

  /** 進入程式模式：送 enter、等 state === 'ready'、開始 10 Hz 心跳。 */
  async begin(): Promise<void> {
    this.timerReset();
    this.aborted = null;
    this.startHeartbeat();
    try {
      if (this.state !== 'ready') await this.action('enter');
      await this.waitState('ready', 2000);
    } catch (e) {
      this.stopHeartbeat();
      throw e;
    }
  }

  /** 結束：還在空中就先降落（abort 中則等它自己落地），再送 exit，停止心跳。 */
  async end(): Promise<void> {
    try {
      if (!this.connected) return;
      if (this.state === 'abort' || this.state === 'landing') {
        await this.waitState('idle', 20000);
      } else if (this.state !== null && AIRBORNE.includes(this.state)) {
        await this.land();
      }
      if (this.state === 'ready') await this.action('exit');
    } finally {
      this.stopHeartbeat();
    }
  }

  height(): number {
    return this.telemetry.h ?? 0;
  }

  battery(): number {
    return this.telemetry.vbat ?? 0;
  }

  elapsed(): number {
    return (Date.now() - this.timer0) / 1000;
  }

  timerReset(): void {
    this.timer0 = Date.now();
  }

  private resetLink(): void {
    this.role = null;
    this.info = null;
    this.state = null;
    this.telemetry = {};
    this.lastError = null;
  }

  private fire(event: DroneEvent, arg?: unknown): void {
    const list = this.handlers[event] ?? [];
    for (const handler of list) {
      try {
        handler(arg);
      } catch (e) {
        console.error(e);
      }
    }
  }

  private send(msg: Record<string, unknown>): boolean {
    if (!this.connected || !this.ws) return false;
    try {
      this.ws.send(JSON.stringify(msg));
      return true;
    } catch {
      return false;
    }
  }

  private onClose(): void {
    const wasConnected = this.connected;
    this.connected = false;
    this.ws = null;
    this.stopHeartbeat();
    for (const waiter of this.waiters.values()) waiter.reject(new DroneError('CLOSED'));
    if (wasConnected) {
      this.role = null;
      this.state = null;
      this.fire('close');
    }
  }

  private onMessage(msg: Inbound): void {
    if (msg.t) {
      this.telemetry = msg.t;
      this.fire('telemetry', msg.t);
      return;
    }
    if (msg.status) {
      if (msg.id === undefined) return;
      const waiter = this.waiters.get(msg.id);
      if (!waiter) return;
      if (msg.status === 'ack') waiter.ack();
      else if (msg.status === 'done') waiter.resolve();
      else waiter.reject(new DroneError(String(msg.status).toUpperCase(), msg.reason));
      return;
    }
    switch (msg.evt) {
      case 'hello':
        this.role = msg.role === 'viewer' ? 'viewer' : 'controller';
        this.info = msg;
        this.helloResolve?.(msg.role ?? 'controller');
        break;
      case 'state':
        this.state = msg.state ?? null;
        this.fire('state', msg.state);
        break;
      case 'abort':
        this.aborted = msg.reason ?? null;
        this.epoch += 1;
        if (this.state !== 'idle') this.state = 'abort';
        for (const waiter of this.waiters.values()) {
          if (waiter.cmd !== 'stop') waiter.reject(new DroneError('ABORT', msg.reason));
        }
        this.fire('abort', msg.reason);
        break;
      case 'error':
        this.lastError = msg.msg ?? null;
        this.fire('error', msg.msg);
        break;
      case 'viewer':
        this.role = 'viewer';
        break;
      default:
        break;
    }
  }

  private nextId(): number {
    this.id = (this.id % 255) + 1;
    return this.id;
  }

  /** 送一個帶 id 的指令並等它完成（含 ack 逾時重送）。 */
  private async request(cmd: string, params?: Record<string, unknown>): Promise<void> {
    if (!this.connected) throw new DroneError('CLOSED');
    const id = this.nextId();
    const msg: Record<string, unknown> = { id, cmd, ...params };
    let resolveAck: () => void = () => undefined;
    let resolveDone: () => void = () => undefined;
    let rejectDone: (error: DroneError) => void = () => undefined;
    const waiter: Waiter = {
      cmd,
      acked: false,
      settled: false,
      ack() {
        this.acked = true;
        resolveAck();
      },
      resolve() {
        this.settled = true;
        resolveDone();
      },
      reject(error: DroneError) {
        this.settled = true;
        rejectDone(error);
      },
      ackedPromise: undefined as unknown as Promise<void>,
      done: undefined as unknown as Promise<void>,
    };
    waiter.ackedPromise = new Promise<void>((resolve) => {
      resolveAck = resolve;
    });
    waiter.done = new Promise<void>((resolve, reject) => {
      resolveDone = resolve;
      rejectDone = reject;
    });
    waiter.done.catch(() => {
      /* 由下面的 await 接；這裡只是避免未處理的拒絕 */
    });
    this.waiters.set(id, waiter);
    try {
      for (let sends = 1; ; sends += 1) {
        this.send(msg);
        await Promise.race([waiter.ackedPromise, waiter.done.catch(() => undefined), sleep(this.ackTimeoutMs)]);
        if (waiter.acked || waiter.settled) break;
        if (sends > this.maxResend) throw new DroneError('NOACK');
      }
      await waiter.done;
    } finally {
      this.waiters.delete(id);
    }
  }

  /** 排隊執行的動作。排隊期間 abort 或停止的話，這個動作不再送出。 */
  private action(cmd: string, params?: Record<string, unknown>): Promise<void> {
    const epoch = this.epoch;
    const run = this.chain.then(() => {
      if (epoch !== this.epoch) throw new DroneError('ABORT', this.aborted);
      return this.request(cmd, params);
    });
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async waitState(state: string, timeoutMs: number): Promise<void> {
    const end = Date.now() + timeoutMs;
    while (this.state !== state) {
      if (!this.connected) throw new DroneError('CLOSED');
      if (Date.now() >= end) throw new DroneError('TIMEOUT', `等不到狀態 ${state}`);
      await sleep(20);
    }
  }

  private startHeartbeat(): void {
    if (this.hbStop) return;
    const beat = () => {
      this.send({ cmd: 'heartbeat' });
    };
    // 分頁在背景時主執行緒計時器會被降頻；Worker 不會
    try {
      const RootWorker = globalThis.Worker;
      const RootBlob = globalThis.Blob;
      const RootURL = globalThis.URL;
      if (typeof RootWorker === 'function' && typeof RootBlob === 'function' && RootURL) {
        const src = `setInterval(function(){postMessage(0)},${HEARTBEAT_MS});`;
        const blobUrl = RootURL.createObjectURL(new RootBlob([src], { type: 'text/javascript' }));
        const worker = new RootWorker(blobUrl);
        worker.onmessage = beat;
        this.hbStop = () => {
          worker.terminate();
          RootURL.revokeObjectURL(blobUrl);
        };
        beat();
        return;
      }
    } catch {
      /* 不能用 Worker（例如被 CSP 擋）就退回一般計時器 */
    }
    const timer = setInterval(beat, HEARTBEAT_MS);
    (timer as { unref?: () => void }).unref?.();
    this.hbStop = () => clearInterval(timer);
    beat();
  }

  private stopHeartbeat(): void {
    if (!this.hbStop) return;
    this.hbStop();
    this.hbStop = null;
  }
}

/** realRuntime 依賴的橋接表面。DroneClient 滿足這個形狀，測試可以換假的。 */
export interface DroneLink {
  connected: boolean;
  role: DroneRole | null;
  state: string | null;
  telemetry: DroneTelemetry;
  lastError: string | null;
  on(event: 'telemetry', handler: (telemetry?: DroneTelemetry) => void): void;
  connect(url: string): Promise<string>;
  close(): void;
  begin(): Promise<void>;
  end(): Promise<void>;
  ping(): Promise<void>;
  takeoff(heightCm: number): Promise<void>;
  land(): Promise<void>;
  hover(seconds: number): Promise<void>;
  move(dx: number, dy: number, dz: number): Promise<void>;
  rotateCW(degrees: number): Promise<void>;
  stop(): Promise<void>;
}
