import { describe, expect, it } from 'vitest';
import {
  balloonDiameter,
  balloonPopRadius,
  compactPhysics,
  obstacleDefaultColor,
  obstacleIsCollidable,
  parseLevelColor,
  ringBobAmp,
  ringSpin,
} from './levelObjectDefaults';

describe('levelObjectDefaults', () => {
  it('parseLevelColor 支援 hex 與數字', () => {
    expect(parseLevelColor('#38bdf8', '#000')).toBe('#38bdf8');
    expect(parseLevelColor(0xff0000, '#000')).toBe('#ff0000');
    expect(parseLevelColor('red', '#abc')).toBe('#abc');
  });

  it('ringSpin / ringBobAmp 預設值', () => {
    expect(ringSpin({})).toBe(0.015);
    expect(ringBobAmp({ bobAmp: 0 })).toBe(0);
    expect(ringBobAmp({})).toBe(0.2);
  });

  it('balloonPopRadius 依直徑', () => {
    expect(balloonPopRadius({})).toBeCloseTo(0.7);
    expect(balloonPopRadius({ diameter: 2 })).toBe(1);
  });

  it('obstacleIsCollidable 尊重 physics', () => {
    expect(obstacleIsCollidable({ type: 'soft-cube', x: 0, y: 0, z: 0, size: 1 })).toBe(false);
    expect(obstacleIsCollidable({ type: 'cube', solid: true, x: 0, y: 0, z: 0, size: 1 })).toBe(true);
    expect(
      obstacleIsCollidable({
        type: 'soft-cube',
        x: 0,
        y: 0,
        z: 0,
        size: 1,
        physics: { collidable: true },
      }),
    ).toBe(true);
  });

  it('compactPhysics 省略預設', () => {
    expect(compactPhysics({ collidable: false, restitution: 0.05, friction: 0.55 })).toBeUndefined();
    expect(compactPhysics({ collidable: true })?.collidable).toBe(true);
  });

  it('obstacleDefaultColor', () => {
    expect(obstacleDefaultColor(true)).toBe('#f87171');
    expect(obstacleDefaultColor(false)).toBe('#4ade80');
  });
});
