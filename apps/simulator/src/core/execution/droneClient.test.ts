import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ACK_TIMEOUT_MS,
  DroneClient,
  MAX_RESEND,
  type MiniSocket,
  type DroneClientOptions,
} from './droneClient';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

class FakeSocket implements MiniSocket {
  static sockets: FakeSocket[] = [];
  onopen: ((ev?: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: ((ev?: unknown) => void) | null = null;
  onclose: ((ev?: unknown) => void) | null = null;
  sent: Array<Record<string, unknown>> = [];
  private closed = false;

  constructor(readonly url: string) {
    FakeSocket.sockets.push(this);
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.onclose?.();
  }

  open(): void {
    this.onopen?.();
  }

  push(msg: unknown): void {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
}

function cmds(sock: FakeSocket, cmd: string): Array<Record<string, unknown>> {
  return sock.sent.filter((msg) => msg.cmd === cmd);
}

async function connect(opts: DroneClientOptions = {}) {
  const drone = new DroneClient({ WebSocket: FakeSocket, ...opts });
  const pending = drone.connect('ws://localhost:8765/ws');
  const sock = FakeSocket.sockets.at(-1);
  if (!sock) throw new Error('沒有建立 socket');
  sock.open();
  sock.push({ evt: 'hello', role: 'controller', drone: 'fake', fw: '0.9' });
  await expect(pending).resolves.toBe('controller');
  return { drone, sock };
}

describe('droneClient', () => {
  beforeEach(() => {
    FakeSocket.sockets = [];
  });

  afterEach(() => {
    for (const sock of FakeSocket.sockets) sock.close();
  });

  it('建構時不連線，規格常數是 300ms／最多重送 3 次', () => {
    const drone = new DroneClient({ WebSocket: FakeSocket });
    expect(drone.connected).toBe(false);
    expect(FakeSocket.sockets).toHaveLength(0);
    expect(ACK_TIMEOUT_MS).toBe(300);
    expect(MAX_RESEND).toBe(3);
  });

  it('連上後送 hello，並等橋接回角色', async () => {
    const drone = new DroneClient({ WebSocket: FakeSocket, name: 'classroom' });
    const pending = drone.connect('ws://localhost:8765/ws');
    const sock = FakeSocket.sockets[0];
    expect(sock?.url).toBe('ws://localhost:8765/ws');
    sock?.open();
    expect(cmds(sock!, 'hello')[0]).toMatchObject({ cmd: 'hello', ver: '0.9', name: 'classroom' });
    sock?.push({ evt: 'hello', role: 'controller', drone: 'fake', fw: '0.9' });
    await expect(pending).resolves.toBe('controller');
    expect(drone.connected).toBe(true);
    expect(drone.role).toBe('controller');
    drone.close();
  });

  it('hello 逾時以 CLOSED 結束', async () => {
    const drone = new DroneClient({ WebSocket: FakeSocket, connectTimeoutMs: 40 });
    const pending = drone.connect('ws://localhost:8765/ws');
    FakeSocket.sockets[0]?.open();
    await expect(pending).rejects.toMatchObject({ code: 'CLOSED' });
    expect(drone.connected).toBe(false);
  });

  it('ack 之後 done 才算完成', async () => {
    const { drone, sock } = await connect({ ackTimeoutMs: 40 });
    const pending = drone.ping();
    await sleep(5);
    const ping = cmds(sock, 'ping')[0];
    sock.push({ id: ping?.id, status: 'ack' });
    sock.push({ id: ping?.id, status: 'done' });
    await pending;
    expect(cmds(sock, 'ping')).toHaveLength(1);
    drone.close();
  });

  it('ack 逾時會用同一個 id 重送，超過 3 次就 NOACK', async () => {
    const { drone, sock } = await connect();
    const started = Date.now();
    const pending = drone.ping();
    await expect(pending).rejects.toMatchObject({ code: 'NOACK' });
    expect(Date.now() - started).toBeGreaterThanOrEqual(ACK_TIMEOUT_MS * MAX_RESEND);
    const pings = cmds(sock, 'ping');
    expect(pings).toHaveLength(MAX_RESEND + 1);
    expect(new Set(pings.map((msg) => msg.id)).size).toBe(1);
    drone.close();
  }, 5000);

  it('第一次沒有 ack、重送後收到 ack 與 done 仍算成功', async () => {
    const { drone, sock } = await connect({ ackTimeoutMs: 30 });
    const pending = drone.ping();
    await sleep(45);
    const pings = cmds(sock, 'ping');
    expect(pings.length).toBeGreaterThanOrEqual(2);
    sock.push({ id: pings[0]?.id, status: 'ack' });
    sock.push({ id: pings[0]?.id, status: 'done' });
    await pending;
    drone.close();
  });

  it('rejected 變成 DroneError', async () => {
    const { drone, sock } = await connect({ ackTimeoutMs: 40 });
    const pending = drone.takeoff(50);
    await sleep(5);
    const cmd = cmds(sock, 'takeoff')[0];
    sock.push({ id: cmd?.id, status: 'ack' });
    sock.push({ id: cmd?.id, status: 'rejected', reason: 'lowbat' });
    await expect(pending).rejects.toMatchObject({ code: 'REJECTED', reason: 'lowbat' });
    drone.close();
  });

  it('abort 讓進行中的動作以 ABORT 結束', async () => {
    const { drone, sock } = await connect({ ackTimeoutMs: 40 });
    const pending = drone.hover(3);
    await sleep(5);
    const cmd = cmds(sock, 'hover')[0];
    sock.push({ id: cmd?.id, status: 'ack' });
    sock.push({ evt: 'state', state: 'abort' });
    sock.push({ evt: 'abort', reason: 2 });
    await expect(pending).rejects.toMatchObject({ code: 'ABORT', reason: 2 });
    expect(drone.state).toBe('abort');
    drone.close();
  });

  it('指令途中斷線以 CLOSED 結束', async () => {
    const { drone, sock } = await connect({ ackTimeoutMs: 40 });
    const pending = drone.move(10, 0, 0);
    await sleep(5);
    const cmd = cmds(sock, 'move')[0];
    sock.push({ id: cmd?.id, status: 'ack' });
    sock.close();
    await expect(pending).rejects.toMatchObject({ code: 'CLOSED' });
    expect(drone.connected).toBe(false);
  });

  it('stop 不排隊，進行中的下一個動作不會再送出', async () => {
    const { drone, sock } = await connect({ ackTimeoutMs: 40 });
    const first = drone.ping();
    const second = drone.hover(1);
    const secondFailed = expect(second).rejects.toMatchObject({ code: 'ABORT' });
    await sleep(5);
    const stopping = drone.stop();
    await sleep(5);
    const stop = cmds(sock, 'stop')[0];
    expect(stop).toBeTruthy();
    expect(cmds(sock, 'hover')).toHaveLength(0);
    sock.push({ id: stop?.id, status: 'ack' });
    sock.push({ id: stop?.id, status: 'done' });
    await stopping;
    const ping = cmds(sock, 'ping')[0];
    sock.push({ id: ping?.id, status: 'ack' });
    sock.push({ id: ping?.id, status: 'done' });
    await first;
    await secondFailed;
    expect(cmds(sock, 'hover')).toHaveLength(0);
    drone.close();
  });

  it('begin 立刻送心跳，等飛機進入 ready', async () => {
    const { drone, sock } = await connect({ ackTimeoutMs: 40 });
    const beginning = drone.begin();
    await sleep(10);
    const enter = cmds(sock, 'enter')[0];
    expect(enter).toBeTruthy();
    expect(cmds(sock, 'heartbeat').length).toBeGreaterThan(0);
    sock.push({ id: enter?.id, status: 'ack' });
    sock.push({ evt: 'state', state: 'ready' });
    sock.push({ id: enter?.id, status: 'done' });
    await beginning;
    expect(drone.state).toBe('ready');
    sock.push({ t: { h: 20, vbat: 4.15, link: 100 } });
    expect(drone.height()).toBe(20);
    expect(drone.battery()).toBe(4.15);

    const ending = drone.end();
    await sleep(10);
    const exit = cmds(sock, 'exit')[0];
    sock.push({ id: exit?.id, status: 'ack' });
    sock.push({ evt: 'state', state: 'idle' });
    sock.push({ id: exit?.id, status: 'done' });
    await ending;
    expect(drone.state).toBe('idle');
    drone.close();
  });

  it('第二個角色可以是觀看者', async () => {
    const { drone, sock } = await connect();
    sock.push({ evt: 'viewer' });
    expect(drone.role).toBe('viewer');
    drone.close();
  });
});
