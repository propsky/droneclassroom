import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { droneState, flags, realFlight, resetDroneState, TICK_HZ } from '../core/droneState';
import {
  applyManualControls,
  applyRealControls,
  integrate,
  integrateReal,
  realPhysicsOn,
  type ControlFrame,
} from '../core/physics';
import { RealFlight } from '../core/realFlight';
import { GameSession } from '../core/session';
import { F9A_A, F9A_B } from './constants';
import {
  applySoccerFeel,
  resetSoccerAttitude,
  setSoccerFeel,
  soccerRealTuning,
  soccerSpeedScale,
  SOCCER_FEELS,
  type SoccerFeelId,
} from './flightFeel';
import { soccerFeelNote } from '../ui/soccerHud';

const idle: ControlFrame = { lift: 0, forward: 0, right: 0, yawDelta: 0, wantsTakeoff: false, anyInput: false };
/** 鍵盤只有全推或不推 */
const key = (f: Partial<ControlFrame>): ControlFrame => ({ ...idle, anyInput: true, ...f });
const B = F9A_B.halfZ;

function inAir(y = 1.5): void {
  resetDroneState();
  droneState.position.y = y;
  droneState.isGrounded = false;
  droneState.isFlying = true;
}

/** 簡易物理足球一個 tick（同 main.ts：手感改寫 → 推力 → 積分），回傳這 tick 的位移。場地是預設 F9A-B */
function arcadeTick(frame: ControlFrame): { dx: number; dy: number; dz: number } {
  const p0 = { ...droneState.position };
  applyManualControls(applySoccerFeel(frame, { enabled: true, locked: false }));
  integrate();
  const p = droneState.position;
  return { dx: p.x - p0.x, dy: p.y - p0.y, dz: p.z - p0.z };
}

function realTick(frame: ControlFrame, id: SoccerFeelId, scale = 1): void {
  const felt = applySoccerFeel(frame, { enabled: true, locked: false, real: true });
  const tune = soccerRealTuning(id, scale);
  applyRealControls(felt, tune);
  integrateReal(tune);
}

const horizMps = (): number => Math.hypot(droneState.velocity.x, droneState.velocity.z) * TICK_HZ;

beforeEach(() => {
  flags.physics = 'arcade';
  resetDroneState();
  resetSoccerAttitude();
  setSoccerFeel('sim');
});

afterEach(() => {
  setSoccerFeel('sim');
  flags.physics = 'arcade';
});

describe('足球速度對齊場地（鍵盤滿推）', () => {
  it('小場（F9A-B）各檔滿推的水平極速 = 手感設定的 m/s，最快不超過 4 m/s', () => {
    for (const id of ['beginner', 'sim', 'pro', 'angle'] as const) {
      setSoccerFeel(id);
      resetSoccerAttitude();
      inAir(1.5);
      let step = { dx: 0, dy: 0, dz: 0 };
      for (let i = 0; i < 300; i++) {
        droneState.position.y = 1.5; // 無定高鬆桿會下降，固定高度只量水平
        step = arcadeTick(key({ forward: 1 }));
      }
      const v = Math.hypot(step.dx, step.dz) * TICK_HZ;
      expect(v).toBeCloseTo(SOCCER_FEELS[id].topSpeed, 2);
      expect(v).toBeLessThanOrEqual(4.0001);
    }
  });

  it('6 m 長的場地：模擬檔滿推從起飛區飛到對面要 2 秒以上（以前不到 1 秒）', () => {
    inAir(1.5);
    let ticks = 0;
    while (droneState.position.z > -6 && ticks < 600) {
      arcadeTick(key({ forward: 1 }));
      ticks++;
    }
    expect(ticks / TICK_HZ).toBeGreaterThan(2);
  });

  it('定高檔滿桿升降 = 手感設定的 m/s，3 m 高的場地不會一下衝頂', () => {
    for (const id of ['beginner', 'sim', 'pro'] as const) {
      setSoccerFeel(id);
      inAir(0.5);
      let step = { dx: 0, dy: 0, dz: 0 };
      for (let i = 0; i < 300; i++) {
        droneState.position.y = 1; // 不讓它撞天花板，只量穩態速度
        step = arcadeTick(key({ lift: 1 }));
      }
      expect(step.dy * TICK_HZ).toBeCloseTo(SOCCER_FEELS[id].climb, 2);
      expect(step.dy * TICK_HZ).toBeLessThan(2.5);
    }
  });

  it('無定高：鬆桿以 sink 下降、滿桿淨爬升 = climb − sink', () => {
    setSoccerFeel('angle');
    const p = SOCCER_FEELS.angle;
    inAir(2);
    let step = { dx: 0, dy: 0, dz: 0 };
    for (let i = 0; i < 300; i++) {
      droneState.position.y = 2;
      step = arcadeTick(idle);
    }
    expect(step.dy * TICK_HZ).toBeCloseTo(-p.sink, 2);
    for (let i = 0; i < 300; i++) {
      droneState.position.y = 2;
      step = arcadeTick(key({ lift: 1 }));
    }
    expect(step.dy * TICK_HZ).toBeCloseTo(p.climb - p.sink, 2);
  });

  it('大場（F9A-A）放大約 1.5 倍，夾在 0.7～1.6', () => {
    expect(soccerSpeedScale(B)).toBe(1);
    expect(soccerSpeedScale(F9A_A.halfZ)).toBeCloseTo(Math.sqrt(7 / 3), 9);
    expect(soccerSpeedScale(0.5)).toBe(0.7);
    expect(soccerSpeedScale(100)).toBe(1.6);
  });
});

