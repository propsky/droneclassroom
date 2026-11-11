import { describe, expect, it } from 'vitest';
import {
  SOCCER_OCCLUDER_FADE,
  soccerFixedViewClutter,
  soccerOccludes,
  stepOccluderFade,
  type OccluderBox,
} from './soccerSight';

// 角柱：直徑 0.28、高 3，立在 (1.5, *, 3)
const post: OccluderBox = { min: { x: 1.36, y: 0, z: 2.86 }, max: { x: 1.64, y: 3, z: 3.14 } };
// 天花鋼架：橫過整場、離地 2.5
const truss: OccluderBox = { min: { x: -1.5, y: 2.5, z: -0.11 }, max: { x: 1.5, y: 2.66, z: 0.11 } };

describe('足球遮擋淡化', () => {
  it('柱子擋在鏡頭與機身之間才淡化，旁邊的柱子不動', () => {
    const eye = { x: 2.2, y: 1.6, z: 4.5 };
    // 視線經過 (1.5, *, 3) 附近
    expect(soccerOccludes(eye, { x: 0.3, y: 1.4, z: 0.5 }, post)).toBe(true);
    // 視線往場中另一側，離柱子很遠
    expect(soccerOccludes({ x: 0, y: 1.65, z: 4.5 }, { x: -1, y: 1.2, z: -2 }, post)).toBe(false);
  });

  it('機身飛到天花鋼架上方、鏡頭在下面看上去：鋼架淡化；平飛時不淡化', () => {
    expect(soccerOccludes({ x: 0, y: 1.6, z: 4.5 }, { x: 0, y: 2.9, z: -1 }, truss)).toBe(true);
    expect(soccerOccludes({ x: 0, y: 1.6, z: 4.5 }, { x: 0, y: 1.5, z: -2 }, truss)).toBe(false);
  });

  it('鏡頭埋進柱子、或機身貼著柱子邊（護罩半徑內）也算擋', () => {
    expect(soccerOccludes({ x: 1.5, y: 1.5, z: 3 }, { x: 0, y: 1, z: 0 }, post)).toBe(true);
    expect(soccerOccludes({ x: 0, y: 1.6, z: 4.5 }, { x: 1.2, y: 1.5, z: 3 }, post)).toBe(true);
  });

  it('淡化與還原跟幀率無關，最後停在固定值', () => {
    let a = 1;
    for (let i = 0; i < 60; i++) a = stepOccluderFade(a, true, 1000 / 60);
    let b = 1;
    for (let i = 0; i < 20; i++) b = stepOccluderFade(b, true, 50);
    expect(a).toBe(SOCCER_OCCLUDER_FADE);
    expect(b).toBe(SOCCER_OCCLUDER_FADE);
    let c = SOCCER_OCCLUDER_FADE;
    for (let i = 0; i < 60; i++) c = stepOccluderFade(c, false, 1000 / 60);
    expect(c).toBe(1);
    // 一幀只走一部分，不會一閃
    expect(stepOccluderFade(1, true, 1000 / 60)).toBeGreaterThan(0.7);
  });
});

describe('考證／全場定點鏡頭的前景雜物', () => {
  it('天花鋼架與燈具一律淡掉；鏡頭這一端的柱子、橫梁淡掉，對面維持實心', () => {
    for (const mode of ['exam', 'team'] as const) {
      expect(soccerFixedViewClutter(mode, { kind: 'ceiling' }, 1)).toBe(true);
      expect(soccerFixedViewClutter(mode, { kind: 'end', end: 1 }, 1)).toBe(true);
      expect(soccerFixedViewClutter(mode, { kind: 'end', end: -1 }, 1)).toBe(false);
      expect(soccerFixedViewClutter(mode, { kind: 'other' }, 1)).toBe(false);
    }
  });

  it('跟隨與第一人稱只看視線，不整片淡掉', () => {
    for (const mode of ['follow', 'fpv'] as const) {
      expect(soccerFixedViewClutter(mode, { kind: 'ceiling' }, 1)).toBe(false);
      expect(soccerFixedViewClutter(mode, { kind: 'end', end: 1 }, 1)).toBe(false);
    }
  });
});
