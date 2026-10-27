import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PortraitChrome } from './portraitChrome';

const css = readFileSync(new URL('./style.css', import.meta.url), 'utf8');

function memory(): { getItem(key: string): string | null; setItem(key: string, value: string): void } {
  const bag = new Map<string, string>();
  return {
    getItem: (key) => (bag.has(key) ? bag.get(key)! : null),
    setItem: (key, value) => {
      bag.set(key, value);
    },
  };
}

describe('PortraitChrome 直式操控區', () => {
  it('390×844 與 360×780 是直式手機，橫式與桌機不是', () => {
    expect(PortraitChrome.isPortraitPhone(390, 844)).toBe(true);
    expect(PortraitChrome.isPortraitPhone(360, 780)).toBe(true);
    expect(PortraitChrome.isPortraitPhone(844, 390)).toBe(false);
    expect(PortraitChrome.isPortraitPhone(1280, 800)).toBe(false);
    expect(PortraitChrome.isPortraitPhone(768, 1024)).toBe(false);
  });

  it('活動關卡預設收合，開合會記住', () => {
    const store = memory();
    expect(PortraitChrome.readEntryOpen(store)).toBe(false);
    PortraitChrome.writeEntryOpen(store, true);
    expect(PortraitChrome.readEntryOpen(store)).toBe(true);
    PortraitChrome.writeEntryOpen(store, false);
    expect(PortraitChrome.readEntryOpen(store)).toBe(false);
  });

  it('兩種直式尺寸的搖桿取樣點不互壓，也不落進操控帶上方的活動抽屜', () => {
    for (const [width, height] of [
      [390, 844],
      [360, 780],
    ] as const) {
      const layout = PortraitChrome.stickLayout(width, height, { left: 0, right: 0, bottom: 0 });
      expect(layout.size).toBe(PortraitChrome.STICK_PX);
      expect(PortraitChrome.boxesOverlap(layout.left, layout.right)).toBe(false);
      const band = PortraitChrome.controlBandPx(0, layout.size);
      const drawerBottom = height - band;
      for (const box of [layout.left, layout.right]) {
        for (const point of PortraitChrome.circleSamples(box)) {
          expect(point.y).toBeGreaterThan(drawerBottom);
          expect(PortraitChrome.contains(box, point)).toBe(true);
          const other = box === layout.left ? layout.right : layout.left;
          expect(PortraitChrome.contains(other, point)).toBe(false);
        }
      }
    }
  });

  it('iOS 底部安全區把整顆搖桿抬到 home indicator 之上', () => {
    const safeBottom = 34;
    const layout = PortraitChrome.stickLayout(390, 844, { left: 0, right: 0, bottom: safeBottom });
    expect(layout.left.y + layout.left.h).toBeLessThanOrEqual(844 - safeBottom);
    expect(layout.right.y + layout.right.h).toBeLessThanOrEqual(844 - safeBottom);
    const band = PortraitChrome.controlBandPx(safeBottom, layout.size);
    expect(844 - band).toBeLessThanOrEqual(layout.left.y - PortraitChrome.LABEL_PX);
  });

  it('樣式斷點、搖桿直徑與安全區跟類別常數一致', () => {
    expect(css).toContain(PortraitChrome.QUERY);
    expect(css).toContain(`--stick-size: ${PortraitChrome.STICK_PX}px`);
    expect(css).toContain('env(safe-area-inset-bottom, 0px)');
    expect(css).toContain('env(safe-area-inset-left, 0px)');
    expect(css).toContain('env(safe-area-inset-right, 0px)');
    expect(css).toContain('env(safe-area-inset-top, 0px)');
  });
});

describe('封鎖網站資料', () => {
  it('讀 localStorage 就丟錯時，直式選單照常初始化（預設收合）', () => {
    const blocked = {
      get localStorage(): never {
        throw new DOMException('blocked', 'SecurityError');
      },
    };
    const storage = PortraitChrome.storageOf(blocked as never);
    expect(storage).toBeNull();
    expect(PortraitChrome.readEntryOpen(storage)).toBe(false);
    expect(() => PortraitChrome.writeEntryOpen(storage, true)).not.toThrow();
  });
});
