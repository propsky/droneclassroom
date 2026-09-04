import { describe, expect, it } from 'vitest';
import { isChapterDef } from './levels';

describe('isChapterDef', () => {
  it('接受合法章節 JSON', () => {
    expect(
      isChapterDef({
        chapter: 1,
        name: '新手村',
        levels: [{ id: '1-0', name: '搖桿熱身' }],
      }),
    ).toBe(true);
  });

  it('拒絕非物件', () => {
    expect(isChapterDef(null)).toBe(false);
    expect(isChapterDef('x')).toBe(false);
    expect(isChapterDef([])).toBe(false);
  });

  it('拒絕缺 chapter 或 levels', () => {
    expect(isChapterDef({ name: 'x', levels: [] })).toBe(false);
    expect(isChapterDef({ chapter: 1, name: 'x' })).toBe(false);
    expect(isChapterDef({ chapter: '1', levels: [] })).toBe(false);
    expect(isChapterDef({ chapter: 1, levels: 'nope' })).toBe(false);
  });
});
