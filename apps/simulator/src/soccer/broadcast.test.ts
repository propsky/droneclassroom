import { describe, expect, it } from 'vitest';
import {
  GUARD_BRIGHT_BLUE,
  GUARD_BRIGHT_RED,
  formatClock,
  readBroadcast,
  readPracticeBroadcast,
  sevenSegOnCount,
  soccerGuardColor,
  type BroadcastInput,
} from './broadcast';

function input(over: Partial<BroadcastInput> = {}): BroadcastInput {
  return {
    status: 'running',
    mode: 'striker',
    scores: { blue: 1, red: 0 },
    sets: { blue: 1, red: 0 },
    period: 2,
    endTime: 95_000,
    now: 0,
    myTeam: 'blue',
    myStriker: true,
    needReturn: false,
    ...over,
  };
}

describe('F9A 階段三護罩顏色', () => {
  it('攻擊手護罩用對方隊色', () => {
    expect(soccerGuardColor('red', true)).toBe(GUARD_BRIGHT_BLUE);
    expect(soccerGuardColor('blue', true)).toBe(GUARD_BRIGHT_RED);
  });

  it('非攻擊手用自己的隊色，練習預設當藍隊攻擊手', () => {
    expect(soccerGuardColor('blue', false)).toBe(0x3b82f6);
    expect(soccerGuardColor('red', false)).toBe(0xff4444);
    expect(soccerGuardColor(null, true)).toBe(GUARD_BRIGHT_RED);
  });
});

describe('F9A 階段三七段計分', () => {
  it('8 亮七段、1 只亮兩段', () => {
    expect(sevenSegOnCount('8')).toBe(7);
    expect(sevenSegOnCount('1')).toBe(2);
    expect(sevenSegOnCount('x')).toBe(0);
  });

  it('計分板含局數、該局倒數、各隊勝局與本局比分', () => {
    const view = readBroadcast(input());
    expect(view.period).toBe(2);
    expect(formatClock(view.remainSec)).toBe('01:35');
    expect(view.blueSets).toBe(1);
    expect(view.redSets).toBe(0);
    expect(view.blueGoals).toBe(1);
    expect(view.redGoals).toBe(0);
    expect(view.flag).toBe('可得分');
    expect(view.ended).toBe(false);
  });

  it('得分後還沒回半場改顯示請返場', () => {
    expect(readBroadcast(input({ needReturn: true })).flag).toBe('請返場');
    expect(readBroadcast(input({ myStriker: false, needReturn: true })).flag).toBe('');
  });

  it('結束畫面寫出勝隊與勝局', () => {
    const view = readBroadcast(
      input({ status: 'done', endTime: 0, sets: { blue: 2, red: 1 }, scores: { blue: 3, red: 2 } }),
    );
    expect(view.ended).toBe(true);
    expect(view.title).toBe('藍隊獲勝');
    expect(view.detail).toContain('勝局 2:1');
    expect(view.detail).toContain('本局 3:2');
  });
});

describe('F9A 階段三練習旗號', () => {
  it('來回練習還沒過中線時請返場', () => {
    expect(
      readPracticeBroadcast({
        running: true,
        goals: 1,
        elapsedSec: 12,
        needReturn: true,
        scoredDrill: true,
      }).flag,
    ).toBe('請返場');
  });
});
