import { describe, expect, it } from 'vitest';
import { SoccerRulesetForm } from './soccerRuleset';

describe('SoccerRulesetForm', () => {
  it('場地固定 F9A-B，不能改', () => {
    expect(SoccerRulesetForm.fieldNote()).toContain('不能改成大場');
    expect(SoccerRulesetForm.fieldNote()).toContain('F9A-B');
  });

  it('說明只有臺北賽制', () => {
    expect(SoccerRulesetForm.hint()).toContain('先進第 1 球');
    expect(SoccerRulesetForm.hint()).toContain('扣 1 分');
    expect(SoccerRulesetForm.hint()).not.toContain('三局兩勝');
  });
});
