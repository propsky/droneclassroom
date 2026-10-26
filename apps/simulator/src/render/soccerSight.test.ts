import { describe, expect, it } from 'vitest';
import { SOCCER_SIGHT_VEIL, soccerSightVeiled } from './soccerSight';

describe('足球視線半透明', () => {
  it('全場與考證只淡化鏡頭這一端', () => {
    expect(soccerSightVeiled('team', 1, 1)).toBe(true);
    expect(soccerSightVeiled('exam', -1, -1)).toBe(true);
    expect(soccerSightVeiled('team', -1, 1)).toBe(false);
    expect(soccerSightVeiled('exam', 1, -1)).toBe(false);
    expect(SOCCER_SIGHT_VEIL).toBeGreaterThan(0);
    expect(SOCCER_SIGHT_VEIL).toBeLessThan(1);
  });

  it('跟隨與第一人稱維持不透明', () => {
    expect(soccerSightVeiled('follow', 1, 1)).toBe(false);
    expect(soccerSightVeiled('fpv', -1, -1)).toBe(false);
  });
});
