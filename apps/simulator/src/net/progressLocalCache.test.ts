import { beforeEach, describe, expect, it, vi } from 'vitest';
import { replaceProgressMap } from '@creafly/shared';
import { clearProgressCache, loadProgressCache, saveProgressCache } from './progressLocalCache';

describe('progressLocalCache', () => {
  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
    });
    clearProgressCache();
  });

  it('依 sid 讀寫進度', () => {
    const progress = { '1-1': { bestTimeMs: 12000, attempts: 1 } };
    saveProgressCache(42, progress);
    expect(loadProgressCache(42)).toEqual(progress);
    expect(loadProgressCache(99)).toBeNull();
  });

  it('replaceProgressMap 避免外部 mutate', () => {
    const progress = { '1-2': { bestTimeMs: 8000, attempts: 2 } };
    saveProgressCache(1, progress);
    const loaded = loadProgressCache(1)!;
    loaded['1-2']!.attempts = 99;
    expect(loadProgressCache(1)).toEqual({ '1-2': { bestTimeMs: 8000, attempts: 2 } });
  });

  it('clear 後讀不到', () => {
    saveProgressCache(1, { '1-0': { bestTimeMs: 1000, attempts: 1 } });
    clearProgressCache();
    expect(loadProgressCache(1)).toBeNull();
  });
});

describe('replaceProgressMap', () => {
  it('淺拷貝', () => {
    const src = { a: { bestTimeMs: 1, attempts: 1 } };
    const out = replaceProgressMap(src);
    expect(out).toEqual(src);
    expect(out).not.toBe(src);
  });
});
