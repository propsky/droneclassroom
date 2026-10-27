import { describe, expect, it } from 'vitest';
import { advanceRingPassage, createRingPassage } from './crossing';
import data from './ringPassageCases.json';

// 與 apps/api/tests/test_ring_passage.py 跑同一份案例：前端與伺服器的穿環判定不得分歧
describe('穿環共用案例（前端）', () => {
  for (const c of data.cases) {
    it(c.name, () => {
      let state = createRingPassage();
      let passed = false;
      for (let i = 1; i < c.points.length; i += 1) {
        const [px, py, pz] = c.points[i - 1]!;
        const [cx, cy, cz] = c.points[i]!;
        const step = advanceRingPassage(
          state,
          { x: px!, y: py!, z: pz! },
          { x: cx!, y: cy!, z: cz! },
          { ...data.ring, goalZ: c.goalZ, attackSign: c.attackSign },
        );
        state = step.state;
        passed = passed || step.passed;
      }
      expect(passed).toBe(c.passed);
    });
  }
});
