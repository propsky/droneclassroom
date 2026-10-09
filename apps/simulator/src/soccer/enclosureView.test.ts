import { describe, expect, it } from 'vitest';
import { SOCCER_FIELD } from './constants';
import {
  ceilInner,
  clampSoccerCameraY,
  clampSoccerFpv,
  enclosureFaceVisible,
  shellInner,
  SOCCER_FOLLOW_DISTANCE,
  SOCCER_FOLLOW_HEIGHT,
  SOCCER_TEAM_END_INSET,
} from './enclosureView';

describe('球館外殼不要擋住飛行鏡頭', () => {
  const nearZ = shellInner(SOCCER_FIELD.halfZ);
  const farZ = -nearZ;
  const posX = shellInner(SOCCER_FIELD.halfX);
  const negX = -posX;
  const ceil = ceilInner(SOCCER_FIELD.top);

  it('練習起步跟隨鏡頭在 +Z 端牆外側：近端牆不畫、遠端與天花仍在', () => {
    // yaw 0 機頭朝 -Z，跟隨鏡頭在機尾 +Z。起飛 z = startZ，會落到外殼外面。
    const camZ = SOCCER_FIELD.startZ + SOCCER_FOLLOW_DISTANCE;
    const camY = 0.4 + SOCCER_FOLLOW_HEIGHT;
    expect(camZ).toBeGreaterThan(nearZ);
    expect(enclosureFaceVisible(camZ, 1, nearZ)).toBe(false);
    expect(enclosureFaceVisible(camZ, -1, farZ)).toBe(true);
    expect(enclosureFaceVisible(0, 1, posX)).toBe(true);
    expect(enclosureFaceVisible(0, -1, negX)).toBe(true);
    expect(enclosureFaceVisible(camY, 1, ceil)).toBe(true);
  });

  it('場內四面牆與天花都畫，戶外天空不會從殼漏進來', () => {
    expect(enclosureFaceVisible(0, 1, nearZ)).toBe(true);
    expect(enclosureFaceVisible(0, -1, farZ)).toBe(true);
    expect(enclosureFaceVisible(0, 1, posX)).toBe(true);
    expect(enclosureFaceVisible(0, -1, negX)).toBe(true);
    expect(enclosureFaceVisible(1.3, 1, ceil)).toBe(true);
  });

  it('鏡頭貼進板厚或飛到天花上方時，那一面不擋視線', () => {
    expect(enclosureFaceVisible(nearZ, 1, nearZ)).toBe(false);
    expect(enclosureFaceVisible(nearZ - 0.05, 1, nearZ)).toBe(false);
    expect(enclosureFaceVisible(ceil, 1, ceil)).toBe(false);
    expect(enclosureFaceVisible(ceil + 1, 1, ceil)).toBe(false);
    expect(enclosureFaceVisible(-posX - 1, -1, negX)).toBe(false);
  });

  it('全場視角站在端牆內側，近端牆仍然畫得出來', () => {
    const teamZ = SOCCER_FIELD.halfZ - SOCCER_TEAM_END_INSET;
    expect(teamZ).toBeLessThan(nearZ);
    expect(enclosureFaceVisible(teamZ, 1, nearZ)).toBe(true);
  });

  it('第三人稱高度收到天花內側，場內的高度不動', () => {
    const capped = clampSoccerCameraY(9, SOCCER_FIELD.top);
    expect(capped).toBeLessThan(ceil - 0.15);
    expect(enclosureFaceVisible(capped, 1, ceil)).toBe(true);
    expect(clampSoccerCameraY(1.3, SOCCER_FIELD.top)).toBeCloseTo(1.3);
  });

  it('第一人稱水平收回場內；飛高時天花不擋，場內的位置不動', () => {
    const out = clampSoccerFpv(9, 8, 12, SOCCER_FIELD);
    expect(out.x).toBeLessThan(SOCCER_FIELD.halfX);
    expect(out.z).toBeLessThan(SOCCER_FIELD.halfZ);
    expect(out.y).toBeGreaterThan(ceil);
    expect(enclosureFaceVisible(out.y, 1, ceil)).toBe(false);
    expect(enclosureFaceVisible(out.z, 1, nearZ)).toBe(true);
    expect(enclosureFaceVisible(out.x, 1, posX)).toBe(true);
    expect(clampSoccerFpv(0.2, 1.2, -1, SOCCER_FIELD)).toEqual({ x: 0.2, y: 1.2, z: -1 });
  });
});
