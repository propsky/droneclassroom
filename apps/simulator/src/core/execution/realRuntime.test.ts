import { describe, expect, it } from 'vitest';
import { DroneError, type DroneLink, type DroneRole, type DroneTelemetry } from './droneClient';
import {
  DEFAULT_BRIDGE_URL,
  DEFAULT_CM_PER_METER,
  STATUS_TEXT,
  createRealMotionRuntime,
  describeDroneError,
  splitDistance,
} from './realRuntime';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface FakeDrone extends DroneLink {
  calls: unknown[][];
  failOn: { name: string; error: Error } | null;
  delay: number;
  feed(telemetry: DroneTelemetry): void;
}

function fakeDrone(): FakeDrone {
  const handlers: Array<(telemetry?: DroneTelemetry) => void> = [];
  const drone = {
    connected: true,
    role: 'controller' as DroneRole | null,
    state: 'idle' as string | null,
    telemetry: {} as DroneTelemetry,
    lastError: null as string | null,
    calls: [] as unknown[][],
    failOn: null as { name: string; error: Error } | null,
    delay: 0,
    on(_event: 'telemetry', fn: (telemetry?: DroneTelemetry) => void) {
      handlers.push(fn);
    },
    feed(telemetry: DroneTelemetry) {
      drone.telemetry = { h: 0, vbat: 4.1, link: 100, ...telemetry };
      for (const fn of handlers) fn(drone.telemetry);
    },
    async connect(url: string) {
      drone.calls.push(['connect', url]);
      drone.connected = true;
      return drone.role ?? 'controller';
    },
    close() {
      drone.connected = false;
      drone.role = null;
    },
    async _do(name: string, args: unknown[], after?: () => void) {
      drone.calls.push([name, ...args]);
      if (drone.delay) await sleep(drone.delay);
      if (drone.failOn?.name === name) throw drone.failOn.error;
      after?.();
    },
    begin() {
      return drone._do('begin', [], () => {
        drone.state = 'ready';
      });
    },
    end() {
      return drone._do('end', [], () => {
        drone.state = 'idle';
      });
    },
    ping() {
      return drone._do('ping', []);
    },
    takeoff(h: number) {
      return drone._do('takeoff', [h], () => {
        drone.state = 'hovering';
      });
    },
    land() {
      return drone._do('land', [], () => {
        drone.state = 'idle';
      });
    },
    hover(s: number) {
      return drone._do('hover', [s]);
    },
    move(dx: number, dy: number, dz: number) {
      return drone._do('move', [dx, dy, dz]);
    },
    rotateCW(deg: number) {
      return drone._do('yaw', [deg]);
    },
    stop() {
      return drone._do('stop', []);
    },
  };
  return drone;
}

function setup(scale = DEFAULT_CM_PER_METER) {
  const notes: Array<[string, string]> = [];
  const drone = fakeDrone();
  const clock = { t: 1_000_000 };
  const rt = createRealMotionRuntime({
    drone,
    getScale: () => scale,
    now: () => clock.t,
    notify: (text, kind) => notes.push([text, kind]),
  });
  drone.feed({});
  rt.onRunStart();
  return { rt, drone, notes, clock };
}

const names = (drone: FakeDrone) => drone.calls.map((call) => call[0]);

