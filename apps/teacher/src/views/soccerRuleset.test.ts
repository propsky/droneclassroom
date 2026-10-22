import { describe, expect, it } from 'vitest';
import { SoccerRulesetForm } from './soccerRuleset';

describe('SoccerRulesetForm', () => {
  it('舊的 f9a 與空值都讀成臺北賽制，場地不能改', () => {
    expect(SoccerRulesetForm.parse(undefined)).toBe('taipei');
    expect(SoccerRulesetForm.parse('f9a')).toBe('taipei');
    expect(SoccerRulesetForm.parse('nope')).toBe('taipei');
    expect(SoccerRulesetForm.locksField('f9a')).toBe(true);
    expect(SoccerRulesetForm.fieldNote()).toContain('不能改成大場');
    expect(SoccerRulesetForm.fieldNote()).toContain('F9A-B');
  });

  it('說明只有臺北賽制', () => {
    expect(SoccerRulesetForm.hint()).toContain('先進第 1 球');
    expect(SoccerRulesetForm.hint()).toContain('扣 1 分');
    expect(SoccerRulesetForm.hint()).not.toContain('三局兩勝');
  });

  it('舊的 3 分鐘改成 2 分鐘', () => {
    expect(SoccerRulesetForm.durationOnChange('180')).toBe('120');
    expect(SoccerRulesetForm.durationOnChange('30')).toBe('30');
  });
});
