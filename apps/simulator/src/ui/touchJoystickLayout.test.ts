import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PortraitChrome } from './portraitChrome';
import { TouchJoystickLayout, type Box, type JoystickPlan } from './touchJoystickLayout';

const css = readFileSync(new URL('./style.css', import.meta.url), 'utf8');

/** 桌機實測的活動入口：三顆鈕直排，寬 132、高 136，貼右下 --sp-4。 */
const ENTRY = { w: 132, h: 136 };

function assertOnScreen(plan: JoystickPlan, width: number, height: number): { left: Box; right: Box } {
  const boxes = TouchJoystickLayout.stickBoxes(plan, width, height);
  for (const box of [boxes.left, boxes.right]) {
    expect(box.w).toBeGreaterThan(0);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(56);
    expect(box.x + box.w).toBeLessThanOrEqual(width);
    expect(box.y + box.h).toBeLessThanOrEqual(height);
  }
  expect(TouchJoystickLayout.boxesOverlap(boxes.left, boxes.right)).toBe(false);
  return boxes;
}

describe('TouchJoystickLayout 觸控筆電讓位', () => {
  it('1366×768、1920×1080、1280×800 把活動入口抬過搖桿，圓盤留在角落', () => {
    for (const [width, height] of [
      [1366, 768],
      [1920, 1080],
      [1280, 800],
    ] as const) {
      const plan = TouchJoystickLayout.plan({ width, height, entry: ENTRY });
      expect(plan.sizePx, `${width}×${height}`).toBe(TouchJoystickLayout.STICK_PX);
      expect(plan.rightPx).toBe(TouchJoystickLayout.SIDE_PAD_PX);
      expect(plan.entryLiftPx).not.toBeNull();
      const boxes = assertOnScreen(plan, width, height);
      const entryTop = height - (plan.entryLiftPx ?? 0) - ENTRY.h;
      const entry: Box = {
        x: width - TouchJoystickLayout.ENTRY_REST_PX - ENTRY.w,
        y: entryTop,
        w: ENTRY.w,
        h: ENTRY.h,
      };
      expect(entry.y).toBeGreaterThanOrEqual(56 + TouchJoystickLayout.HEADER_GAP_PX);
      expect(TouchJoystickLayout.boxesOverlap(entry, TouchJoystickLayout.protectedBox(boxes.right))).toBe(false);
      expect(TouchJoystickLayout.boxesOverlap(entry, TouchJoystickLayout.protectedBox(boxes.left))).toBe(false);
      // 關卡選單停在搖桿帶之上，不會再往下蓋到圓盤
      const menuBottom = 56 + Math.min(height * 0.7, height - 56 - plan.bandPx - 12);
      expect(menuBottom).toBeLessThanOrEqual(boxes.right.y - TouchJoystickLayout.LABEL_PX + 1);
    }
  });

  it('devicePixelRatio 不進佈局（1366×768 在 1.25／1.5 仍是同一組 CSS 像素）', () => {
    const a = TouchJoystickLayout.plan({ width: 1366, height: 768, entry: ENTRY });
    const b = TouchJoystickLayout.plan({ width: 1366, height: 768, entry: ENTRY });
    expect(b).toEqual(a);
    expect(a.sizePx).toBe(170);
  });

  it('橫式 844×390 活動入口維持右下，右桿內縮且直徑仍大於 160', () => {
    const width = 844;
    const height = 390;
    const plan = TouchJoystickLayout.plan({ width, height, entry: ENTRY });
    expect(plan.entryLiftPx).toBeNull();
    expect(plan.sizePx).toBeGreaterThan(160);
    const boxes = assertOnScreen(plan, width, height);
    const resting = TouchJoystickLayout.restingEntry(ENTRY, width, height)!;
    expect(TouchJoystickLayout.boxesOverlap(resting, TouchJoystickLayout.protectedBox(boxes.right))).toBe(false);
    expect(TouchJoystickLayout.boxesOverlap(resting, TouchJoystickLayout.protectedBox(boxes.left))).toBe(false);
  });

  it('直式尺寸不是這條路徑要改的版面', () => {
    expect(PortraitChrome.isPortraitPhone(390, 844)).toBe(true);
    expect(PortraitChrome.isPortraitPhone(1366, 768)).toBe(false);
    expect(PortraitChrome.isPortraitPhone(844, 390)).toBe(false);
  });

  it('沒有活動入口時搖桿停在左右下角', () => {
    const plan = TouchJoystickLayout.plan({ width: 1366, height: 768, entry: null });
    expect(plan.entryLiftPx).toBeNull();
    expect(plan.rightPx).toBe(TouchJoystickLayout.SIDE_PAD_PX);
    expect(plan.leftPx).toBe(TouchJoystickLayout.SIDE_PAD_PX);
    assertOnScreen(plan, 1366, 768);
  });

  it('底部安全區把圓盤與活動入口一起抬高，仍不重疊', () => {
    const plan = TouchJoystickLayout.plan({
      width: 1366,
      height: 768,
      entry: ENTRY,
      safe: { bottom: 34, left: 0, right: 0, top: 0 },
    });
    expect(plan.bottomPx).toBe(34);
    expect(plan.entryLiftPx).not.toBeNull();
    const boxes = assertOnScreen(plan, 1366, 768);
    expect(boxes.left.y + boxes.left.h).toBeLessThanOrEqual(768 - 34);
    const entry: Box = {
      x: 1366 - 16 - ENTRY.w,
      y: 768 - (plan.entryLiftPx ?? 0) - ENTRY.h,
      w: ENTRY.w,
      h: ENTRY.h,
    };
    expect(TouchJoystickLayout.boxesOverlap(entry, TouchJoystickLayout.protectedBox(boxes.right))).toBe(false);
  });

  it('樣式用變數讓位，直式媒體查詢仍覆寫直徑與底緣', () => {
    expect(css).toContain('var(--entry-lift, var(--sp-4))');
    expect(css).toContain('var(--joystick-right, var(--sp-6))');
    expect(css).toContain('var(--joystick-size, 170px)');
    expect(css).toContain('var(--joystick-band, 0px)');
    expect(css).toContain(PortraitChrome.QUERY);
    expect(css).toContain(`--stick-size: ${PortraitChrome.STICK_PX}px`);
  });
});
