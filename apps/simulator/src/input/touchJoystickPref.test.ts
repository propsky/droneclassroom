import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TouchJoystickPreference, type PrefStore } from './touchJoystickPref';

function store(initial?: Record<string, string>): PrefStore & { bag: Map<string, string> } {
  const bag = new Map<string, string>(Object.entries(initial ?? {}));
  return {
    bag,
    getItem: (key) => (bag.has(key) ? bag.get(key)! : null),
    setItem: (key, value) => {
      bag.set(key, value);
    },
  };
}

function env(coarse: boolean) {
  return {
    matchMedia: (query: string) => ({ matches: query === '(pointer: coarse)' && coarse }),
  };
}

describe('TouchJoystickPreference', () => {
  it('主要指標是手指才預設打開；fine、matchMedia 壞掉都不開', () => {
    expect(TouchJoystickPreference.primaryPointerIsCoarse(env(true))).toBe(true);
    expect(TouchJoystickPreference.primaryPointerIsCoarse(env(false))).toBe(false);
    expect(TouchJoystickPreference.primaryPointerIsCoarse(null)).toBe(false);
    expect(
      TouchJoystickPreference.primaryPointerIsCoarse({
        matchMedia: () => {
          throw new Error('不支援');
        },
      }),
    ).toBe(false);
  });

  it('沒存過走裝置預設：coarse 顯示、滑鼠桌機隱藏', () => {
    expect(TouchJoystickPreference.resolve(null, true)).toBe(true);
    expect(TouchJoystickPreference.resolve(null, false)).toBe(false);
  });

  it('?joystick=1 在沒有手動選擇時強制顯示', () => {
    expect(TouchJoystickPreference.resolve(null, false, true)).toBe(true);
    expect(TouchJoystickPreference.resolve(null, true, false)).toBe(true);
  });

  it('使用者明確選擇蓋過預設，也蓋過網址', () => {
    expect(TouchJoystickPreference.resolve(true, false, false)).toBe(true);
    expect(TouchJoystickPreference.resolve(false, true, true)).toBe(false);
  });

  it('localStorage 只認 1 / 0，其他當成沒選過', () => {
    const memory = store();
    expect(TouchJoystickPreference.readOverride(memory)).toBeNull();
    TouchJoystickPreference.writeOverride(memory, true);
    expect(memory.bag.get(TouchJoystickPreference.STORAGE_KEY)).toBe('1');
    expect(TouchJoystickPreference.readOverride(memory)).toBe(true);
    TouchJoystickPreference.writeOverride(memory, false);
    expect(TouchJoystickPreference.readOverride(memory)).toBe(false);
    memory.bag.set(TouchJoystickPreference.STORAGE_KEY, 'yes');
    expect(TouchJoystickPreference.readOverride(memory)).toBeNull();
    expect(TouchJoystickPreference.readOverride(null)).toBeNull();
  });

  it('讀寫失敗當成沒選過，不丟出例外', () => {
    const broken: PrefStore = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(TouchJoystickPreference.readOverride(broken)).toBeNull();
    expect(() => TouchJoystickPreference.writeOverride(broken, true)).not.toThrow();
  });

  it('樣式只在 touch-joysticks 時顯示搖桿層，不再跟著 touch-device', () => {
    const css = readFileSync(new URL('../ui/style.css', import.meta.url), 'utf8');
    expect(css).toMatch(/body\.touch-joysticks:not\(\.gamepad-connected\):not\(\.ble-connected\) #joystick-layer/);
    expect(css).not.toMatch(/touch-device[^{]*#joystick-layer/);
    expect(css).not.toMatch(/joystick-forced[^{]*#joystick-layer/);
  });
});
