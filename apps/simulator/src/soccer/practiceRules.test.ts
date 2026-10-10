import { describe, expect, it } from 'vitest';
import { pushOutOfSphere } from './contact';
import { SOCCER_FIELD } from './constants';
import {
  formatPracticeStatus,
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
    expect(practiceCrossKind(SOCCER_DRILLS.find((d) => d.id === 'P-4')!)).toBe('open');
    expect(practiceCrossKind(SOCCER_DRILLS.find((d) => d.id === 'P-5')!)).toBe('open');
    expect(practiceCrossKind(SOCCER_DRILLS.find((d) => d.id === 'P-1')!)).toBe('free');
    expect(practiceCrossKind(SOCCER_DRILLS.find((d) => d.id === 'P-6')!)).toBe('alternate');

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

    const reverse = scorePracticeCross({
      kind: 'return',
      returned: true,
      crossed: true,
      end: 'near',
      z: 4,
      count: 0,
      target: 3,
    });
    expect(reverse.scored).toBe(false);
    expect(reverse.count).toBe(0);
  });

  it('P-2 與 P-4 只接受遠端進攻方向的一次穿環', () => {
    for (const id of ['P-2', 'P-4']) {
      const drill = SOCCER_DRILLS.find((d) => d.id === id)!;
      expect(practiceCrossKind(drill)).toBe('open');
      const near = scorePracticeCross({
        kind: 'open',
        returned: true,
        crossed: true,
        end: 'near',
        z: 5,
        count: 0,
        target: 1,
      });
      expect(near.scored).toBe(false);
      const far = scorePracticeCross({
        kind: 'open',
        returned: true,
        crossed: true,
        end: 'far',
        z: -5,
        count: 0,
        target: 1,
      });
      expect(far.scored).toBe(true);
      expect(far.done).toBe(true);
    }
  });

  it('P-6 要交替攻兩端，同一環抖或沒回到該回的半場都不算', () => {
    const first = scorePracticeCross({
      kind: 'alternate',
      returned: true,
      crossed: true,
      end: 'far',
      nextEnd: 'far',
      z: -5.8,
      count: 0,
      target: 3,
    });
    expect(first.scored).toBe(true);
    expect(first.count).toBe(1);
    expect(first.nextEnd).toBe('near');
    expect(first.returned).toBe(false);

    const jitter = scorePracticeCross({
      kind: 'alternate',
      returned: false,
      crossed: true,
      end: 'far',
      nextEnd: 'near',
      z: -5.2,
      count: 1,
      target: 3,
    });
    expect(jitter.scored).toBe(false);
    expect(jitter.count).toBe(1);

    const stillFar = scorePracticeCross({
      kind: 'alternate',
      returned: false,
      crossed: false,
      nextEnd: 'near',
      z: -1,
      count: 1,
      target: 3,
    });
    expect(stillFar.returned).toBe(false);

    const home = scorePracticeCross({
      kind: 'alternate',
      returned: false,
      crossed: false,
      nextEnd: 'near',
      z: 0.3,
      count: 1,
      target: 3,
    });
    expect(home.cameBack).toBe(true);
    expect(home.returned).toBe(true);

    const sameRing = scorePracticeCross({
      kind: 'alternate',
      returned: true,
      crossed: true,
      end: 'far',
      nextEnd: 'near',
      z: -5.8,
      count: 1,
      target: 3,
    });
    expect(sameRing.scored).toBe(false);

    const other = scorePracticeCross({
      kind: 'alternate',
      returned: true,
      crossed: true,
      end: 'near',
      nextEnd: 'near',
      z: 5.8,
      count: 1,
      target: 3,
    });
    expect(other.scored).toBe(true);
    expect(other.count).toBe(2);
    expect(other.nextEnd).toBe('far');
    expect(other.returned).toBe(false);

    const wrongHalf = scorePracticeCross({
      kind: 'alternate',
      returned: false,
      crossed: false,
      nextEnd: 'far',
      z: 0.4,
      count: 2,
      target: 3,
    });
    expect(wrongHalf.returned).toBe(false);

    const otherHalf = scorePracticeCross({
      kind: 'alternate',
      returned: false,
      crossed: false,
      nextEnd: 'far',
      z: -0.3,
      count: 2,
      target: 3,
    });
    expect(otherHalf.returned).toBe(true);
  });
});

describe('練習 HUD', () => {
  it('P-3、P-6 會寫出現在要做的事，不只寫來回', () => {
    const p3 = SOCCER_DRILLS.find((d) => d.id === 'P-3')!;
    const waiting = formatPracticeStatus({
      drill: p3,
      status: 'running',
      count: 1,
      returned: false,
      nextEnd: 'far',
      elapsedSec: 10,
    });
    expect(waiting).toContain('先過中線');
    expect(waiting).toContain('自己半場');
    expect(waiting).toContain('反方向');
    expect(waiting).toContain('穿遠端環 1/3');

    const p6 = SOCCER_DRILLS.find((d) => d.id === 'P-6')!;
    const attackNear = formatPracticeStatus({
      drill: p6,
      status: 'running',
      count: 1,
      returned: true,
      nextEnd: 'near',
      elapsedSec: 8,
    });
    expect(attackNear).toContain('近端環');
    expect(attackNear).toContain('兩端進攻 1/3');
    expect(attackNear).not.toMatch(/^\s*來回\s*$/);

    const p4 = SOCCER_DRILLS.find((d) => d.id === 'P-4')!;
    const timed = formatPracticeStatus({
      drill: p4,
      status: 'running',
      count: 0,
      returned: true,
      nextEnd: 'far',
      elapsedSec: 1.2,
    });
    expect(timed).toContain('只飛過高度不算');
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
