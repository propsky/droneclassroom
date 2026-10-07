import { describe, expect, it } from 'vitest';
import {
  coalesceNav,
  digitalFromDpad,
  digitalFromStick,
  mergeNav,
  moveGridIndex,
  shouldRepeatNav,
  wrapIndex,
} from './padUiIntent';

describe('padUiIntent', () => {
  it('類比軸四向鎖定，斜推取較大軸', () => {
    expect(digitalFromStick(0.1, 0.1)).toEqual({ x: 0, y: 0 });
    expect(digitalFromStick(0.8, 0.2)).toEqual({ x: 1, y: 0 });
    expect(digitalFromStick(-0.2, 0.9)).toEqual({ x: 0, y: 1 });
  });

  it('D-pad 優先於類比', () => {
    const stick = digitalFromStick(0.9, 0);
    const dpad = digitalFromDpad({ up: true, down: false, left: false, right: false });
    expect(mergeNav(stick, dpad)).toEqual({ x: 0, y: 1 });
  });

  it('按住連發：首 tick 觸發、之後延遲再發', () => {
    const idle = { x: 0 as const, y: 0 as const };
    const down = { x: 0 as const, y: -1 as const };
    const first = shouldRepeatNav(idle, down, 0, 18, 6);
    expect(first.fire).toBe(true);
    const hold = shouldRepeatNav(down, down, 1, 18, 6);
    expect(hold.fire).toBe(false);
    const delayed = shouldRepeatNav(down, down, 17, 18, 6);
    expect(delayed.fire).toBe(true);
  });

  it('wrapIndex 環狀', () => {
    expect(wrapIndex(0, -1, 3)).toBe(2);
    expect(wrapIndex(2, 1, 3)).toBe(0);
  });

  it('網格移動不超出最後一列殘缺格', () => {
    // 12 格、6 欄（登入動物列）
    expect(moveGridIndex(0, 1, 0, 12, 6)).toBe(1);
    expect(moveGridIndex(5, 1, 0, 12, 6)).toBe(0);
    expect(moveGridIndex(0, 0, 1, 12, 6)).toBe(0);
    expect(moveGridIndex(0, 0, -1, 12, 6)).toBe(6);
    expect(moveGridIndex(6, 0, 1, 12, 6)).toBe(0);
    expect(moveGridIndex(0, 0, 1, 5, 1)).toBe(4);
    expect(moveGridIndex(0, 1, 0, 5, 1)).toBe(1);
  });

  it('coalesceNav 由前到後取第一個有效方向', () => {
    expect(coalesceNav({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 })).toEqual({ x: 1, y: 0 });
    expect(coalesceNav({ x: 0, y: 0 }, { x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
  });
});
