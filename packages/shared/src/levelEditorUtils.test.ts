import { describe, expect, it } from 'vitest';
import { clampWorld, heightHueColor, isoCanvasToWorld, isoDepthKey, isoGroundToCanvas, isoLayout, isoWorldToCanvas, ringDiameter, ringPassRadius, snapClampXZ, snapWorld, topWorldToCanvas } from './levelEditorUtils';

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

  it('ringDiameter / ringPassRadius 預設 3m', () => {
    expect(ringDiameter({})).toBe(3);
    expect(ringPassRadius({})).toBe(1.5);
    expect(ringPassRadius({ diameter: 4 })).toBe(2);
  });

  it('topWorldToCanvas 原點在中心', () => {
    const [px, py] = topWorldToCanvas(0, 0, 480, 480);
    expect(px).toBe(240);
    expect(py).toBe(240);
  });

  it('iso 2:1 斜投影：X 與 Z 分離、Y 僅向上', () => {
    const w = 480;
    const h = 480;
    const [x0, y0] = isoWorldToCanvas(0, 0, 0, w, h);
    const [x1, y1] = isoWorldToCanvas(4, 0, 0, w, h);
    const [x2, y2] = isoWorldToCanvas(0, 4, 0, w, h);
    const [x3, y3] = isoWorldToCanvas(0, 0, 2, w, h);
    // +X 往右下
    expect(x1).toBeGreaterThan(x0);
    expect(y1).toBeGreaterThan(y0);
    // +Z 往左下（與 +X 不同方向）
    expect(x2).toBeLessThan(x0);
    expect(y2).toBeGreaterThan(y0);
    // +Y 僅向上，X 不變
    expect(x3).toBeCloseTo(x0, 5);
    expect(y3).toBeLessThan(y0);
  });

  it('isoCanvasToWorld 在平面 y 上往返一致', () => {
    const w = 480;
    const h = 480;
    const planeY = 2.5;
    const src = { x: 3, z: -5 };
    const [px, py] = isoWorldToCanvas(src.x, src.z, planeY, w, h);
    const back = isoCanvasToWorld(px, py, w, h, planeY, 0.1);
    expect(back.x).toBeCloseTo(src.x, 1);
    expect(back.z).toBeCloseTo(src.z, 1);
  });

  it('isoCanvasToWorld 使用物件平面 y，非放置高度', () => {
    const w = 480;
    const h = 480;
    const [px, py] = isoWorldToCanvas(2, -3, 4, w, h);
    const at4 = isoCanvasToWorld(px, py, w, h, 4, 0);
    const at2 = isoCanvasToWorld(px, py, w, h, 2.5, 0);
    expect(at4.x).toBeCloseTo(2, 1);
    expect(at4.z).toBeCloseTo(-3, 1);
    expect(at2.x).not.toBeCloseTo(at4.x, 0);
  });
});
