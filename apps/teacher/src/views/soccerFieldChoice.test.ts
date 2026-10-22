import { describe, expect, it } from 'vitest';
import { SoccerFieldChoice } from './soccerFieldChoice';

describe('SoccerFieldChoice', () => {
  it('空字串開房不覆寫伺服器預設', () => {
    expect(SoccerFieldChoice.forCreate('')).toEqual({});
    expect(SoccerFieldChoice.forCreate('F9A-B')).toEqual({ soccerClass: 'F9A-B' });
    expect(SoccerFieldChoice.forCreate('nope')).toEqual({});
  });

  it('沒釘選時選同一組也會釘上；已釘選且相同則不送', () => {
    expect(SoccerFieldChoice.forUpdate('F9A-A', { soccerClass: 'F9A-A', soccerClassPinned: false })).toEqual({
      soccerClass: 'F9A-A',
    });
    expect(SoccerFieldChoice.forUpdate('F9A-A', { soccerClass: 'F9A-A', soccerClassPinned: true })).toEqual({});
    expect(SoccerFieldChoice.forUpdate('F9A-B', { soccerClass: 'F9A-A', soccerClassPinned: true })).toEqual({
      soccerClass: 'F9A-B',
    });
  });

  it('空字串在已釘選時改回跟伺服器', () => {
    expect(SoccerFieldChoice.forUpdate('', { soccerClass: 'F9A-B', soccerClassPinned: true })).toEqual({
      soccerClass: 'server',
    });
    expect(SoccerFieldChoice.forUpdate('', { soccerClass: 'F9A-A' })).toEqual({});
  });

  it('舊房間沒帶代碼時顯示 F9A-A', () => {
    expect(SoccerFieldChoice.effective(undefined)).toBe('F9A-A');
    expect(SoccerFieldChoice.selectValue(false, 'F9A-B')).toBe('');
    expect(SoccerFieldChoice.selectValue(true, 'F9A-B')).toBe('F9A-B');
    expect(SoccerFieldChoice.label('F9A-B')).toContain('6×3×3');
  });
});
