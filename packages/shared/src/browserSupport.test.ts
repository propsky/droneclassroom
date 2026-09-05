import { describe, expect, it } from 'vitest';
import { meetsMinimumPlayRequirements, probeBrowserCapabilities } from './browserSupport';

function mockWindow(overrides: {
  navigator?: Partial<Navigator>;
  createCanvas?: () => HTMLCanvasElement;
}): Window {
  const nav = {
    userAgent: '',
    platform: 'Win32',
    maxTouchPoints: 0,
    ...overrides.navigator,
  } as Navigator;
  const doc = {
    createElement: (tag: string) => {
      if (tag !== 'canvas') return {} as HTMLCanvasElement;
      if (overrides.createCanvas) return overrides.createCanvas();
      return {
        getContext: (type: string) => (type === 'webgl' || type === 'experimental-webgl' ? {} : null),
      } as unknown as HTMLCanvasElement;
    },
  };
  const storage: Record<string, string> = {};
  const win = {
    document: doc,
    navigator: nav,
    localStorage: {
      setItem: (k: string, v: string) => {
        storage[k] = v;
      },
      removeItem: (k: string) => {
        delete storage[k];
      },
    },
    crypto: {
      randomUUID: () => '00000000-0000-4000-8000-000000000000',
      getRandomValues: (a: Uint8Array) => a,
    },
  };
  return win as unknown as Window;
}

describe('probeBrowserCapabilities', () => {
  it('桌面 Chrome 類環境', () => {
    const caps = probeBrowserCapabilities(mockWindow({}));
    expect(caps.webgl).toBe(true);
    expect(caps.localStorage).toBe(true);
    expect(caps.secureRandom).toBe(true);
    expect(caps.touch).toBe(false);
    expect(caps.ios).toBe(false);
    expect(meetsMinimumPlayRequirements(caps)).toBe(true);
  });

  it('iPad Safari 類環境', () => {
    const caps = probeBrowserCapabilities(
      mockWindow({
        navigator: {
          userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)',
          platform: 'iPad',
          maxTouchPoints: 5,
        },
      }),
    );
    expect(caps.touch).toBe(true);
    expect(caps.ios).toBe(true);
    expect(meetsMinimumPlayRequirements(caps)).toBe(true);
  });

  it('無 WebGL 時不滿最低需求', () => {
    const caps = probeBrowserCapabilities(
      mockWindow({
        createCanvas: () =>
          ({
            getContext: () => null,
          }) as unknown as HTMLCanvasElement,
      }),
    );
    expect(caps.webgl).toBe(false);
    expect(meetsMinimumPlayRequirements(caps)).toBe(false);
  });
});