describe('足球真實物理（油門＋重力）', () => {
  it('平飛（補油門維持高度）＋滿舵：水平極速 = 這一檔的 m/s（傾角照手感檔）', () => {
    for (const id of ['beginner', 'sim', 'pro'] as const) {
      setSoccerFeel(id);
      inAir(1.5);
      RealFlight.hover();
      for (let i = 0; i < 900; i++) {
        // 傾斜後垂直分力變小，飛手會補油門到 懸停 ÷ cos(傾角) 維持高度
        realFlight.throttle = RealFlight.HOVER / Math.cos(RealFlight.tilt());
        realTick(key({ forward: 1 }), id);
      }
      expect(Math.abs(droneState.position.y - 1.5)).toBeLessThan(0.2);
      expect(RealFlight.tilt()).toBeCloseTo((SOCCER_FEELS[id].maxTiltDeg * Math.PI) / 180, 3);
      expect(horizMps()).toBeCloseTo(SOCCER_FEELS[id].topSpeed, 1);
    }
  });

  it('放開搖桿會滑一段（慣性），簡易物理幾乎馬上停', () => {
    // 真實：先衝到極速再放開 0.5 秒
    inAir(1.5);
    RealFlight.hover();
    for (let i = 0; i < 600; i++) {
      realFlight.throttle = RealFlight.HOVER / Math.cos(RealFlight.tilt());
      realTick(key({ forward: 1 }), 'sim');
    }
    const realTop = horizMps();
    realFlight.throttle = RealFlight.HOVER;
    for (let i = 0; i < 30; i++) realTick(idle, 'sim');
    const realLeft = horizMps() / realTop;

    inAir(1.5);
    resetSoccerAttitude();
    for (let i = 0; i < 600; i++) arcadeTick(key({ forward: 1 }));
    const arcadeTop = horizMps();
    for (let i = 0; i < 30; i++) arcadeTick(idle);
    const arcadeLeft = horizMps() / arcadeTop;

    expect(realLeft).toBeGreaterThan(0.4);
    expect(arcadeLeft).toBeLessThan(0.25);
  });

  it('油門關掉會掉下來（重力），懸停油門停在原高度', () => {
    inAir(2.5);
    RealFlight.hover();
    for (let i = 0; i < 120; i++) realTick(idle, 'sim');
    expect(droneState.position.y).toBeCloseTo(2.5, 6);

    realFlight.throttle = 0;
    for (let i = 0; i < 30; i++) realTick(idle, 'sim');
    expect(droneState.position.y).toBeLessThan(2.2);
    expect(droneState.velocity.y).toBeLessThan(0);
  });

  it('鎖控（開賽倒數）時搖桿無效，地上的油門不會被推上去', () => {
    resetDroneState();
    for (let i = 0; i < 120; i++) {
      const felt = applySoccerFeel(key({ lift: 1, forward: 1, wantsTakeoff: true }), {
        enabled: true,
        locked: true,
        real: true,
      });
      const tune = soccerRealTuning('sim', 1);
      applyRealControls(felt, tune);
      integrateReal(tune);
    }
    expect(realFlight.throttle).toBe(0);
    expect(droneState.isGrounded).toBe(true);
  });

  it('關卡的參數沒變（伺服器重播綁這一組）', () => {
    expect(RealFlight.LEVEL).toEqual({
      maxTilt: (25 * Math.PI) / 180,
      attitudeGain: 0.13,
      levelGain: 0.13,
      dragLinear: 0.4,
      dragQuad: 0.08,
    });
  });
});

describe('哪些模式吃真實物理', () => {
  afterEach(() => {
    for (const s of ['arena', 'soccer-practice', 'soccer-match', 'level'] as const) {
      if (GameSession.active === s) GameSession.exit(s);
    }
  });

  it('關卡與足球（練習、對戰）生效，大亂鬥固定簡易', () => {
    flags.physics = 'real';
    expect(realPhysicsOn()).toBe(true); // idle（伺服器重播）
    GameSession.enter('soccer-practice');
    expect(realPhysicsOn()).toBe(true);
    GameSession.exit('soccer-practice');
    GameSession.enter('soccer-match');
    expect(realPhysicsOn()).toBe(true);
    GameSession.exit('soccer-match');
    GameSession.enter('arena');
    expect(realPhysicsOn()).toBe(false);
    GameSession.exit('arena');
    flags.physics = 'arcade';
    GameSession.enter('soccer-practice');
    expect(realPhysicsOn()).toBe(false);
  });
});

describe('手感列的說明', () => {
  it('簡易物理寫極速與升降，真實物理寫油門＋重力、會滑行', () => {
    expect(soccerFeelNote('sim', 'arcade', 1)).toBe('最快 2.8 m/s・升降 1.6 m/s・放開就停');
    expect(soccerFeelNote('angle', 'arcade', 1)).toContain('不定高');
    expect(soccerFeelNote('sim', 'real', 1)).toBe('真實物理：油門＋重力，放開會滑行・最快 2.8 m/s');
    expect(soccerFeelNote('angle', 'real', 1)).toContain('同模擬');
    expect(soccerFeelNote('pro', 'arcade', soccerSpeedScale(F9A_A.halfZ))).toContain('6.1 m/s');
  });
});
