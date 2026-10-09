import { describe, expect, it } from 'vitest';
import { SOCCER_FIELD } from './constants';
import { advanceRingPassage, createRingPassage, shieldPassesRing, type RingCross } from './crossing';

const far: RingCross = {
  goalZ: -SOCCER_FIELD.goalZ,
  goalY: SOCCER_FIELD.goalY,
  goalR: SOCCER_FIELD.goalR,
  shieldR: SOCCER_FIELD.shieldR,
  halfThick: SOCCER_FIELD.goalTube,
  attackSign: -1,
};

function step(points: Array<{ x: number; y: number; z: number }>, ring: RingCross = far): boolean {
  let state = createRingPassage();
  let passed = false;
  for (let i = 1; i < points.length; i++) {
    const next = advanceRingPassage(state, points[i - 1]!, points[i]!, ring);
    state = next.state;
    if (next.passed) passed = true;
  }
  return passed;
}

describe('練習穿環漏判', () => {
  const y = SOCCER_FIELD.goalY;
  const exit = far.goalZ - far.halfThick;

  it('整顆沿進攻方向離開環厚才算，擦框、只到門面、反向、飛在環上方都不算', () => {
    const approach = far.goalZ + 0.8;
    const through = exit - far.shieldR - 0.15;
    const centered: Array<{ x: number; y: number; z: number }> = [];
    for (let z = approach; z >= through; z -= 0.04) centered.push({ x: 0, y, z });
    expect(step(centered)).toBe(true);

    const graze = far.goalR - far.shieldR + 0.05;
    const grazing: Array<{ x: number; y: number; z: number }> = [];
    for (let z = approach; z >= through; z -= 0.04) grazing.push({ x: graze, y, z });
    expect(step(grazing)).toBe(false);

    const partial: Array<{ x: number; y: number; z: number }> = [];
    for (let z = approach; z >= far.goalZ; z -= 0.04) partial.push({ x: 0, y, z });
    expect(step(partial)).toBe(false);

    const back: Array<{ x: number; y: number; z: number }> = [];
    for (let z = through; z <= approach; z += 0.04) back.push({ x: 0, y, z });
    expect(step(back)).toBe(false);

    const high: Array<{ x: number; y: number; z: number }> = [];
    for (let z = approach; z >= through; z -= 0.04) high.push({ x: 0, y: y + 1.2, z });
    expect(step(high)).toBe(false);
  });

  it('環厚裡淨空、離開後才側移，單段後緣檢查會漏，跨 tick 要算', () => {
    const points: Array<{ x: number; y: number; z: number }> = [];
    const start = far.goalZ + 0.6;
    const end = exit - far.shieldR - 0.2;
    for (let z = start; z >= end; z -= 0.04) {
      const past = Math.max(0, exit - z);
      const x = past <= 0 ? 0.04 : 0.04 + past * 0.8;
      points.push({ x, y: far.goalY, z });
    }
    expect(step(points)).toBe(true);

    const prev = points[points.length - 2]!;
    const curr = points[points.length - 1]!;
    expect(shieldPassesRing(prev, curr, far)).toBe(false);
  });

  it('離開環厚當下帽緣擦到框，不算穿', () => {
    const points: Array<{ x: number; y: number; z: number }> = [];
    const start = far.goalZ + 0.5;
    const end = exit - far.shieldR - 0.05;
    for (let z = start; z >= end; z -= 0.05) {
      const x = z < exit ? 0.25 : 0.02;
      points.push({ x, y: far.goalY, z });
    }
    expect(step(points)).toBe(false);
  });
});
