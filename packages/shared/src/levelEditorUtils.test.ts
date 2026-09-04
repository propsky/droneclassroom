import { describe, expect, it } from 'vitest';
import { clampWorld, heightHueColor, snapClampXZ, snapWorld } from './levelEditorUtils';

describe('levelEditorUtils', () => {
  it('snapWorld 1m 格', () => {
    expect(snapWorld(1.4, 1)).toBe(1);
    expect(snapWorld(-2.6, 1)).toBe(-3);
  });

  it('clampWorld 限制場地', () => {
    expect(clampWorld(20)).toBe(15);
    expect(clampWorld(-20)).toBe(-15);
  });

  it('snapClampXZ 組合', () => {
    const p = snapClampXZ(1.23, -4.56, 0.5);
    expect(p.x).toBe(1);
    expect(p.z).toBe(-4.5);
  });

  it('heightHueColor 低藍高紅', () => {
    expect(heightHueColor(0)).toContain('220');
    expect(heightHueColor(8)).toContain('0');
  });
});
