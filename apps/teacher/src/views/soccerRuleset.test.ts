import { describe, expect, it } from 'vitest';
import { SoccerRulesetForm } from './soccerRuleset';

describe('SoccerRulesetForm', () => {
  it('沒寫就是臺北賽制，進階 F9A 要明確指定', () => {
    expect(SoccerRulesetForm.parse(undefined)).toBe('taipei');
    expect(SoccerRulesetForm.parse('f9a')).toBe('f9a');
    expect(SoccerRulesetForm.locksField('taipei')).toBe(true);
    expect(SoccerRulesetForm.locksField('f9a')).toBe(false);
    expect(SoccerRulesetForm.fieldNote('taipei')).toContain('不能改成大場');
  });

  it('臺北賽制說明含先進球與扣分，F9A 說明不含', () => {
    expect(SoccerRulesetForm.hint('taipei')).toContain('先進第 1 球');
    expect(SoccerRulesetForm.hint('taipei')).toContain('扣 1 分');
    expect(SoccerRulesetForm.hint('f9a')).toContain('三局兩勝');
    expect(SoccerRulesetForm.hint('f9a')).not.toContain('扣 1 分');
  });

  it('從 3 分鐘切到臺北賽制時改成 2 分鐘', () => {
    expect(SoccerRulesetForm.durationOnChange('180', 'taipei')).toBe('120');
    expect(SoccerRulesetForm.durationOnChange('30', 'taipei')).toBe('30');
    expect(SoccerRulesetForm.durationOnChange('120', 'f9a')).toBe('120');
  });
});
