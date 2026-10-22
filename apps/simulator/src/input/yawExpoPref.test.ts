import { describe, expect, it, afterEach } from 'vitest';
import { YawExpoPreference, type ExpoPrefStore } from './yawExpoPref';

function store(initial?: Record<string, string>): ExpoPrefStore & { bag: Map<string, string> } {
  const bag = new Map<string, string>(Object.entries(initial ?? {}));
  return {
    bag,
    getItem: (key) => (bag.has(key) ? bag.get(key)! : null),
    setItem: (key, value) => {
      bag.set(key, value);
    },
  };
}

describe('YawExpoPreference', () => {
  afterEach(() => {
    YawExpoPreference.apply(0);
  });

  it('預設 0（線性），壞掉的儲存也是 0', () => {
    expect(YawExpoPreference.read(null)).toBe(0);
    expect(YawExpoPreference.read(undefined)).toBe(0);
    expect(YawExpoPreference.read(store())).toBe(0);
    expect(YawExpoPreference.read(store({ [YawExpoPreference.STORAGE_KEY]: 'nope' }))).toBe(0);
    expect(YawExpoPreference.read(store({ [YawExpoPreference.STORAGE_KEY]: '' }))).toBe(0);
    expect(
      YawExpoPreference.read({
        getItem: () => {
          throw new Error('無痕');
        },
        setItem: () => undefined,
      }),
    ).toBe(0);
  });

  it('讀寫夾在 0–100 的整數', () => {
    const s = store();
    YawExpoPreference.write(s, 40);
    expect(s.bag.get(YawExpoPreference.STORAGE_KEY)).toBe('40');
    expect(YawExpoPreference.read(s)).toBe(40);
    expect(YawExpoPreference.read(store({ [YawExpoPreference.STORAGE_KEY]: '100' }))).toBe(100);
    expect(YawExpoPreference.read(store({ [YawExpoPreference.STORAGE_KEY]: '150' }))).toBe(100);
    expect(YawExpoPreference.read(store({ [YawExpoPreference.STORAGE_KEY]: '-3' }))).toBe(0);
    expect(YawExpoPreference.read(store({ [YawExpoPreference.STORAGE_KEY]: '0.6' }))).toBe(1);
    expect(YawExpoPreference.read(store({ [YawExpoPreference.STORAGE_KEY]: '0.2' }))).toBe(0);
    expect(YawExpoPreference.clamp(Number.NaN)).toBe(0);
    expect(YawExpoPreference.clamp(100.6)).toBe(100);
  });

  it('hydrate 之後 get 才看得到，persist 寫回同一個鍵', () => {
    const s = store({ [YawExpoPreference.STORAGE_KEY]: '25' });
    expect(YawExpoPreference.get()).toBe(0);
    YawExpoPreference.hydrate(s);
    expect(YawExpoPreference.get()).toBe(25);
    YawExpoPreference.apply(0);
    YawExpoPreference.persist(s);
    expect(s.bag.get(YawExpoPreference.STORAGE_KEY)).toBe('0');
    expect(YawExpoPreference.label(0)).toBe('線性');
    expect(YawExpoPreference.label(25)).toBe('25');
  });

  it('寫入失敗時不丟例外', () => {
    expect(() =>
      YawExpoPreference.write(
        {
          getItem: () => null,
          setItem: () => {
            throw new Error('quota');
          },
        },
        10,
      ),
    ).not.toThrow();
    expect(() => YawExpoPreference.write(null, 10)).not.toThrow();
  });
});
