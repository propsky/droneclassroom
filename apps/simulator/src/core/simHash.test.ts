import { describe, expect, it } from 'vitest';
import { FNV_OFFSET, hashDroneTick, hashToHex } from './simHash';
import { droneState, resetDroneState } from './droneState';

describe('simHash', () => {
  it('相同狀態產生相同 hash', () => {
    resetDroneState();
    droneState.position.x = 1.5;
    droneState.yaw = 0.3;
    const h1 = hashToHex(hashDroneTick(FNV_OFFSET));
    const h2 = hashToHex(hashDroneTick(FNV_OFFSET));
    expect(h1).toBe(h2);
  });
});
