import { describe, expect, it } from 'vitest';
import {
  applyDeadzone,
  computeCalibRanges,
  detectButtonEdge,
  normalizeGamepadAxis,
  resolveStickSource,
  urlPresetOverrides,
} from './padMath';

describe('normalizeGamepadAxis', () => {
  it('死區為 0 時置中直通，並夾在 ±1', () => {
    expect(normalizeGamepadAxis(0.5, 0, 1, 0)).toBe(0.5);
    expect(normalizeGamepadAxis(-0.8, 0, 1, 0)).toBe(-0.8);
    expect(normalizeGamepadAxis(1.5, 0, 1, 0)).toBe(1);
    expect(normalizeGamepadAxis(-2, 0, 1, 0)).toBe(-1);
  });

  it('死區內與邊界回傳 0', () => {
    expect(normalizeGamepadAxis(0.05, 0, 1, 0.1)).toBe(0);
    expect(normalizeGamepadAxis(-0.05, 0, 1, 0.1)).toBe(0);
    expect(normalizeGamepadAxis(0.1, 0, 1, 0.1)).toBe(0);
    expect(normalizeGamepadAxis(-0.1, 0, 1, 0.1)).toBe(0);
  });

  it('死區外扣除再縮放，滿舵仍為 ±1', () => {
    // (0.5 - 0.1) / 0.9
    expect(normalizeGamepadAxis(0.5, 0, 1, 0.1)).toBeCloseTo(0.4 / 0.9, 12);
    // (0.8 - 0.1) / 0.9
    expect(normalizeGamepadAxis(-0.8, 0, 1, 0.1)).toBeCloseTo(-0.7 / 0.9, 12);
    expect(normalizeGamepadAxis(1, 0, 1, 0.1)).toBe(1);
    expect(normalizeGamepadAxis(-1, 0, 1, 0.1)).toBe(-1);
    // 0.75 與 0.5 都是二進位精確：(0.75 - 0.5) / 0.5 = 0.5
    expect(normalizeGamepadAxis(0.75, 0, 1, 0.5)).toBe(0.5);
    expect(normalizeGamepadAxis(-0.75, 0, 1, 0.5)).toBe(-0.5);
  });

  it('套用 center / range 校正後再縮放死區', () => {
    // (0.2 - 0.1) / 0.5 = 0.2；(0.2 - 0.05) / 0.95
    expect(normalizeGamepadAxis(0.2, 0.1, 0.5, 0.05)).toBeCloseTo(0.15 / 0.95, 12);
    expect(normalizeGamepadAxis(0.6, 0.1, 0.5, 0.2)).toBe(1);
    expect(normalizeGamepadAxis(1.5, 0, 1, 0)).toBe(1);
    expect(normalizeGamepadAxis(-2, 0, 1, 0)).toBe(-1);
  });

  it('死區 ≥ 1 時整段為 0', () => {
    expect(normalizeGamepadAxis(1, 0, 1, 1)).toBe(0);
    expect(normalizeGamepadAxis(-0.4, 0, 1, 1.5)).toBe(0);
  });
});

describe('computeCalibRanges', () => {
  it('取 center 兩側最大飄移', () => {
    const ranges = computeCalibRanges([0.1, 0, 0, 0], [-0.5, 0, 0, 0], [0.9, 0, 0, 0]);
    expect(ranges[0]).toBeCloseTo(0.8);
  });

  it('無資料軸保底 0.5', () => {
    expect(computeCalibRanges([0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0])).toEqual([
      0.5, 0.5, 0.5, 0.5,
    ]);
  });
});

describe('resolveStickSource', () => {
  const gp = { throttle: 1, yaw: 0, pitch: 0, roll: 0 };
  const ble = { throttle: 0, yaw: 1, pitch: 0, roll: 0 };
  const vs = { throttle: 0, yaw: 0, pitch: 1, roll: 0 };

  it('校正中回傳全零', () => {
    expect(
      resolveStickSource({
        calibrating: true,
        gamepadConnected: true,
        gamepad: gp,
        ble,
        virtual: vs,
      }),
    ).toEqual({ throttle: 0, yaw: 0, pitch: 0, roll: 0 });
  });

  it('Gamepad 優先於 BLE 與虛擬搖桿', () => {
    expect(
      resolveStickSource({
        calibrating: false,
        gamepadConnected: true,
        gamepad: gp,
        ble,
        virtual: vs,
      }),
    ).toBe(gp);
  });

  it('BLE 優先於虛擬搖桿', () => {
    expect(
      resolveStickSource({
        calibrating: false,
        gamepadConnected: false,
        gamepad: gp,
        ble,
        virtual: vs,
      }),
    ).toBe(ble);
  });

  it('僅虛擬搖桿時回傳 virtual', () => {
    expect(
      resolveStickSource({
        calibrating: false,
        gamepadConnected: false,
        gamepad: gp,
        ble: null,
        virtual: vs,
      }),
    ).toBe(vs);
  });
});

describe('urlPresetOverrides', () => {
  it('Switch Pro 按鍵', () => {
    expect(urlPresetOverrides('?map=switch').buttonMap).toEqual({
      takeoff: 1,
      land: 0,
      reset: 3,
    });
  });

  it('iPega 反轉 + 按鍵', () => {
    const o = urlPresetOverrides('?map=ipega');
    expect(o.invertThrottle).toBe(true);
    expect(o.buttonMap).toEqual({ takeoff: 9, land: 8, reset: 0 });
  });

  it('inv 與 dz', () => {
    const o = urlPresetOverrides('?inv=y&dz=0.15');
    expect(o.invertThrottle).toBe(true);
    expect(o.invertPitch).toBe(true);
    expect(o.deadzone).toBe(0.15);
  });
});

describe('applyDeadzone', () => {
  it('小於死區归零', () => {
    expect(applyDeadzone(0.05, 0.08)).toBe(0);
    expect(applyDeadzone(-0.07, 0.08)).toBe(0);
  });
});

describe('detectButtonEdge', () => {
  it('僅在 false→true 時觸發', () => {
    expect(detectButtonEdge(true, false)).toBe(true);
    expect(detectButtonEdge(true, true)).toBe(false);
    expect(detectButtonEdge(false, false)).toBe(false);
  });
});
