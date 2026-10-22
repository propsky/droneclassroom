import { describe, expect, it } from 'vitest';
import { SoccerPenaltyLabel, SoccerResultCopy, TaipeiScore } from './taipeiSoccer';

describe('TaipeiScore', () => {
  it('淨分高者勝，同分看先進球，都沒進球才平手', () => {
    expect(TaipeiScore.winner(2, 1, 'red')).toBe('blue');
    expect(TaipeiScore.winner(1, 1, 'red')).toBe('red');
    expect(TaipeiScore.winner(0, 0, null)).toBe('draw');
    expect(TaipeiScore.net(3, 1)).toBe(2);
  });
});

describe('SoccerResultCopy', () => {
  it('臺北賽制結算寫出扣分與先進球', () => {
    const rows = SoccerResultCopy.rows({
      ruleset: 'taipei',
      winner: 'blue',
      goals: { blue: 1, red: 1 },
      deductions: { blue: 0, red: 1 },
      firstGoal: 'blue',
    });
    expect(rows.join('\n')).toContain('扣分　藍 0 : 1 紅');
    expect(rows.join('\n')).toContain('淨分　藍 1 : 0 紅');
    expect(rows.join('\n')).toContain('先進球　藍隊');
    expect(SoccerResultCopy.kicker({ ruleset: 'taipei', winner: 'blue', goals: { blue: 0, red: 0 } })).toBe(
      '臺北賽制',
    );
  });

  it('淨分相同才註明先進球決勝', () => {
    const rows = SoccerResultCopy.rows({
      ruleset: 'taipei',
      winner: 'red',
      goals: { blue: 2, red: 1 },
      deductions: { blue: 1, red: 0 },
      firstGoal: 'red',
    });
    expect(rows.some((line) => line.includes('同分'))).toBe(true);
  });

  it('F9A 結算不提扣分', () => {
    const rows = SoccerResultCopy.rows({
      ruleset: 'f9a',
      winner: 'blue',
      goals: { blue: 2, red: 0 },
      sets: { blue: 2, red: 0 },
    });
    expect(rows.join('\n')).not.toContain('扣分');
    expect(rows.join('\n')).toContain('局數');
    expect(SoccerPenaltyLabel.text('early_takeoff')).toBe('提前升空');
  });
});
