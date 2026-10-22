import { afterEach, describe, expect, it } from 'vitest';
import { droneState, flags, isManualLocked, resetDroneState } from '../core/droneState';
import { tickFlightPhysics } from '../core/simTick';
import { StudentDispatch } from './studentDispatch';

const frame = {
  lift: 1,
  forward: 1,
  right: 0,
  yawDelta: 0,
  wantsTakeoff: true,
  anyInput: true,
};

describe('學生等待派送', () => {
  afterEach(() => {
    StudentDispatch.reset();
    flags.dispatchHold = false;
    flags.mode = 'manual';
    flags.programRunning = false;
    resetDroneState();
  });

  it('看板期間鎖住手動飛行，放開後恢復', () => {
    expect(isManualLocked()).toBe(false);
    StudentDispatch.hold('soccer');
    expect(StudentDispatch.isHeld()).toBe(true);
    expect(flags.dispatchHold).toBe(true);
    expect(isManualLocked()).toBe(true);
    StudentDispatch.release();
    expect(flags.dispatchHold).toBe(false);
    expect(isManualLocked()).toBe(false);
  });

  it('等待時速度歸零，推力不會把飛機往前送', () => {
    resetDroneState();
    droneState.isGrounded = false;
    droneState.isFlying = true;
    droneState.velocity.x = 0.4;
    const x = droneState.position.x;
    flags.dispatchHold = true;
    tickFlightPhysics(frame);
    expect(droneState.velocity.x).toBe(0);
    expect(droneState.position.x).toBe(x);
    expect(droneState.isFlying).toBe(true);
  });

  it('斷線會清掉等待，避免卡在看板上', () => {
    StudentDispatch.hold('arena');
    StudentDispatch.reset();
    expect(StudentDispatch.isHeld()).toBe(false);
    expect(flags.dispatchHold).toBe(false);
  });
});
