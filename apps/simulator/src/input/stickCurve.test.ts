import { describe, expect, it } from 'vitest';
import { YAW_STICK_RATE } from '../core/droneState';
import { StickCurve } from './stickCurve';

describe('StickCurve.rawRate', () => {
  it('線性（expo 0、super 0）與搖桿成正比', () => {
    expect(StickCurve.rawRate(0, 100, 0, 0)).toBe(0);
    expect(StickCurve.rawRate(1, 100, 0, 0)).toBe(200);
    expect(StickCurve.rawRate(-1, 100, 0, 0)).toBe(-200);
    expect(StickCurve.rawRate(0.5, 100, 0, 0)).toBe(100);
    expect(StickCurve.rawRate(0.25, 100, 0, 0)).toBe(50);
    expect(StickCurve.rawRate(-0.25, 100, 0, 0)).toBe(-50);
  });

  it('expo 只彎中段，滿舵端點維持 200 deg/s', () => {
    // x=0.5, E=50：x1 = 0.5*(0.125)*0.5 + 0.5*0.5 = 0.28125；w = 56.25
    expect(StickCurve.rawRate(0.5, 100, 0, 50)).toBe(56.25);
    expect(StickCurve.rawRate(-0.5, 100, 0, 50)).toBe(-56.25);
    expect(StickCurve.rawRate(1, 100, 0, 50)).toBe(200);
    expect(StickCurve.rawRate(-1, 100, 0, 100)).toBe(-200);
    // x=0.25, E=100：x1 = 0.25 * 0.015625 = 0.00390625；w = 0.78125
    expect(StickCurve.rawRate(0.25, 100, 0, 100)).toBe(0.78125);
    expect(StickCurve.rawRate(-0.25, 100, 0, 100)).toBe(-0.78125);
    expect(StickCurve.rawRate(0, 100, 70, 50)).toBe(0);
  });

  it('super rate 在末端放大，並把分母夾在 0.01', () => {
    // x=0.5, S=70：100 / (1 - 0.35) = 2000/13
    expect(StickCurve.rawRate(0.5, 100, 70, 0)).toBeCloseTo(2000 / 13, 10);
    // x=1, S=70：200 / 0.3 = 2000/3
    expect(StickCurve.rawRate(1, 100, 70, 0)).toBeCloseTo(2000 / 3, 10);
    expect(StickCurve.rawRate(-1, 100, 70, 0)).toBeCloseTo(-2000 / 3, 10);
    // S=100、滿舵：1 - 1 被夾到 0.01 → 200 / 0.01
    expect(StickCurve.rawRate(1, 100, 100, 0)).toBe(20000);
  });

  it('rc rate > 2 加上 14.54 增量', () => {
    // R=250 → r=2.5 → 2.5 + 14.54*0.5 = 9.77 → 200*9.77 = 1954
    expect(StickCurve.rawRate(1, 250, 0, 0)).toBeCloseTo(1954, 8);
    expect(StickCurve.rawRate(-1, 250, 0, 0)).toBeCloseTo(-1954, 8);
  });

  it('同一輸入兩次呼叫結果相同', () => {
    const samples: Array<[number, number, number, number]> = [
      [0.3, 100, 0, 40],
      [-0.8, 120, 65, 20],
      [1, 180, 70, 0],
    ];
    for (const [x, r, s, e] of samples) {
      expect(StickCurve.rawRate(x, r, s, e)).toBe(StickCurve.rawRate(x, r, s, e));
    }
  });
});

describe('StickCurve.shapeYawStick', () => {
  it('expo 0 與改動前的線性搖桿是同一個數', () => {
    const sticks = [-1, -0.75, -0.5, -0.25, -0.1, -0.02, 0, 0.02, 0.1, 0.25, 0.3, 0.5, 0.75, 1];
    for (const x of sticks) {
      expect(StickCurve.shapeYawStick(x, 0)).toBe(x);
      expect(StickCurve.shapeYawStick(x, -5)).toBe(x);
      expect(-StickCurve.shapeYawStick(x, 0) * YAW_STICK_RATE).toBe(-x * YAW_STICK_RATE);
    }
  });

  it('滿舵仍對應 YAW_STICK_RATE，中段比線性柔', () => {
    for (const expo of [1, 30, 50, 100]) {
      expect(StickCurve.shapeYawStick(1, expo)).toBe(1);
      expect(StickCurve.shapeYawStick(-1, expo)).toBe(-1);
      expect(-StickCurve.shapeYawStick(1, expo) * YAW_STICK_RATE).toBe(-YAW_STICK_RATE);
      expect(-StickCurve.shapeYawStick(-1, expo) * YAW_STICK_RATE).toBe(YAW_STICK_RATE);
      expect(Math.abs(StickCurve.shapeYawStick(0.5, expo))).toBeLessThan(0.5);
    }
    expect(StickCurve.shapeYawStick(0, 80)).toBe(0);
    expect(StickCurve.shapeYawStick(0.5, 50)).toBe(0.28125);
    expect(StickCurve.shapeYawStick(-0.5, 100)).toBe(-0.0625);
  });
});

describe('StickCurve.applyDeadband', () => {
  it('死區內與邊界為 0，死區外扣除再縮放，滿舵仍為 ±1', () => {
    expect(StickCurve.applyDeadband(0.2, 0.25)).toBe(0);
    expect(StickCurve.applyDeadband(-0.25, 0.25)).toBe(0);
    expect(StickCurve.applyDeadband(0.25, 0.25)).toBe(0);
    expect(StickCurve.applyDeadband(0.5, 0.25)).toBeCloseTo(1 / 3, 12);
    expect(StickCurve.applyDeadband(-0.5, 0.25)).toBeCloseTo(-1 / 3, 12);
    expect(StickCurve.applyDeadband(1, 0.25)).toBe(1);
    expect(StickCurve.applyDeadband(-1, 0.25)).toBe(-1);
  });

  it('db ≤ 0 原樣返回，db ≥ 1 整段為 0', () => {
    expect(StickCurve.applyDeadband(0.4, 0)).toBe(0.4);
    expect(StickCurve.applyDeadband(-0.4, -0.2)).toBe(-0.4);
    expect(StickCurve.applyDeadband(1, 1)).toBe(0);
    expect(StickCurve.applyDeadband(-0.2, 1.5)).toBe(0);
  });
});
