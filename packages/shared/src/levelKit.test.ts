import { describe, expect, it } from 'vitest';
import { applyLevelKitSnippet, getLevelKitSnippet, levelKitByCategory } from './levelKit';
import type { LevelDef, AltitudeZone } from './levels';

const blank: LevelDef = {
  id: 'cl-1',
  name: '測試',
  rings: [],
  obstacles: [],
  passZones: [],
};

describe('levelKit', () => {
  it('append 穿圈素材', () => {
    const snip = getLevelKitSnippet('rings-line-3');
    expect(snip).toBeDefined();
    const out = applyLevelKitSnippet(blank, snip!);
    expect(out.rings).toHaveLength(3);
    expect(out.returnHome).toBe(true);
  });

  it('replace-tasks 覆寫 passZones', () => {
    const oldZone: AltitudeZone = { x: 0, z: 0, label: '舊', type: 'altitude', minY: 1 };
    const withZones: LevelDef = { ...blank, passZones: [oldZone] };
    const snip = getLevelKitSnippet('task-altitude');
    const out = applyLevelKitSnippet(withZones, snip!, 'replace-tasks');
    expect(out.passZones).toHaveLength(4);
    expect(out.passZones?.[0]?.label).toBe('起飛 ≥ 0.5m');
  });

  it('分類篩選', () => {
    expect(levelKitByCategory('rings').length).toBeGreaterThanOrEqual(3);
    expect(levelKitByCategory('tasks').every((s) => s.category === 'tasks')).toBe(true);
  });
});
