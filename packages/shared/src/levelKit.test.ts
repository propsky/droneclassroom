import { describe, expect, it } from 'vitest';
import {
  LEVEL_KIT_SNIPPETS,
  applyLevelKitSnippet,
  getLevelKitSnippet,
  levelKitByCategory,
  validateAllLevelKitSnippets,
  validateLevelKitSnippet,
} from './levelKit';
import type { LevelDef, AltitudeZone } from './levels';

const blank: LevelDef = {
  id: 'cl-1',
  name: '測試',
  rings: [],
  obstacles: [],
  passZones: [],
};

describe('levelKit', () => {
  it('所有素材 id 唯一', () => {
    const ids = LEVEL_KIT_SNIPPETS.map((s) => s.id);
    expect(ids.length).toBe(new Set(ids).size);
  });

  it('所有素材通過驗證', () => {
    const failures = validateAllLevelKitSnippets();
    expect(failures).toEqual([]);
  });

  it('每個素材可合併到空白關卡', () => {
    for (const snip of LEVEL_KIT_SNIPPETS) {
      const out = applyLevelKitSnippet(blank, snip, 'replace-tasks');
      expect(out.id).toBe('cl-1');
      expect(validateLevelKitSnippet(snip)).toEqual([]);
    }
  });

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

  it('完整情境 forceIntro 覆寫 intro', () => {
    const withIntro: LevelDef = { ...blank, intro: '舊說明' };
    const snip = getLevelKitSnippet('scene-face-rings-full');
    expect(snip?.forceIntro).toBe(true);
    const out = applyLevelKitSnippet(withIntro, snip!, 'append');
    expect(out.intro).toContain('機頭對準');
    expect(out.rings).toHaveLength(3);
  });

  it('draw 3D 素材帶 orbit', () => {
    const snip = getLevelKitSnippet('draw-spiral-3d');
    const out = applyLevelKitSnippet(blank, snip!, 'replace-tasks');
    expect(out.draw).toBe(true);
    expect(out.view).toBe('orbit3d');
    expect(out.orbit?.radius).toBe(13);
  });

  it('分類涵蓋六類且總數充足', () => {
    expect(levelKitByCategory('rings').length).toBeGreaterThanOrEqual(10);
    expect(levelKitByCategory('obstacles').length).toBeGreaterThanOrEqual(8);
    expect(levelKitByCategory('tasks').length).toBeGreaterThanOrEqual(8);
    expect(levelKitByCategory('scenes').length).toBeGreaterThanOrEqual(6);
    expect(levelKitByCategory('draw').length).toBeGreaterThanOrEqual(6);
    expect(levelKitByCategory('races').length).toBeGreaterThanOrEqual(3);
    expect(LEVEL_KIT_SNIPPETS.length).toBeGreaterThanOrEqual(45);
  });
});
