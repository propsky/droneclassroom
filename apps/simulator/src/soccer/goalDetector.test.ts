import { describe, expect, it } from 'vitest';
import { SOCCER_FIELD } from './constants';
import { GoalDetector, type GoalFrame, type GoalPoint } from './goalDetector';

const y = SOCCER_FIELD.goalY;

/** 藍隊攻 +z 門。前後都離框夠遠，後緣一定跨得過出口面。 */
const goal: GoalFrame = {
  goalZ: SOCCER_FIELD.goalZ,
  goalY: y,
  goalR: SOCCER_FIELD.goalR,
  shieldR: SOCCER_FIELD.shieldR,
  halfThick: SOCCER_FIELD.goalTube,
  attackSign: 1,
};

const before = goal.goalZ - goal.shieldR - goal.halfThick - 0.4;
const after = goal.goalZ + goal.shieldR + goal.halfThick + 0.4;

function at(x: number, yOff: number, z: number): GoalPoint {
  return { x, y: y + yOff, z };
}

function straight(x: number, yOff: number, z0 = before, z1 = after): boolean {
  return GoalDetector.crossed(at(x, yOff, z0), at(x, yOff, z1), goal);
}

describe('GoalDetector 穿門', () => {
  it('正中穿過算進球', () => {
    expect(straight(0, 0)).toBe(true);
  });

  it('開口內緣四邊（上下左右）貼著飛過都算', () => {
    const rim = goal.goalR - 0.02;
    expect(rim).toBeGreaterThan(goal.goalR - goal.shieldR);
    expect(straight(rim, 0)).toBe(true);
    expect(straight(-rim, 0)).toBe(true);
    expect(straight(0, rim)).toBe(true);
    expect(straight(0, -rim)).toBe(true);
  });

  it('開口內四個對角貼著飛過都算', () => {
    const rim = goal.goalR - 0.02;
    const c = rim / Math.SQRT2;
    expect(Math.hypot(c, c)).toBeCloseTo(rim, 6);
    expect(straight(c, c)).toBe(true);
    expect(straight(c, -c)).toBe(true);
    expect(straight(-c, c)).toBe(true);
    expect(straight(-c, -c)).toBe(true);
  });

  it('只有一部分球體伸進開口也算', () => {
    const sliver = goal.goalR + goal.shieldR - 0.02;
    expect(sliver).toBeGreaterThan(goal.goalR);
    expect(straight(sliver, 0)).toBe(true);
  });

  it('從框外面掠過不算', () => {
    const out = goal.goalR + goal.halfThick * 2 + goal.shieldR + 0.1;
    expect(straight(out, 0)).toBe(false);
    expect(straight(-out, 0)).toBe(false);
    expect(straight(0, out)).toBe(false);
    expect(straight(0, -out)).toBe(false);
    expect(straight(out, out)).toBe(false);
  });

  it('打到框柱或框緣、球體沒進開口，不算', () => {
    const post = goal.goalR + goal.shieldR + 0.05;
    expect(post).toBeLessThan(goal.goalR + goal.halfThick * 2 + goal.shieldR);
    expect(straight(post, 0)).toBe(false);
    expect(straight(-post, 0)).toBe(false);
    expect(straight(0, post)).toBe(false);
    expect(straight(0, -post)).toBe(false);
  });

  it('撞上門面就停，後緣沒離開環厚，不算', () => {
    expect(GoalDetector.crossed(at(0, 0, before), at(0, 0, goal.goalZ), goal)).toBe(false);
    const partial = goal.goalZ + goal.shieldR + goal.halfThick * 0.4;
    expect(GoalDetector.crossed(at(0, 0, before), at(0, 0, partial), goal)).toBe(false);
  });

  it('反向穿回不算（含貼近內緣）', () => {
    expect(straight(0, 0, after, before)).toBe(false);
    const rim = goal.goalR - 0.02;
    expect(straight(rim, 0, after, before)).toBe(false);
    expect(straight(0, rim, after, before)).toBe(false);
  });

  it('高速一幀從門前跳到門後，正中與內緣都算，框外不算', () => {
    const far0 = goal.goalZ - 4;
    const far1 = goal.goalZ + 4;
    expect(straight(0, 0, far0, far1)).toBe(true);
    const rim = goal.goalR - 0.02;
    expect(straight(rim, 0, far0, far1)).toBe(true);
    expect(straight(-rim, 0, far0, far1)).toBe(true);
    expect(straight(0, rim, far0, far1)).toBe(true);
    expect(straight(0, -rim, far0, far1)).toBe(true);
    const c = rim / Math.SQRT2;
    expect(straight(c, c, far0, far1)).toBe(true);
    const out = goal.goalR + goal.halfThick * 2 + goal.shieldR + 0.1;
    expect(straight(out, 0, far0, far1)).toBe(false);
    expect(straight(0, out, far0, far1)).toBe(false);
  });

  it('斜向高速：後緣離開當下球心已在開口外，掃掠中段仍穿過', () => {
    const gz = goal.goalZ;
    const prev = at(-0.25 / 0.15, 0, gz - 0.5);
    const curr = at(prev.x + 1 / 0.15, 0, gz + 1.5);
    expect(GoalDetector.crossed(prev, curr, goal)).toBe(true);

    const exitZ = gz + goal.halfThick;
    const prevTrail = prev.z - goal.shieldR;
    const currTrail = curr.z - goal.shieldR;
    const t = (exitZ - prevTrail) / (currTrail - prevTrail);
    const sampleX = prev.x + (curr.x - prev.x) * t;
    expect(Math.abs(sampleX)).toBeGreaterThan(goal.goalR + goal.shieldR);
  });

  it('球心已離開環厚、只有帽緣掃到開口，仍然算', () => {
    const exit = goal.goalZ + goal.halfThick;
    const prev = at(0.55, 0, exit + 0.01);
    const curr = at(0, 0, exit + goal.shieldR + 0.05);
    expect(GoalDetector.trailingEdgeClearsExit(prev, curr, goal)).toBe(true);
    expect(GoalDetector.crossed(prev, curr, goal)).toBe(true);
    const miss = at(0.9, 0, exit + 0.01);
    const missEnd = at(0.9, 0, exit + goal.shieldR + 0.05);
    expect(GoalDetector.crossed(miss, missEnd, goal)).toBe(false);
  });

  it('紅隊方向（往 −z）正中算、反向不算', () => {
    const far: GoalFrame = { ...goal, goalZ: -SOCCER_FIELD.goalZ, attackSign: -1 };
    const approach = far.goalZ + 0.8;
    const through = far.goalZ - far.halfThick - far.shieldR - 0.3;
    expect(
      GoalDetector.crossed(at(0, 0, approach), at(0, 0, through), far),
    ).toBe(true);
    expect(
      GoalDetector.crossed(at(0, 0, through), at(0, 0, approach), far),
    ).toBe(false);
    const rim = far.goalR - 0.02;
    expect(
      GoalDetector.crossed(at(rim, 0, approach), at(rim, 0, through), far),
    ).toBe(true);
  });
});
