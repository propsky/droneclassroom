import { describe, expect, it } from 'vitest';
import { PadGrab, type Reach } from './padGrab';

const FAR: Reach = { left: -Infinity, top: -Infinity, right: Infinity, bottom: Infinity };

describe('觸控搖桿相對拖曳', () => {
  it('按下去的瞬間搖桿不動：按在哪裡都一樣', () => {
    const g = new PadGrab();
    g.grab(130, 470, 0, 0, 61, FAR);
    expect(g.read(130, 470)).toEqual([0, 0]);
  });

  it('從按下的點起算：推滿行程是滿舵，再推也不超過', () => {
    const g = new PadGrab();
    g.grab(100, 500, 0, 0, 60, FAR);
    expect(g.read(130, 500)[0]).toBeCloseTo(0.5);
    expect(g.read(160, 500)[0]).toBe(1);
    expect(g.read(400, 500)[0]).toBe(1);
    // 往上推 = y 正
    expect(g.read(100, 440)[1]).toBe(1);
    expect(g.read(100, 530)[1]).toBeCloseTo(-0.5);
  });

  it('兩軸各自算（方形行程）：斜推兩軸都能到滿', () => {
    const g = new PadGrab();
    g.grab(100, 500, 0, 0, 60, FAR);
    expect(g.read(160, 440)).toEqual([1, 1]);
  });

  it('按下時搖桿不在中心：那個值留在手指底下，兩側各自縮放到 ±1', () => {
    const g = new PadGrab();
    g.grab(100, 500, 0.5, 0, 60, FAR);
    expect(g.read(100, 500)[0]).toBe(0.5);
    expect(g.read(130, 500)[0]).toBe(1); // 剩 0.5 → 30px
    expect(g.read(10, 500)[0]).toBe(-1); // 要 1.5 → 90px
  });

  it('靠螢幕邊按下：往邊那一側推到螢幕邊就是滿舵', () => {
    const g = new PadGrab();
    const reach = PadGrab.reachOf(1024, 768);
    g.grab(28, 700, 0, 0, 61, reach);
    // 左邊只剩 20px 才到 8px 邊界
    expect(g.read(8, 700)[0]).toBe(-1);
    expect(g.read(18, 700)[0]).toBeCloseTo(-0.5);
    // 右邊照常 61px
    expect(g.read(89, 700)[0]).toBe(1);
  });

  it('行程 = 圓盤半徑扣掉搖桿頭，太小的圓盤也至少 8px', () => {
    expect(PadGrab.travel(170)).toBe(61);
    expect(PadGrab.travel(20)).toBe(8);
  });
});
