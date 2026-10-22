import { describe, expect, it } from 'vitest';
import { HOME_POSITION } from '../core/droneState';
import { SOCCER_FIELD, SOCCER_START_DEPTH } from './constants';
import { advanceRingPassage, createRingPassage, type RingCross } from './crossing';
import { formatPracticeScore, PracticeScoring } from './practice';

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

describe('自由練習跟對戰同一套進球', () => {
  it('只有從場內正面穿對方門才加分，之後要回自己半場', () => {
    const farOut = -SOCCER_FIELD.goalZ - SOCCER_FIELD.shieldR - 0.35;
    const farIn = -SOCCER_FIELD.goalZ + 0.8;
    expect(passed(line(farIn, farOut), PracticeScoring.attackSign)).toBe(true);

    const first = PracticeScoring.apply(0, false, true, false, -1);
    expect(first).toEqual({ count: 1, needReturn: true, scored: true });
    const again = PracticeScoring.apply(first.count, true, true, false, -1);
    expect(again.scored).toBe(false);
    expect(again.count).toBe(1);
    const home = PracticeScoring.apply(first.count, true, false, false, 0.4);
    expect(home.needReturn).toBe(false);
    const second = PracticeScoring.apply(home.count, false, true, false, -1);
    expect(second.count).toBe(2);
    expect(formatPracticeScore(second.count)).toBe('分數：2');
    expect(formatPracticeScore(second.count)).not.toMatch(/完成|任務|P-[1-7]/);
  });

  it('自己的門與從球門後方穿回都不加分', () => {
    const own = PracticeScoring.apply(2, false, false, true, 1);
    expect(own.scored).toBe(false);
    expect(own.count).toBe(2);

    const farBehind = -SOCCER_FIELD.halfZ + SOCCER_FIELD.shieldR + 0.05;
    const farInside = -SOCCER_FIELD.goalZ + 0.9;
    expect(farBehind).toBeLessThan(-SOCCER_FIELD.goalZ - SOCCER_FIELD.goalTube);
    expect(passed(line(farBehind, farInside), PracticeScoring.attackSign)).toBe(false);
  });

  it('出生點在起飛區地面，不在圓環裡', () => {
    const z = SOCCER_FIELD.startZ;
    const y0 = HOME_POSITION.y;
    const r = SOCCER_FIELD.shieldR;
    expect(z).toBeCloseTo(SOCCER_FIELD.halfZ - SOCCER_START_DEPTH / 2);
    expect(Math.abs(z) + r).toBeLessThan(SOCCER_FIELD.halfZ);
    expect(z).toBeGreaterThan(SOCCER_FIELD.goalZ + SOCCER_FIELD.goalTube);
    expect(y0 + r).toBeLessThan(SOCCER_FIELD.goalY - SOCCER_FIELD.goalR);
  });
});
