import { describe, expect, it } from 'vitest';
import { ImpactText } from './impactLabel';

describe('撞擊速度提示文字', () => {
  it('落地：平穩／有點重／可能摔壞', () => {
    expect(ImpactText.of(1.2, 'floor')).toEqual({ text: '落地 1.2 m/s・平穩', tone: 'ok' });
    expect(ImpactText.of(2.04, 'floor')).toEqual({ text: '落地 2.0 m/s・有點重', tone: 'warn' });
    expect(ImpactText.of(4.8, 'floor').tone).toBe('bad');
  });

  it('撞牆：輕碰只報速度', () => {
    expect(ImpactText.of(0.8, 'wall')).toEqual({ text: '撞擊 0.8 m/s', tone: 'info' });
    expect(ImpactText.of(3, 'wall')).toEqual({ text: '撞擊 3.0 m/s・真機可能摔壞', tone: 'bad' });
  });
});
