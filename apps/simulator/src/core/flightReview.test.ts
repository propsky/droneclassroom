// 飛行回顧：固定 tick 累加、重播決定性、以及明確不進 replayHash。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { LevelDef } from '@creafly/shared';
import { FlightReview, type FlightReviewSample } from './flightReview';
import { advanceSimTick, droneState, flags, resetDroneState, simNowMs, simTime, TICK_HZ } from './droneState';
import { applyLoadLevel, levelState } from './level';
import { FNV_OFFSET, hashDroneTick, hashToHex } from './simHash';
import { tickFlightPhysics, tickRecordedLevel } from './simTick';
import type { ControlFrame } from './physics';
import { programState, runProgram, setMode, stopProgram } from './program';
import { bus } from './events';
import {
  beginFrame,
  endFrame,
  finalizeRecording,
  initRecordingSession,
  setInFixedTick,
} from './recordingSession';
import { replayRecording } from './replayRunner';

const grounded = (x = 0, z = 0): FlightReviewSample => ({
  position: { x, y: 0.4, z },
  velocity: { x: 0, y: 0, z: 0 },
  isFlying: false,
});

describe('FlightReview 累加', () => {
  beforeEach(() => {
    FlightReview.reset();
  });

  it('時基與模擬 tick 相同（60Hz），不另讀牆鐘', () => {
    expect(FlightReview.TICK_HZ).toBe(TICK_HZ);
    expect(TICK_HZ).toBe(60);
  });

  it('地面樣本不計空中時間、距離、極速、高度', () => {
    FlightReview.tick(grounded());
    FlightReview.tick(grounded(1, 0));
    expect(FlightReview.snapshot()).toEqual({
      airTicks: 0,
      distanceM: 0,
      topSpeedMps: 0,
      maxAltitudeM: 0,
    });
  });

  it('空中累計時間與路徑，落地那段算距離、落地後不再累計', () => {
    FlightReview.tick(grounded());
    FlightReview.tick({
      position: { x: 0, y: 1, z: 0 },
      velocity: { x: 0, y: 0.01, z: 0 },
      isFlying: true,
    });
    FlightReview.tick({
      position: { x: 0, y: 2, z: 0 },
      velocity: { x: 0.02, y: 0, z: 0 },
      isFlying: true,
    });
    FlightReview.tick(grounded());
    FlightReview.tick({
      position: { x: 1, y: 0.4, z: 0 },
      velocity: { x: 0.05, y: 0, z: 0 },
      isFlying: false,
    });
    expect(FlightReview.snapshot()).toEqual({
      airTicks: 2,
      distanceM: 0.6 + 1 + 1.6,
      // 位置一 tick 上升 1m → 60 m/s，大於速度向量的 1.2 m/s。實際速率取較大值。
      topSpeedMps: 60,
      maxAltitudeM: 2,
    });
  });

  it('速度向量為 0 時仍用位置變化計速度（程式模式）', () => {
    FlightReview.tick({
      position: { x: 0, y: 1, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      isFlying: true,
    });
    FlightReview.tick({
      position: { x: 0, y: 1, z: -0.1 },
      velocity: { x: 0, y: 0, z: 0 },
      isFlying: true,
    });
    expect(FlightReview.snapshot().topSpeedMps).toBeCloseTo(6, 8);
    expect(FlightReview.instantSpeedMps()).toBeCloseTo(6, 8);
    expect(FlightReview.displaySpeedMps(0)).toBeCloseTo(6, 8);
  });

  it('位置沒動時仍採用速度向量', () => {
    FlightReview.tick({
      position: { x: 0, y: 2, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      isFlying: true,
    });
    FlightReview.tick({
      position: { x: 0, y: 2, z: 0 },
      velocity: { x: 0.02, y: 0, z: 0 },
      isFlying: true,
    });
    expect(FlightReview.snapshot().topSpeedMps).toBeCloseTo(1.2, 8);
    expect(FlightReview.instantSpeedMps()).toBeCloseTo(1.2, 8);
  });

  it('即時列與結算四列用同一組飛行距離', () => {
    const stats = { airTicks: 90, distanceM: 8.6, topSpeedMps: 2.4, maxAltitudeM: 3 };
    const lines = FlightReview.lines(stats);
    const distance = lines.find((line) => line.label === '飛行距離')?.value;
    expect(distance).toBe('8.6 m');
    expect(lines.filter((line) => line.value.includes('8.6'))).toHaveLength(1);
    expect(lines.find((line) => line.label === '最高速度')?.value).toBe('2.4 m/s');
  });

  it('重置後不會把傳送距離算進下一趟', () => {
    FlightReview.tick({
      position: { x: 10, y: 3, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      isFlying: true,
    });
    FlightReview.reset();
    FlightReview.tick(grounded());
    FlightReview.tick({
      position: { x: 0.1, y: 0.5, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      isFlying: true,
    });
    const stats = FlightReview.snapshot();
    expect(stats.airTicks).toBe(1);
    expect(stats.distanceM).toBeCloseTo(Math.hypot(0.1, 0.1, 0), 12);
    expect(stats.distanceM).toBeLessThan(1);
  });

  it('同一段樣本跑兩次（中間即使空等）數字相同', async () => {
    const seq: FlightReviewSample[] = [
      grounded(),
      { position: { x: 0, y: 1.5, z: -1 }, velocity: { x: 0.01, y: 0.02, z: -0.01 }, isFlying: true },
      { position: { x: 1, y: 2, z: -2 }, velocity: { x: 0.03, y: 0, z: 0 }, isFlying: true },
      grounded(),
    ];
    const run = (): ReturnType<typeof FlightReview.snapshot> => {
      FlightReview.reset();
      for (const sample of seq) FlightReview.tick(sample);
      return FlightReview.snapshot();
    };
    const first = run();
    await new Promise((r) => setTimeout(r, 20));
    expect(run()).toEqual(first);
  });

  it('未滿一分鐘以秒顯示，滿一分鐘改分:秒', () => {
    expect(FlightReview.lines({ airTicks: 0, distanceM: 0, topSpeedMps: 0, maxAltitudeM: 0 })).toEqual([
      { label: '空中時間', value: '0.0 秒' },
      { label: '飛行距離', value: '0.0 m' },
      { label: '最高速度', value: '0.0 m/s' },
      { label: '最高高度', value: '0.0 m' },
    ]);
    expect(FlightReview.lines({ airTicks: 90, distanceM: 12.34, topSpeedMps: 3.06, maxAltitudeM: 2 })[0]).toEqual({
      label: '空中時間',
      value: '1.5 秒',
    });
    expect(FlightReview.lines({ airTicks: 61 * 60, distanceM: 0, topSpeedMps: 0, maxAltitudeM: 0 })[0]?.value).toBe(
      '1:01',
    );
  });

  it('改回顧數字不會改變 replayHash 用的狀態 hash', () => {
    resetDroneState();
    droneState.position.x = 1.25;
    droneState.velocity.z = -0.02;
    droneState.yaw = 0.4;
    const before = hashToHex(hashDroneTick(FNV_OFFSET));
    FlightReview.tick({
      position: { x: 40, y: 20, z: -8 },
      velocity: { x: 1, y: 1, z: 1 },
      isFlying: true,
    });
    expect(FlightReview.snapshot().airTicks).toBe(1);
    expect(hashToHex(hashDroneTick(FNV_OFFSET))).toBe(before);
    expect(droneState.position.x).toBe(1.25);
  });

  it('足球與大亂鬥用的 tickFlightPhysics 不累計回顧', () => {
    resetDroneState();
    droneState.isFlying = true;
    droneState.isGrounded = false;
    droneState.position.y = 2;
    const before = FlightReview.snapshot();
    const frame: ControlFrame = {
      lift: 1,
      forward: 1,
      right: 0,
      yawDelta: 0,
      wantsTakeoff: true,
      anyInput: true,
    };
    tickFlightPhysics(frame);
    expect(droneState.position.y).not.toBe(2);
    expect(FlightReview.snapshot()).toEqual(before);
  });
});

const ch1 = JSON.parse(readFileSync(join(__dirname, '../../public/levels/chapter1.json'), 'utf-8'));
const levels: LevelDef[] = Array.isArray(ch1) ? ch1 : ch1.levels;
const idle: ControlFrame = { lift: 0, forward: 0, right: 0, yawDelta: 0, wantsTakeoff: false, anyInput: false };
const up: ControlFrame = { ...idle, lift: 1, wantsTakeoff: true, anyInput: true };
const fwd: ControlFrame = { ...idle, forward: 1, anyInput: true };
const down: ControlFrame = { ...idle, lift: -1, anyInput: true };

const drain = (): Promise<void> => new Promise((r) => setImmediate(r));

async function renderFrame(frames: ControlFrame[]): Promise<void> {
  const mark = beginFrame();
  for (const f of frames) {
    advanceSimTick();
    setInFixedTick(true);
    try {
      tickRecordedLevel(simNowMs(), f);
    } finally {
      setInFixedTick(false);
    }
  }
  endFrame(mark);
  await drain();
}

async function fly(frame: ControlFrame, ticks: number): Promise<void> {
  for (let i = 0; i < ticks; i++) await renderFrame([frame]);
}

describe('FlightReview 重播決定性', () => {
  beforeAll(() => {
    initRecordingSession(() => levelState.current, () => true);
  });

  beforeEach(async () => {
    if (programState.running) {
      stopProgram();
      for (let i = 0; i < 30 && programState.running; i++) await renderFrame([idle]);
    }
    setMode('manual');
    flags.countdownActive = false;
    flags.paused = false;
  });

  it('同一份輸入錄製重播兩次，回顧相同且 replayHash 不被回顧改寫', async () => {
    levelState.levels = levels;
    simTime.tick = 1000;
    applyLoadLevel('1-2');
    levelState.armed = true;
    levelState.startTime = Date.now();
    bus.emit('level-timing-started', { levelId: levelState.current!.id });

    await fly(up, 80);
    await fly(fwd, 50);
    await fly(down, 100);

    const live = FlightReview.snapshot();
    expect(live.airTicks).toBeGreaterThan(0);
    expect(live.distanceM).toBeGreaterThan(0);
    expect(live.topSpeedMps).toBeGreaterThan(0);
    expect(live.maxAltitudeM).toBeGreaterThan(0.4);

    const rec = finalizeRecording();
    expect(rec).toBeDefined();
    expect(rec).not.toHaveProperty('airTicks');
    expect(rec).not.toHaveProperty('flightReview');

    const first = await replayRecording(structuredClone(rec!));
    const afterFirst = FlightReview.snapshot();
    const second = await replayRecording(structuredClone(rec!));
    const afterSecond = FlightReview.snapshot();

    expect(first.replayHash).toBe(rec!.replayHash);
    expect(second.replayHash).toBe(rec!.replayHash);
    expect(afterFirst).toEqual(live);
    expect(afterSecond).toEqual(afterFirst);
  });

  it('程式起飛再前進：速度與航程跟位置走，兩處距離是同一個路徑長', async () => {
    levelState.levels = levels;
    simTime.tick = 2000;
    applyLoadLevel('1-2');
    levelState.armed = true;
    levelState.startTime = Date.now();
    bus.emit('level-timing-started', { levelId: levelState.current!.id });
    setMode('program');
    runProgram('await CREAFLY.takeoff(3);\nawait CREAFLY.forward(6);');
    for (let i = 0; i < 500 && programState.running; i++) await renderFrame([idle]);

    const live = FlightReview.snapshot();
    // 自地面 0.4m 升到 3m（2.6m）再水平前進 6m。
    expect(live.distanceM).toBeCloseTo(8.6, 1);
    expect(live.topSpeedMps).toBeGreaterThan(0.5);
    const distance = FlightReview.lines(live).find((line) => line.label === '飛行距離')?.value;
    expect(distance).toBe(`${live.distanceM.toFixed(1)} m`);
    expect(FlightReview.displaySpeedMps(0)).toBeGreaterThanOrEqual(0);
  });
});
