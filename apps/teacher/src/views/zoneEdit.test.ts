import { describe, expect, it } from 'vitest';
import { HEADING_TOLERANCE_DEG, PassZoneJudge, type PassZoneDef, type Pose } from '@creafly/shared';
import { ZoneEdit } from './zoneEdit';

const pose = (p: Partial<Pose>): Pose => ({
  x: 0,
  y: 0,
  z: 0,
  accumulatedYawDeg: 0,
  previousYawDeg: 0,
  grounded: true,
  ...p,
});

const forward: PassZoneDef = { type: 'position', x: 0, z: -6, label: '前進 6m', maxZ: -5.5, triggerRadius: 2 };

describe('任務點換類型', () => {
  it('換成高度：預設要飛到 1m 以上，不會站在地上就過關', () => {
    const z = ZoneEdit.convert(forward, 'altitude');
    expect(z).toMatchObject({ type: 'altitude', x: 0, z: -6, label: '前進 6m', minY: 1, triggerRadius: 2 });
    expect(PassZoneJudge.satisfies(z, pose({ x: 0, z: -6, y: 0 }))).toBe(false);
  });

  it('換成轉角：預設累積左轉 90°、容差正常，不會一開始就過或永遠過不了', () => {
    const z = ZoneEdit.convert(forward, 'heading');
    expect(z).toMatchObject({ type: 'heading', targetYaw: 90, tolerance: HEADING_TOLERANCE_DEG, yawMode: 'accumulated' });
    expect(PassZoneJudge.satisfies(z, pose({ x: 0, z: -6 }))).toBe(false);
    expect(PassZoneJudge.satisfies(z, pose({ x: 0, z: -6, accumulatedYawDeg: 90, previousYawDeg: 90 }))).toBe(true);
  });

  it('換成位置：框圍著自己 ±1m，不會縮成原點一個點', () => {
    const alt: PassZoneDef = { type: 'altitude', x: 3, z: -4, label: 'a', minY: 2 };
    expect(ZoneEdit.convert(alt, 'position')).toMatchObject({ minX: 2, maxX: 4, minZ: -5, maxZ: -3 });
  });

  it('類型沒變：原樣回傳', () => {
    expect(ZoneEdit.convert(forward, 'position')).toBe(forward);
  });
});

describe('任務點移動與邊界', () => {
  it('拖曳或方向鍵移動：位置框一起平移，沒設的邊仍然不限', () => {
    const moved = ZoneEdit.translate(forward, 2, -8);
    expect(moved).toMatchObject({ x: 2, z: -8, maxZ: -7.5 });
    expect(moved.type === 'position' && moved.minX).toBeUndefined();
  });

  it('高度、轉角任務點只改中心', () => {
    const alt: PassZoneDef = { type: 'altitude', x: 0, z: 0, label: 'a', minY: 1, triggerRadius: 1.5 };
    expect(ZoneEdit.translate(alt, 1, 1)).toEqual({ ...alt, x: 1, z: 1 });
  });

  it('邊界欄位空白＝不限，不是 0', () => {
    expect(ZoneEdit.readBound('')).toBeUndefined();
    expect(ZoneEdit.readBound('  ')).toBeUndefined();
    expect(ZoneEdit.readBound('0')).toBe(0);
    expect(ZoneEdit.readBound('-5.5')).toBe(-5.5);
  });

  it('編輯器畫框：沒設的邊畫到場地邊緣', () => {
    const box = ZoneEdit.drawBox(forward as { maxZ: number });
    expect(box.maxZ).toBe(-5.5);
    expect(box.minZ).toBeLessThan(-14);
    expect(ZoneEdit.hasBox(forward as { maxZ: number })).toBe(true);
    expect(ZoneEdit.hasBox({})).toBe(false);
  });
});
