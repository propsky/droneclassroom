import { describe, expect, it } from 'vitest';
import { DeductConfirm } from './deductConfirm';

describe('扣分要按兩次', () => {
  it('第一次只進入待確認，時限內再按才送出', () => {
    let t = 0;
    const confirm = new DeductConfirm(3000, () => t);
    expect(confirm.press('id:a')).toBe(false);
    expect(confirm.isArmed('id:a')).toBe(true);
    expect(confirm.label('id:a', '扣 1 分')).toContain('確定');
    t = 2000;
    expect(confirm.press('id:a')).toBe(true);
    expect(confirm.isArmed('id:a')).toBe(false);
  });

  it('超過時限要重新確認，不會誤送', () => {
    let t = 0;
    const confirm = new DeductConfirm(3000, () => t);
    confirm.press('team:blue');
    t = 3500;
    expect(confirm.label('team:blue', '全隊扣 1 分')).toBe('全隊扣 1 分');
    expect(confirm.press('team:blue')).toBe(false);
  });

  it('不同按鈕互不影響', () => {
    const confirm = new DeductConfirm(3000, () => 0);
    confirm.press('id:a');
    expect(confirm.press('id:b')).toBe(false);
    expect(confirm.press('id:a')).toBe(true);
  });
});
