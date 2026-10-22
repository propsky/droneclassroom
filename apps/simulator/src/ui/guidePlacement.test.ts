import { describe, expect, it } from 'vitest';
import { GuidePlacement } from './guidePlacement';

describe('GuidePlacement', () => {
  const view = { width: 1280, height: 800 };
  const card = { width: 340, height: 180 };
  const start = { left: 700, top: 460, width: 88, height: 40 };

  it('置中卡片預設在上緣，不壓開始鈕', () => {
    const pos = GuidePlacement.centered(view, card, start);
    const rect = { ...pos, width: card.width, height: card.height };
    expect(GuidePlacement.overlaps(rect, start)).toBe(false);
    expect(pos.top).toBeLessThan(start.top);
  });

  it('高亮卡片若壓到開始鈕會讓開', () => {
    const covering = { left: 680, top: 440, width: 340, height: 180 };
    expect(GuidePlacement.overlaps(covering, start)).toBe(true);
    const pos = GuidePlacement.avoid(view, covering, start);
    expect(GuidePlacement.overlaps({ ...pos, width: covering.width, height: covering.height }, start)).toBe(false);
  });
});
