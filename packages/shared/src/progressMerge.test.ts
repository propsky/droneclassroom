import { describe, expect, it } from 'vitest';
import { mergeLevelProgress, replaceProgressMap } from './progressMerge';

describe('mergeLevelProgress', () => {
  it('首次完成寫入 best 與 attempts=1', () => {
    expect(mergeLevelProgress(undefined, 30000)).toEqual({ bestTimeMs: 30000, attempts: 1 });
  });

  it('更快成績更新 best、attempts 累加', () => {
    const cur = { bestTimeMs: 30000, attempts: 1 };
    expect(mergeLevelProgress(cur, 20000)).toEqual({ bestTimeMs: 20000, attempts: 2 });
  });

  it('較慢成績保留 best', () => {
    const cur = { bestTimeMs: 20000, attempts: 2 };
    expect(mergeLevelProgress(cur, 35000)).toEqual({ bestTimeMs: 20000, attempts: 3 });
  });
});

describe('replaceProgressMap', () => {
  it('複製一份新物件（伺服器覆蓋用）', () => {
    const src = { '1-1': { bestTimeMs: 1000, attempts: 1 } };
    const out = replaceProgressMap(src);
    expect(out).toEqual(src);
    expect(out).not.toBe(src);
  });
});
