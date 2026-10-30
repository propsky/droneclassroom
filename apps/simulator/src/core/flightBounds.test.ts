// 飛行範圍：關卡設了 flightBounds，學生怎麼推桿都飛不出框；離開關卡就解除。
import { describe, expect, it } from 'vitest';
import type { LevelDef } from '@creafly/shared';
import { bootstrapLevelForReplay, clearLevel } from './level';
import { droneState, DRONE_RADIUS } from './droneState';
import { currentFlightBounds, type ControlFrame } from './physics';
import { tickFlightPhysics } from './simTick';

const idle: ControlFrame = { lift: 0, forward: 0, right: 0, yawDelta: 0, wantsTakeoff: false, anyInput: false };

function fly(frame: Partial<ControlFrame>, ticks: number): void {
  for (let i = 0; i < ticks; i++) tickFlightPhysics({ ...idle, anyInput: true, ...frame });
}

function takeOff(): void {
  fly({ lift: 1, wantsTakeoff: true }, 60);
}

const fenced: LevelDef = {
  id: 't-fence',
  name: '飛行範圍',
  flightBounds: { minX: -4, maxX: 4, minZ: -6, maxZ: 2 },
};

describe('飛行範圍', () => {
  it('一直往前飛：停在前方邊界內側，不會穿出去', () => {
    bootstrapLevelForReplay(fenced);
    takeOff();
    fly({ forward: 1 }, 600);
    expect(droneState.position.z).toBeCloseTo(-6 + DRONE_RADIUS, 6);
    expect(droneState.isFlying).toBe(true);
  });

  it('一直往右、往後飛：兩個方向都擋住', () => {
    bootstrapLevelForReplay(fenced);
    takeOff();
    fly({ right: 1 }, 600);
    expect(droneState.position.x).toBeCloseTo(4 - DRONE_RADIUS, 6);
    fly({ forward: -1 }, 600);
    expect(droneState.position.z).toBeCloseTo(2 - DRONE_RADIUS, 6);
  });

  it('碰到邊界後往回飛：馬上能離開邊界', () => {
    bootstrapLevelForReplay(fenced);
    takeOff();
    fly({ forward: 1 }, 600);
    fly({ forward: -1 }, 30);
    expect(droneState.position.z).toBeGreaterThan(-6 + DRONE_RADIUS + 0.5);
  });

  it('沒設範圍的關卡：照舊不限', () => {
    bootstrapLevelForReplay({ id: 't-free', name: '不限' });
    expect(currentFlightBounds()).toBeNull();
    takeOff();
    fly({ forward: 1 }, 600);
    expect(droneState.position.z).toBeLessThan(-20);
  });

  it('離開關卡（進大亂鬥 / 足球）：範圍解除', () => {
    bootstrapLevelForReplay(fenced);
    expect(currentFlightBounds()).not.toBeNull();
    clearLevel();
    expect(currentFlightBounds()).toBeNull();
  });
});
