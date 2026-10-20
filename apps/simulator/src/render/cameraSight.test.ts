import { describe, expect, it } from 'vitest';
import { CameraSight } from './cameraSight';

describe('視線與門框', () => {
  const goal = {
    kind: 'torus' as const,
    name: '門',
    center: { x: 0, y: 3.3, z: 5.5 },
    axis: 'z' as const,
    major: 0.4,
    tube: 0.1,
  };

  it('從門心穿過去不算撞到門管', () => {
    const origin = { x: 0, y: 3.3, z: 8 };
    const target = { x: 0, y: 3.3, z: 0 };
    expect(CameraSight.blocker(origin, target, [goal])).toBeNull();
  });

  it('擦到門管算擋住', () => {
    const origin = { x: 0, y: 3.7, z: 8 };
    const target = { x: 0, y: 3.7, z: 0 };
    expect(CameraSight.blocker(origin, target, [goal])).toBe('門');
  });

  it('加粗後的氣球仍擋在 1-6 的跟隨射線上', () => {
    const balloon = {
      kind: 'sphere' as const,
      name: '氣球',
      center: { x: 0, y: 2.2, z: 7 },
      radius: 0.7 + 2.2,
    };
    expect(
      CameraSight.blocker({ x: 2.4, y: 4.4, z: 12 }, { x: 0, y: 0.4, z: 0 }, [balloon]),
    ).toBe('氣球');
  });

  it('方塊在鏡頭和目標之間算擋住，目標自己那顆不算', () => {
    const box = {
      kind: 'aabb' as const,
      name: '柱',
      min: { x: -0.5, y: 0, z: 2 },
      max: { x: 0.5, y: 2, z: 3 },
    };
    expect(CameraSight.blocker({ x: 0, y: 1, z: 6 }, { x: 0, y: 1, z: 0 }, [box])).toBe('柱');
    expect(
      CameraSight.blocker({ x: 0, y: 1, z: 6 }, { x: 0, y: 1, z: 2.5 }, [box]),
    ).toBeNull();
  });
});
