import { describe, expect, it } from 'vitest';
import { pushOutOfSphere } from './contact';
import { SOCCER_FIELD } from './constants';
import {
  PRACTICE_DUMMY_R,
  practiceCrossKind,
  practiceDummySpheres,
  scorePracticeCross,
  SOCCER_DRILLS,
} from './practice';

describe('練習返半場', () => {
  it('P-3 與 P-7 要先回到自己半場，下一次穿環才算', () => {
    for (const id of ['P-3', 'P-7']) {
      const drill = SOCCER_DRILLS.find((d) => d.id === id);
      expect(drill).toBeTruthy();
      expect(practiceCrossKind(drill!)).toBe('return');
    }
    expect(practiceCrossKind(SOCCER_DRILLS.find((d) => d.id === 'P-2')!)).toBe('open');
    expect(practiceCrossKind(SOCCER_DRILLS.find((d) => d.id === 'P-6')!)).toBe('return');

    const first = scorePracticeCross({
      kind: 'return',
      returned: true,
      crossed: true,
      z: -4,
      count: 0,
      target: 3,
    });
    expect(first.scored).toBe(true);
    expect(first.count).toBe(1);
    expect(first.returned).toBe(false);

    const stillThere = scorePracticeCross({
      kind: 'return',
      returned: false,
      crossed: true,
      z: -4,
      count: 1,
      target: 3,
    });
    expect(stillThere.scored).toBe(false);
    expect(stillThere.count).toBe(1);

    const back = scorePracticeCross({
      kind: 'return',
      returned: false,
      crossed: false,
      z: 0.2,
      count: 1,
      target: 3,
    });
    expect(back.cameBack).toBe(true);
    expect(back.returned).toBe(true);

    const again = scorePracticeCross({
      kind: 'return',
      returned: true,
      crossed: true,
      z: -4,
      count: 1,
      target: 3,
    });
    expect(again.scored).toBe(true);
    expect(again.count).toBe(2);
  });
});

describe('P-5 球形假人', () => {
  it('2–4 顆、半徑 0.20、環前 0.5–1.5 m，至少一顆會動', () => {
    const still = practiceDummySpheres(0);
    const moved = practiceDummySpheres(Math.PI / 2);
    expect(still.length).toBeGreaterThanOrEqual(2);
    expect(still.length).toBeLessThanOrEqual(4);
    expect(still.some((d) => d.moving)).toBe(true);
    const goalZ = -SOCCER_FIELD.goalZ;
    for (const d of still) {
      expect(d.r).toBe(PRACTICE_DUMMY_R);
      expect(d.r).toBeCloseTo(0.2);
      const ahead = d.z - goalZ;
      expect(ahead).toBeGreaterThanOrEqual(0.5 - 1e-9);
      expect(ahead).toBeLessThanOrEqual(1.5 + 1e-9);
    }
    const patrol = still.find((d) => d.moving)!;
    const patrolLater = moved.find((d) => d.moving)!;
    expect(patrolLater.x).not.toBeCloseTo(patrol.x);
  });

  it('中線空隙用護罩半徑過得去，用 0.6 會被擋住', () => {
    const spheres = practiceDummySpheres(0).filter((d) => !d.moving);
    expect(spheres).toHaveLength(2);
    const pos = { x: 0, y: spheres[0]!.y, z: spheres[0]!.z };
    const vel = { x: 0, y: 0, z: -0.02 };
    let blocked = false;
    for (const s of spheres) {
      if (pushOutOfSphere(pos, vel, s, SOCCER_FIELD.shieldR)) blocked = true;
    }
    expect(blocked).toBe(false);
    expect(pos.x).toBeCloseTo(0);

    const wide = { x: 0, y: spheres[0]!.y, z: spheres[0]!.z };
    const wideVel = { x: 0, y: 0, z: 0 };
    let wideBlocked = false;
    for (const s of spheres) {
      if (pushOutOfSphere(wide, wideVel, s, 0.6)) wideBlocked = true;
    }
    expect(wideBlocked).toBe(true);
  });
});
