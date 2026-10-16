import { describe, expect, it } from 'vitest';
import { isRealDroneSwitchVisible, resolveInitialExecutionMode } from './realModeAccess';

describe('真機切換是否顯示', () => {
  it('現在一律顯示，不看網址', () => {
    expect(isRealDroneSwitchVisible()).toBe(true);
  });

  it('沒開切換時，上次選真機也維持模擬器', () => {
    expect(resolveInitialExecutionMode('real', false)).toBe('sim');
    expect(resolveInitialExecutionMode('sim', false)).toBe('sim');
  });

  it('有開切換時，沿用上次選擇；沒存過是模擬器', () => {
    expect(resolveInitialExecutionMode('real', true)).toBe('real');
    expect(resolveInitialExecutionMode('sim', true)).toBe('sim');
    expect(resolveInitialExecutionMode('sim')).toBe('sim');
  });
});
