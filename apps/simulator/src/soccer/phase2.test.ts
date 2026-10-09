import { describe, expect, it } from 'vitest';
import { droneState, resetDroneState } from '../core/droneState';
import type { ControlFrame } from '../core/physics';
import { SOCCER_BALL_R, SOCCER_CONTACT_R, SOCCER_FIELD } from './constants';
import { bounceSoccerWalls, resolveShieldContact } from './contact';
import { shieldPassesRing } from './crossing';
import {
  applySoccerFeel,
  resetSoccerAttitude,
  setSoccerFeel,
  soccerAttitude,
  SOCCER_FEELS,
} from './flightFeel';
import { formatSoccerMatchLine, type SoccerHudInput } from '../ui/soccerHud';

const ring = {
  goalZ: SOCCER_FIELD.goalZ,
  goalY: SOCCER_FIELD.goalY,
  goalR: SOCCER_FIELD.goalR,
  shieldR: SOCCER_BALL_R,
  attackSign: 1,
};

describe('F9A 階段二穿環', () => {
  const y = SOCCER_FIELD.goalY;
  const before = SOCCER_FIELD.goalZ - SOCCER_BALL_R - 0.1;
  const through = SOCCER_FIELD.goalZ + SOCCER_BALL_R + 0.1;

  it('護罩後緣沿行進方向整顆穿過才算', () => {
    expect(shieldPassesRing({ x: 0, y, z: before }, { x: 0, y, z: through }, ring)).toBe(true);
  });

  it('球心到門面但後緣沒過、擦框、反向都不算', () => {
    expect(
      shieldPassesRing({ x: 0, y, z: before }, { x: 0, y, z: SOCCER_FIELD.goalZ }, ring),
    ).toBe(false);
    const graze = SOCCER_FIELD.goalR - SOCCER_BALL_R + 0.05;
    expect(
      shieldPassesRing({ x: graze, y, z: before }, { x: graze, y, z: through }, ring),
    ).toBe(false);
    expect(shieldPassesRing({ x: 0, y, z: through }, { x: 0, y, z: before }, ring)).toBe(false);
  });
});

describe('F9A 階段二碰撞', () => {
  it('碰撞半徑就是護罩，重疊會被推開且速度反向', () => {
    expect(SOCCER_CONTACT_R).toBe(SOCCER_BALL_R);
    const self = { x: 0, y: 1, z: 0, vx: 0.05, vy: 0, vz: 0 };
    const other = { x: 0.1, y: 1, z: 0 };
    const hit = resolveShieldContact(self, other, 'a', 'b', SOCCER_BALL_R);
    expect(hit.separated).toBe(true);
    const dist = Math.hypot(self.x - other.x, self.y - other.y, self.z - other.z);
    expect(dist).toBeGreaterThanOrEqual(SOCCER_BALL_R * 2 - 1e-6);
    expect(self.vx).toBeLessThan(0);
  });

  it('牆面輕彈，不把向外速度夾成 0', () => {
    const pos = { x: SOCCER_FIELD.halfX, y: 1, z: 0 };
    const vel = { x: 0.1, y: 0, z: 0 };
    bounceSoccerWalls(pos, vel, {
      halfX: SOCCER_FIELD.halfX,
      halfZ: SOCCER_FIELD.halfZ,
      top: SOCCER_FIELD.top,
    }, SOCCER_BALL_R);
    expect(pos.x).toBeCloseTo(SOCCER_FIELD.halfX - SOCCER_BALL_R);
    expect(vel.x).toBeLessThan(0);
    expect(vel.x).not.toBe(0);
  });
});

function stick(forward: number): ControlFrame {
  return { lift: 0, forward, right: 0, yawDelta: 0, wantsTakeoff: false, anyInput: forward !== 0 };
}

describe('F9A 階段二手感', () => {
  it('三檔最大傾角是 18／30／42，鬆桿時新手回正比專業快', () => {
    expect(SOCCER_FEELS.beginner.maxTiltDeg).toBe(18);
    expect(SOCCER_FEELS.sim.maxTiltDeg).toBe(30);
    expect(SOCCER_FEELS.pro.maxTiltDeg).toBe(42);
    expect(SOCCER_FEELS.beginner.autoLevel).toBeGreaterThan(SOCCER_FEELS.pro.autoLevel);

    resetDroneState();
    setSoccerFeel('beginner');
    resetSoccerAttitude();
    for (let i = 0; i < 80; i++) applySoccerFeel(stick(1), { enabled: true, locked: false });
    const beginner = soccerAttitude().pitch;
    expect(beginner).toBeGreaterThan((17 * Math.PI) / 180);
    expect(beginner).toBeLessThanOrEqual((18 * Math.PI) / 180 + 1e-6);

    setSoccerFeel('pro');
    resetSoccerAttitude();
    for (let i = 0; i < 120; i++) applySoccerFeel(stick(1), { enabled: true, locked: false });
    const pro = soccerAttitude().pitch;
    expect(pro).toBeGreaterThan((40 * Math.PI) / 180);
    expect(pro).toBeLessThanOrEqual((42 * Math.PI) / 180 + 1e-6);

    const hold = pro;
    for (let i = 0; i < 25; i++) applySoccerFeel(stick(0), { enabled: true, locked: false });
    const proLeft = soccerAttitude().pitch / hold;

    setSoccerFeel('beginner');
    resetSoccerAttitude();
    droneState.attitudePitch = hold;
    // 直接把內部姿態拉到同一個角度再鬆桿：用滿舵建立後再比回正比例
    for (let i = 0; i < 80; i++) applySoccerFeel(stick(1), { enabled: true, locked: false });
    const bHold = soccerAttitude().pitch;
    for (let i = 0; i < 25; i++) applySoccerFeel(stick(0), { enabled: true, locked: false });
    const beginnerLeft = soccerAttitude().pitch / bHold;
    expect(beginnerLeft).toBeLessThan(proLeft);
  });
});

function hud(over: Partial<SoccerHudInput> = {}): SoccerHudInput {
  return {
    status: 'running',
    mode: 'striker',
    scores: { blue: 0, red: 0 },
    sets: { blue: 0, red: 0 },
    period: 1,
    endTime: 10_000,
    now: 0,
    myTeam: 'blue',
    myStriker: true,
    needReturn: false,
    pkScores: { blue: 0, red: 0 },
    pkTurn: null,
    pkRound: 0,
    foul: false,
    ...over,
  };
}

describe('F9A 階段二 HUD', () => {
  it('開賽寫起槳，罰球與黃牌會出現在計分列', () => {
    expect(formatSoccerMatchLine(hud({ status: 'countdown', endTime: 0 }))).toContain('起槳');
    const pen = formatSoccerMatchLine(
      hud({ status: 'penalty', foul: true, foulReason: 'false_start', endTime: 10_000, now: 0 }),
    );
    expect(pen).toContain('罰球 10 秒');
    expect(pen).toContain('搶跑');
    expect(formatSoccerMatchLine(hud({ card: 'yellow' }))).toContain('黃牌');
    expect(formatSoccerMatchLine(hud({ card: 'yellow' }))).toContain('本局出場');
    expect(formatSoccerMatchLine(hud({ disabled: true, card: 'red' }))).toContain('整場出場');
    expect(formatSoccerMatchLine(hud({ disabled: true, card: null }))).toContain('本局少一人');
    expect(formatSoccerMatchLine(hud({ myStriker: false, needReturn: true }))).toContain('全隊先退回半場');
  });
});
