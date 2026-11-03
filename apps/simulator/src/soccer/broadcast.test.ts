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
    deductions: { blue: 0, red: 1 },
    winner: null,
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

describe('足球七段計分板', () => {
  it('8 亮七段、1 只亮兩段', () => {
    expect(sevenSegOnCount('8')).toBe(7);
    expect(sevenSegOnCount('1')).toBe(2);
    expect(sevenSegOnCount('x')).toBe(0);
  });

  it('計分板含倒數、各隊扣分與進球', () => {
    const view = readBroadcast(input());
    expect(formatClock(view.remainSec)).toBe('01:35');
    expect(view.blueDeductions).toBe(0);
    expect(view.redDeductions).toBe(1);
    expect(view.blueGoals).toBe(1);
    expect(view.redGoals).toBe(0);
    expect(view.flag).toBe('可得分');
    expect(view.ended).toBe(false);
  });

  it('得分後還沒回半場改顯示請返場', () => {
    expect(readBroadcast(input({ needReturn: true })).flag).toBe('請返場');
    expect(readBroadcast(input({ myStriker: false, needReturn: true })).flag).toBe('');
  });

  it('結束畫面跟伺服器的勝方，寫出淨分、進球與扣分', () => {
    const view = readBroadcast(
      input({ status: 'done', endTime: 0, winner: 'blue', scores: { blue: 3, red: 2 }, deductions: { blue: 1, red: 0 } }),
    );
    expect(view.ended).toBe(true);
    expect(view.title).toBe('藍隊獲勝');
    expect(view.detail).toContain('淨分 2:2');
    expect(view.detail).toContain('進球 3:2');
    expect(view.detail).toContain('扣分 1:0');
    expect(view.detail).not.toContain('勝局');
  });

  it('淨分同分時照伺服器判的先進球勝方，不寫平手', () => {
    const view = readBroadcast(
      input({ status: 'done', endTime: 0, winner: 'red', scores: { blue: 1, red: 1 }, deductions: { blue: 0, red: 0 } }),
    );
    expect(view.title).toBe('紅隊獲勝');
  });

  it('平手寫兩隊平手；老師中途結束沒有勝方只寫比賽結束', () => {
    expect(readBroadcast(input({ status: 'done', endTime: 0, winner: 'draw' })).title).toBe('兩隊平手');
    expect(readBroadcast(input({ status: 'done', endTime: 0, winner: null })).title).toBe('比賽結束');
  });
});

describe('自由練習計分板', () => {
  it('只累計進球，不顯示返場或練習完成', () => {
    const view = readPracticeBroadcast({ goals: 4, elapsedSec: 12 });
    expect(view.blueGoals).toBe(4);
    expect(view.flag).toBe('');
    expect(view.ended).toBe(false);
    expect(view.title).toBe('');
    expect(view.detail).toBe('分數：4');
    expect(view.detail).not.toContain('完成');
  });
});
