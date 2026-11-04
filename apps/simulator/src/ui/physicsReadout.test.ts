import { describe, expect, it } from 'vitest';
import { PhysicsReadout } from './physicsReadout';

describe('真實物理儀表', () => {
  it('懸停：力平衡', () => {
    const v = PhysicsReadout.of({ throttle: 0.5, thrustRatio: 1, netLift: 0.01, tilt: 0, hover: 0.5, grounded: false });
    expect(v).toMatchObject({ throttle: '50%', thrust: '1.00 × 重量', net: '力平衡', balance: 'even', fillPct: 50, hoverPct: 50 });
  });

  it('推力大於重量往上加速；小於往下', () => {
    expect(PhysicsReadout.of({ throttle: 0.7, thrustRatio: 1.4, netLift: 3.92, tilt: 0, hover: 0.5, grounded: false }).net).toBe('↑ 3.9 m/s²');
    const down = PhysicsReadout.of({ throttle: 0, thrustRatio: 0, netLift: -9.81, tilt: 0.4363, hover: 0.5, grounded: false });
    expect(down.balance).toBe('down');
    expect(down.net).toBe('↓ 9.8 m/s²');
    expect(down.tilt).toBe('25°');
  });

  it('停在地上推力不夠：地面撐住（不是力平衡在飛）', () => {
    const v = PhysicsReadout.of({ throttle: 0.2, thrustRatio: 0.4, netLift: -5.9, tilt: 0, hover: 0.5, grounded: true });
    expect(v).toMatchObject({ net: '地面撐住', balance: 'even' });
  });
});
