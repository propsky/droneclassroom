import { describe, expect, it } from 'vitest';
import { HOME_POSITION } from '../core/droneState';
import { SOCCER_FIELD } from './constants';
import { advanceRingPassage, createRingPassage, type RingCross } from './crossing';
import { formatPracticeScore, notePracticeGoals } from './practice';

const y = SOCCER_FIELD.goalY;

function ring(attackSign: 1 | -1): RingCross {
  return {
    goalZ: attackSign * SOCCER_FIELD.goalZ,
    goalY: SOCCER_FIELD.goalY,
    goalR: SOCCER_FIELD.goalR,
    shieldR: SOCCER_FIELD.shieldR,
    halfThick: SOCCER_FIELD.goalTube,
    attackSign,
  };
}

function passed(points: Array<{ x: number; y: number; z: number }>, attackSign: 1 | -1): boolean {
  let state = createRingPassage();
  let hit = false;
  for (let i = 1; i < points.length; i++) {
    const next = advanceRingPassage(state, points[i - 1]!, points[i]!, ring(attackSign));
    state = next.state;
    if (next.passed) hit = true;
  }
  return hit;
}

function line(z0: number, z1: number, step = 0.04): Array<{ x: number; y: number; z: number }> {
  const points: Array<{ x: number; y: number; z: number }> = [];
  const dir = z1 >= z0 ? 1 : -1;
  for (let z = z0; dir > 0 ? z <= z1 : z >= z1; z += dir * step) {
    points.push({ x: 0, y, z });
  }
  points.push({ x: 0, y, z: z1 });
  return points;
}

describe('自由練習計分', () => {
  it('兩端從場內向外穿門都加分，可以一直累加', () => {
    const farOut = -SOCCER_FIELD.goalZ - SOCCER_FIELD.shieldR - 0.35;
    const farIn = -SOCCER_FIELD.goalZ + 0.8;
    const nearOut = SOCCER_FIELD.goalZ + SOCCER_FIELD.shieldR + 0.35;
    const nearIn = SOCCER_FIELD.goalZ - 0.8;
    expect(passed(line(farIn, farOut), -1)).toBe(true);
    expect(passed(line(nearIn, nearOut), 1)).toBe(true);

    let count = 0;
    count = notePracticeGoals(count, true, false).count;
    count = notePracticeGoals(count, false, true).count;
    count = notePracticeGoals(count, true, true).count;
    expect(count).toBe(4);
    expect(formatPracticeScore(count)).toBe('分數：4');
    expect(formatPracticeScore(count)).not.toMatch(/完成|任務|P-[1-7]|回半場/);
  });

  it('從球門後方穿回場內不加分', () => {
    const farBehind = -SOCCER_FIELD.halfZ + SOCCER_FIELD.shieldR + 0.15;
    const farInside = -SOCCER_FIELD.goalZ + 0.9;
    const nearBehind = SOCCER_FIELD.halfZ - SOCCER_FIELD.shieldR - 0.15;
    const nearInside = SOCCER_FIELD.goalZ - 0.9;
    expect(farBehind).toBeLessThan(-SOCCER_FIELD.goalZ - SOCCER_FIELD.goalTube);
    expect(nearBehind).toBeGreaterThan(SOCCER_FIELD.goalZ + SOCCER_FIELD.goalTube);

    expect(passed(line(farBehind, farInside), -1)).toBe(false);
    expect(passed(line(nearBehind, nearInside), 1)).toBe(false);
    const stayed = notePracticeGoals(2, false, false);
    expect(stayed.scored).toBe(false);
    expect(stayed.count).toBe(2);
    expect(formatPracticeScore(stayed.count)).toBe('分數：2');
  });

  it('出生點在起飛區地面，不在圓環裡，也不會貼到端牆', () => {
    const z = SOCCER_FIELD.startZ;
    const y0 = HOME_POSITION.y;
    const r = SOCCER_FIELD.shieldR;
    expect(z).toBeCloseTo(SOCCER_FIELD.halfZ - 1.5 / 2);
    expect(Math.abs(z) + r).toBeLessThan(SOCCER_FIELD.halfZ);
    expect(z).toBeGreaterThan(SOCCER_FIELD.goalZ + SOCCER_FIELD.goalTube);
    expect(y0 + r).toBeLessThan(SOCCER_FIELD.goalY - SOCCER_FIELD.goalR);
  });
});
