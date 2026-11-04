import { beforeEach, describe, expect, it } from 'vitest';
import { droneState, flags, realFlight, resetDroneState, TICK_HZ } from './droneState';
import { applyManualControls, applyRealControls, integrate, integrateReal, setFlightPhysics, type ControlFrame } from './physics';
import { RealFlight } from './realFlight';
import { bus } from './events';

const idle: ControlFrame = { lift: 0, forward: 0, right: 0, yawDelta: 0, wantsTakeoff: false, anyInput: false };
const stick = (f: Partial<ControlFrame>): ControlFrame => ({ ...idle, anyInput: true, ...f });

function real(frame: ControlFrame | null, ticks = 1): void {
  for (let i = 0; i < ticks; i++) {
    applyRealControls(frame);
    integrateReal();
  }
}

/** 放到高空、懸停油門，方便量水平速度不撞地 */
function hoverAt(y: number): void {
  resetDroneState();
  droneState.position.y = y;
  droneState.isGrounded = false;
  droneState.isFlying = true;
  RealFlight.hover();
}

const mps = (v: number): number => v * TICK_HZ;
const horiz = (): number => mps(Math.hypot(droneState.velocity.x, droneState.velocity.z));

beforeEach(() => {
  flags.physics = 'arcade';
  resetDroneState();
});

describe('真實物理（重力＋油門）', () => {
  it('懸停油門：推力 = 重量，停在原高度', () => {
    hoverAt(5);
    real(idle, 600);
    expect(droneState.position.y).toBeCloseTo(5, 6);
    expect(RealFlight.netLift()).toBeCloseTo(0, 9);
  });

  it('油門 0：自由落體，第一 tick 速度增加 g·dt', () => {
    hoverAt(20);
    realFlight.throttle = realFlight.thrust = 0;
    real(idle, 1);
    expect(mps(droneState.velocity.y) * TICK_HZ).toBeCloseTo(-RealFlight.G, 6);
    real(idle, 300);
    expect(droneState.isGrounded).toBe(true);
  });

  it('地上：油門不到懸停飛不起來；推上去經過懸停會卡一下，超過才離地', () => {
    real(stick({ lift: 1 }), 44);
    expect(realFlight.throttle).toBeLessThan(RealFlight.HOVER);
    expect(droneState.isGrounded).toBe(true);
    real(stick({ lift: 1 }), 1);
    expect(realFlight.throttle).toBe(RealFlight.HOVER);
    real(stick({ lift: 1 }), RealFlight.DETENT_TICKS);
    expect(realFlight.throttle).toBe(RealFlight.HOVER);
    expect(droneState.isGrounded).toBe(true);
    real(stick({ lift: 1 }), 20);
    expect(realFlight.throttle).toBeGreaterThan(RealFlight.HOVER);
    real(idle, 30);
    expect(droneState.isFlying).toBe(true);
    expect(droneState.position.y).toBeGreaterThan(0.4);
  });

  it('放開油門桿：油門停在原處（不像簡易物理彈回懸停）', () => {
    hoverAt(5);
    real(stick({ lift: 1 }), 30);
    const t = realFlight.throttle;
    real(idle, 60);
    expect(realFlight.throttle).toBe(t);
    expect(droneState.velocity.y).toBeGreaterThan(0);
  });

  it('前推：機身傾斜、往前加速；放開回平，速度慢慢滑停而不是馬上停', () => {
    hoverAt(15);
    real(stick({ forward: 1 }), 60);
    expect(realFlight.pitch).toBeGreaterThan(RealFlight.MAX_TILT * 0.99);
    expect(droneState.velocity.z).toBeLessThan(0); // 機頭朝 -Z
    const v0 = horiz();
    real(idle, 30);
    expect(Math.abs(realFlight.pitch)).toBeLessThan(0.02);
    expect(horiz()).toBeGreaterThan(v0 * 0.5);
    expect(horiz()).toBeLessThan(v0);
  });

  it('傾斜時往上的推力變少：只給懸停油門往前飛會掉高度', () => {
    hoverAt(15);
    real(stick({ forward: 1 }), 120);
    expect(droneState.position.y).toBeLessThan(15);
  });

  it('極速：任何方向、滿油門滿傾角都慢於簡易物理（排行榜不會因切換變快）', () => {
    // 簡易物理正前方極速
    resetDroneState();
    droneState.position.y = 15;
    droneState.isGrounded = false;
    droneState.isFlying = true;
    for (let i = 0; i < 600; i++) {
      applyManualControls(stick({ forward: 1 }));
      integrate();
    }
    const arcade = horiz();
    expect(arcade).toBeGreaterThan(8);

    hoverAt(29);
    let top = 0;
    for (let i = 0; i < 900; i++) {
      // 滿油門 + 斜前方滿傾角，高度保持在天花板下面
      real(stick({ lift: droneState.position.y < 25 ? 1 : -1, forward: 1, right: 1 }), 1);
      top = Math.max(top, horiz());
    }
    expect(top).toBeLessThan(arcade);
    expect(top).toBeGreaterThan(6);
  });

  it('急停：原地懸住不受重力；推桿恢復從懸停接手', () => {
    hoverAt(5);
    realFlight.throttle = realFlight.thrust = 0;
    droneState.frozen = true;
    real(idle, 60);
    expect(droneState.position.y).toBe(5);
    real(stick({ forward: 1 }), 1);
    expect(droneState.frozen).toBe(false);
    expect(realFlight.throttle).toBe(RealFlight.HOVER);
  });

  it('切換：空中切進真實物理從懸停接手；地上切進油門為 0', () => {
    resetDroneState();
    droneState.isGrounded = false;
    droneState.isFlying = true;
    droneState.position.y = 3;
    setFlightPhysics('real');
    expect(realFlight.throttle).toBe(RealFlight.HOVER);
    setFlightPhysics('arcade');
    expect(droneState.attitudePitch).toBeNull();
    resetDroneState();
    setFlightPhysics('real');
    expect(realFlight.throttle).toBe(0);
  });

  it('重落地發撞擊事件（m/s），輕輕落地不發', () => {
    const hits: number[] = [];
    const off = bus.on('impact', ({ speed, surface }) => surface === 'floor' && hits.push(speed));
    hoverAt(6);
    realFlight.throttle = realFlight.thrust = 0;
    real(idle, 200);
    expect(hits.length).toBe(1);
    expect(hits[0]).toBeGreaterThan(5);
    hoverAt(0.45);
    realFlight.throttle = 0.48;
    real(idle, 200);
    expect(hits.length).toBe(1);
    off();
  });
});
