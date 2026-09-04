import { describe, expect, it } from 'vitest';
import {
  LEVEL_GOAL_PRESETS,
  applyLevelGoalPreset,
  getLevelGoalPreset,
  isLevelLayoutEmpty,
} from './levelGoalPresets';
import type { LevelDef } from './levels';

const blank: LevelDef = {
  id: 'cl-1',
  name: '測試',
  rings: [],
  obstacles: [],
  passZones: [],
};

describe('levelGoalPresets', () => {
  it('所有目標 id 唯一且素材存在', () => {
    const ids = LEVEL_GOAL_PRESETS.map((p) => p.id);
    expect(ids.length).toBe(new Set(ids).size);
    for (const preset of LEVEL_GOAL_PRESETS) {
      for (const sid of preset.snippetIds) {
        expect(getLevelGoalPreset(preset.id)?.snippetIds).toContain(sid);
      }
      const out = applyLevelGoalPreset(blank, preset.id);
      expect(out).not.toBeNull();
      expect(isLevelLayoutEmpty(out!)).toBe(false);
    }
  });

  it('初學穿圈套用三個圈', () => {
    const out = applyLevelGoalPreset(blank, 'goal-rings-basic');
    expect(out?.rings).toHaveLength(3);
    expect(out?.returnHome).toBe(true);
  });

  it('isLevelLayoutEmpty 判斷空白關卡', () => {
    expect(isLevelLayoutEmpty(blank)).toBe(true);
    expect(isLevelLayoutEmpty({ ...blank, rings: [{ x: 0, y: 2, z: -3 }] })).toBe(false);
  });
});
