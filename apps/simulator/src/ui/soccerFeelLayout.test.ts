import { describe, expect, it } from 'vitest';
import { SoccerFeelLayout, type FeelBox } from './soccerFeelLayout';

function assertClear(view: { w: number; h: number }, panel: { w: number; h: number }, obstacles: FeelBox[]): FeelBox {
  const box = SoccerFeelLayout.place(view, panel, obstacles);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.w).toBeLessThanOrEqual(view.w + 1);
  expect(box.y + box.h).toBeLessThanOrEqual(view.h + 1);
  expect(SoccerFeelLayout.hitsAny(box, obstacles)).toBe(false);
  return box;
}

describe('SoccerFeelLayout', () => {
  const panel = { w: 240, h: 110 };

  it('桌機放在狀態卡與活動鈕之間的空位', () => {
    const obstacles: FeelBox[] = [
      { x: 0, y: 0, w: 1280, h: 56 },
      { x: 16, y: 72, w: 200, h: 220 },
      { x: 1000, y: 72, w: 260, h: 80 },
      { x: 1120, y: 640, w: 144, h: 144 },
    ];
    assertClear({ w: 1280, h: 800 }, panel, obstacles);
  });

  it('橫式平板不壓右搖桿、活動鈕與右上計分', () => {
    const obstacles: FeelBox[] = [
      { x: 0, y: 0, w: 1024, h: 56 },
      { x: 16, y: 72, w: 190, h: 160 },
      { x: 748, y: 72, w: 260, h: 88 },
      { x: 860, y: 420, w: 148, h: 136 },
      { x: 16, y: 560, w: 170, h: 190 },
      { x: 838, y: 560, w: 170, h: 190 },
    ];
    assertClear({ w: 1024, h: 768 }, panel, obstacles);
  });

  it('直式手機比分在右上時，手感改放到比分與搖桿之間', () => {
    const obstacles: FeelBox[] = [
      { x: 0, y: 0, w: 390, h: 56 },
      { x: 12, y: 68, w: 176, h: 210 },
      { x: 150, y: 68, w: 228, h: 92 },
      { x: 250, y: 640, w: 128, h: 40 },
      { x: 12, y: 700, w: 132, h: 132 },
      { x: 246, y: 700, w: 132, h: 132 },
    ];
    const box = assertClear({ w: 390, h: 844 }, panel, obstacles);
    expect(box.y).toBeGreaterThan(56);
  });

  it('直式手機不壓操控帶上的活動鈕與左右搖桿', () => {
    const obstacles: FeelBox[] = [
      { x: 0, y: 0, w: 390, h: 56 },
      { x: 12, y: 68, w: 170, h: 200 },
      { x: 250, y: 620, w: 128, h: 40 },
      { x: 12, y: 680, w: 132, h: 150 },
      { x: 246, y: 680, w: 132, h: 150 },
    ];
    assertClear({ w: 390, h: 844 }, panel, obstacles);
  });
});