describe('realRuntime', () => {
  it('預設橋接位址是本機 8765，建立時不連線', async () => {
    expect(DEFAULT_BRIDGE_URL).toBe('ws://localhost:8765/ws');
    const drone = fakeDrone();
    drone.connected = false;
    const rt = createRealMotionRuntime({ drone });
    expect(drone.calls).toEqual([]);
    expect(rt.linkStatus()).toBe('bridge-down');
    await rt.connect();
    expect(drone.calls).toEqual([['connect', DEFAULT_BRIDGE_URL]]);
    await rt.connect('ws://127.0.0.1:9999/ws');
    expect(drone.calls[1]).toEqual(['connect', 'ws://127.0.0.1:9999/ws']);
  });

  it('連線狀態：橋接沒連 → 觀看者 → 飛機沒回應 → 已連通', () => {
    const { rt, drone, clock } = setup();
    expect(rt.linkStatus()).toBe('ready');
    expect(rt.active()).toBe(true);
    expect(rt.isConnected()).toBe(true);
    expect(rt.snapshot()).toMatchObject({ status: 'ready', lamp: 'green', heightCm: 0, voltageV: 4.1 });
    drone.connected = false;
    expect(rt.linkStatus()).toBe('bridge-down');
    expect(rt.snapshot().lamp).toBe('red');
    drone.connected = true;
    drone.role = 'viewer';
    expect(rt.linkStatus()).toBe('viewer');
    expect(rt.snapshot().lamp).toBe('yellow');
    drone.role = 'controller';
    clock.t += 1600;
    expect(rt.linkStatus()).toBe('no-aircraft');
    expect(rt.active()).toBe(false);
    drone.feed({});
    expect(rt.linkStatus()).toBe('ready');
    drone.feed({ link: 0 });
    expect(rt.linkStatus()).toBe('no-aircraft');
  });

  it('橋接連上但從沒收過飛機遙測：不算連通', () => {
    const drone = fakeDrone();
    const rt = createRealMotionRuntime({ drone, getScale: () => 10 });
    expect(rt.linkStatus()).toBe('no-aircraft');
    expect(rt.snapshot().lamp).toBe('yellow');
  });

  it('執行前檢查：連通時送 ping', async () => {
    const { rt, drone } = setup();
    await expect(rt.preflight()).resolves.toEqual({ ok: true, text: '飛機已連通' });
    expect(drone.calls).toEqual([['ping']]);
  });

  it('執行前檢查：沒連通就擋下來，不送任何東西', async () => {
    const { rt, drone, clock } = setup();
    clock.t += 5000;
    await expect(rt.preflight()).resolves.toEqual({ ok: false, text: STATUS_TEXT['no-aircraft'] });
    drone.connected = false;
    await expect(rt.preflight()).resolves.toEqual({ ok: false, text: '連不上橋接程式' });
    drone.connected = true;
    drone.role = 'viewer';
    await expect(rt.preflight()).resolves.toMatchObject({ ok: false, text: expect.stringMatching(/另一個視窗/) });
    expect(drone.calls).toEqual([]);
  });

  it('執行前檢查：遙測有但 ping 沒回應，也不能執行', async () => {
    const { rt, drone } = setup();
    drone.failOn = { name: 'ping', error: new DroneError('NOACK') };
    const res = await rt.preflight();
    expect(res.ok).toBe(false);
    expect(res.text).toMatch(/沒有回應/);
  });

  it('飛機失聯或斷線就報錯停下，不會改成只跑畫面', async () => {
    const breaks = [
      (drone: FakeDrone) => {
        drone.connected = false;
      },
      (drone: FakeDrone) => {
        drone.role = 'viewer';
      },
      (_drone: FakeDrone, clock: { t: number }) => {
        clock.t += 5000;
      },
    ];
    for (const breakLink of breaks) {
      const { rt, drone, notes, clock } = setup();
      await rt.takeoff(8);
      const sent = drone.calls.length;
      breakLink(drone, clock);
      await expect(rt.forward(2)).rejects.toThrow();
      expect(drone.calls.length).toBe(sent);
      expect(notes.at(-1)?.[1]).toBe('error');
      await expect(rt.up(1)).rejects.toThrow('使用者中斷');
      expect(drone.calls.length).toBe(sent);
    }
  });

  it('公尺換公分', async () => {
    const { rt, drone } = setup(10);
    await rt.takeoff(8);
    await rt.forward(2);
    await rt.backward(3);
    await rt.left(1.5);
    await rt.right(1);
    await rt.up(1);
    await rt.down(2);
    await rt.rotateClockwise(90);
    await rt.rotateCounterClockwise(45);
    await rt.hover(2);
    await rt.land();
    expect(drone.calls).toEqual([
      ['begin'],
      ['takeoff', 80],
      ['move', 20, 0, 0],
      ['move', -30, 0, 0],
      ['move', 0, -15, 0],
      ['move', 0, 10, 0],
      ['move', 0, 0, 10],
      ['move', 0, 0, -20],
      ['yaw', 90],
      ['yaw', -45],
      ['hover', 2],
      ['land'],
    ]);
  });

  it('比例可以改', async () => {
    const { rt, drone } = setup(50);
    await rt.takeoff(2);
    await rt.forward(2);
    expect(drone.calls.slice(1)).toEqual([
      ['takeoff', 100],
      ['move', 100, 0, 0],
    ]);
  });

  it('起飛高度限制在 20–150 cm 並提示', async () => {
    const high = setup(100);
    await high.rt.takeoff(8);
    expect(high.drone.calls[1]).toEqual(['takeoff', 150]);
    expect(high.notes[0]?.[0]).toMatch(/150 cm/);
    const low = setup(10);
    await low.rt.takeoff(1.5);
    expect(low.drone.calls[1]).toEqual(['takeoff', 20]);
  });

  it('太長的移動與旋轉拆成多段', async () => {
    const { rt, drone } = setup(100);
    await rt.takeoff(1);
    await rt.forward(5);
    await rt.up(2.5);
    await rt.rotateClockwise(720);
    const moves = drone.calls.filter((call) => call[0] === 'move');
    expect(moves).toHaveLength(6);
    expect(moves.every((move) => Math.abs(Number(move[1])) <= 200 && Math.abs(Number(move[3])) <= 100)).toBe(true);
    const horizontal = moves.slice(0, 3).reduce((sum, move) => sum + Number(move[1]), 0);
    const vertical = moves.slice(3).reduce((sum, move) => sum + Number(move[3]), 0);
    expect(Math.abs(horizontal - 500)).toBeLessThan(0.5);
    expect(Math.abs(vertical - 250)).toBeLessThan(0.5);
    expect(drone.calls.filter((call) => call[0] === 'yaw')).toEqual([
      ['yaw', 360],
      ['yaw', 360],
    ]);
    expect(splitDistance(200, 200)).toEqual([200]);
    expect(splitDistance(0, 200)).toEqual([0]);
  });

  it('前後左右被真機拒絕時硬停止，後面的積木不再飛', async () => {
    for (const name of ['forward', 'backward', 'left', 'right'] as const) {
      const { rt, drone } = setup();
      await rt.takeoff(8);
      drone.failOn = { name: 'move', error: new DroneError('REJECTED', 'range') };
      await expect(rt[name](2)).rejects.toThrow('數值超出真機允許的範圍');
      const sent = drone.calls.length;
      await expect(rt.forward(1)).rejects.toThrow('使用者中斷');
      expect(drone.calls.length).toBe(sent);
    }
  });

  it('指令途中斷線是硬錯誤', async () => {
    const { rt, drone, notes } = setup();
    await rt.takeoff(8);
    drone.failOn = { name: 'move', error: new DroneError('CLOSED') };
    await expect(rt.forward(2)).rejects.toThrow('和橋接程式的連線斷了');
    expect(notes.at(-1)).toEqual(['🚁 和橋接程式的連線斷了', 'error']);
    const sent = drone.calls.length;
    await expect(rt.land()).rejects.toThrow('使用者中斷');
    expect(drone.calls.length).toBe(sent);
  });

  it('迴圈用的 wait 與太短的 hover 不送真機', async () => {
    const { rt, drone } = setup();
    await rt.takeoff(8);
    for (let i = 0; i < 5; i += 1) await rt.wait(0.02);
    await rt.hover(0.05);
    await rt.hover(90);
    expect(drone.calls).toEqual([['begin'], ['takeoff', 80], ['hover', 45], ['hover', 45]]);
  });

  it('只有第一次起飛才進入程式模式；降落後再飛會重新進入', async () => {
    const { rt, drone } = setup();
    await rt.takeoff(8);
    await rt.forward(2);
    await rt.land();
    await rt.takeoff(8);
    expect(names(drone)).toEqual(['begin', 'takeoff', 'move', 'land', 'begin', 'takeoff']);
  });

  it('沒有飛行就結束，不會動到真機', async () => {
    const { rt, drone } = setup();
    await rt.wait(0.05);
    await rt.onRunEnd();
    expect(drone.calls).toEqual([]);
  });

  it('程式結束時收尾', async () => {
    const { rt, drone } = setup();
    await rt.takeoff(8);
    await rt.onRunEnd();
    expect(names(drone)).toEqual(['begin', 'takeoff', 'end']);
    await rt.onRunEnd();
    expect(drone.calls).toHaveLength(3);
  });

  it('收尾失敗時提醒用遙控器接手', async () => {
    const { rt, drone, notes } = setup();
    await rt.takeoff(8);
    drone.failOn = { name: 'end', error: new DroneError('CLOSED') };
    await rt.onRunEnd();
    expect(notes.at(-1)?.[0]).toMatch(/遙控器接手/);
  });

  it('按停止：真機緊急停止，進行中的動作以使用者中斷結束', async () => {
    const { rt, drone } = setup();
    await rt.takeoff(8);
    drone.delay = 50;
    drone.failOn = { name: 'hover', error: new DroneError('ABORT', 3) };
    const hovering = rt.hover(30);
    hovering.catch(() => undefined);
    await sleep(10);
    await rt.onUserStop();
    await expect(hovering).rejects.toThrow('使用者中斷');
    expect(drone.calls.some((call) => call[0] === 'stop')).toBe(true);
  });

  it('飛機失聯時按停止，橋接還在就仍送 stop', async () => {
    const { rt, drone, clock } = setup();
    await rt.takeoff(8);
    clock.t += 5000;
    await rt.onUserStop();
    expect(drone.calls.at(-1)).toEqual(['stop']);
  });

  it('還沒起飛就按停止，不會送 stop', async () => {
    const { rt, drone } = setup();
    await rt.stop();
    expect(drone.calls).toEqual([]);
  });

  it('真機出錯：顯示中文原因，後面的積木不再飛', async () => {
    const { rt, drone, notes } = setup();
    drone.failOn = { name: 'takeoff', error: new DroneError('REJECTED', 'lowbat') };
    await expect(rt.takeoff(8)).rejects.toThrow('電量不足，真機拒絕起飛');
    expect(notes.at(-1)).toEqual(['🚁 電量不足，真機拒絕起飛', 'error']);
    const sent = drone.calls.length;
    await expect(rt.forward(2)).rejects.toThrow('使用者中斷');
    expect(drone.calls.length).toBe(sent);
  });

  it('下一次執行會重新開始', async () => {
    const { rt, drone } = setup();
    drone.failOn = { name: 'takeoff', error: new DroneError('TIMEOUT') };
    await expect(rt.takeoff(8)).rejects.toThrow(/沒有在時間內到位/);
    await rt.onRunEnd();
    drone.failOn = null;
    drone.calls.length = 0;
    rt.onRunStart();
    await rt.takeoff(8);
    expect(names(drone).filter((name) => name !== 'ping')).toEqual(['begin', 'takeoff']);
  });

  it('錯誤訊息的中文說明', () => {
    expect(describeDroneError({ code: 'ABORT', reason: 2 })).toBe('真機中止飛行：遙控器搖桿接管');
    expect(describeDroneError({ code: 'ABORT', reason: 9 })).toBe('真機中止飛行：原因 9');
    expect(describeDroneError({ code: 'REJECTED', reason: 'state' })).toBe(
      '真機目前的狀態不能做這個動作（例如還沒起飛就移動）',
    );
    expect(describeDroneError({ code: 'REJECTED', reason: '?' })).toBe('真機拒絕了這個動作');
    expect(describeDroneError({ code: 'NOACK' })).toMatch(/沒有回應/);
    expect(describeDroneError({ code: 'CLOSED' })).toMatch(/連線斷了/);
    expect(describeDroneError({ code: 'TIMEOUT' })).toMatch(/沒有在時間內到位/);
    expect(describeDroneError({ code: 'NOTREADY', reason: 'bridge-down' })).toBe('連不上橋接程式');
    expect(describeDroneError(new Error('別的錯'))).toBe('別的錯');
  });
});
