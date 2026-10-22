// 觸控筆電／橫式：虛擬搖桿不能被右下活動入口蓋住，也不能超出畫面。
// 直式手機交給 PortraitChrome 與 style.css 的直式媒體查詢，這裡不改那組數字。
import { PortraitChrome } from './portraitChrome';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Size {
  w: number;
  h: number;
}

export interface Insets {
  left: number;
  right: number;
  bottom: number;
  top: number;
}

export interface JoystickPlan {
  sizePx: number;
  leftPx: number;
  rightPx: number;
  bottomPx: number;
  /** null：活動入口留在右下角。有值：bottom 抬到搖桿帶之上。 */
  entryLiftPx: number | null;
  /** 從視窗底緣算起、關卡選單不可進入的高度（含圓盤與標籤）。 */
  bandPx: number;
}

/**
 * 非直式手機的搖桿讓位。
 * 畫面夠高時把右下活動入口抬到搖桿之上（搖桿留在角落，關卡選單仍在上方）。
 * 畫面太矮（橫式手機）抬上去會壓到工具列，改把右桿內縮，活動入口維持原位。
 */
export class TouchJoystickLayout {
  /** 與 .joystick-zone 預設直徑、--sp 對齊。 */
  static readonly STICK_PX = 170;
  static readonly MIN_STICK_PX = 96;
  /** --sp-6，左右預設邊距。 */
  static readonly SIDE_PAD_PX = 32;
  /** --sp-5，圓盤底緣。 */
  static readonly BOTTOM_PAD_PX = 24;
  /** .joystick-label 用 --sp-5 往上長。 */
  static readonly LABEL_PX = 24;
  /** --sp-3，搖桿與活動入口、左右桿之間的縫。 */
  static readonly CLEAR_PX = 12;
  /** #entry-group 靜止時的 right / bottom（--sp-4）。 */
  static readonly ENTRY_REST_PX = 16;
  static readonly HEADER_FALLBACK_PX = 56;
  static readonly HEADER_GAP_PX = 8;

  static boxesOverlap(a: Box, b: Box): boolean {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  /** 活動入口若沒被抬起、停在右下角時的盒子（用實測寬高，不看目前的 top）。 */
  static restingEntry(entry: Size | null, width: number, height: number): Box | null {
    if (!entry || entry.w <= 0 || entry.h <= 0 || width <= 0 || height <= 0) return null;
    return {
      x: width - TouchJoystickLayout.ENTRY_REST_PX - entry.w,
      y: height - TouchJoystickLayout.ENTRY_REST_PX - entry.h,
      w: entry.w,
      h: entry.h,
    };
  }

  static stickBoxes(plan: JoystickPlan, width: number, height: number): { left: Box; right: Box } {
    const y = height - plan.bottomPx - plan.sizePx;
    return {
      left: { x: plan.leftPx, y, w: plan.sizePx, h: plan.sizePx },
      right: { x: width - plan.rightPx - plan.sizePx, y, w: plan.sizePx, h: plan.sizePx },
    };
  }

  /** 含上方標籤的保護範圍，浮層不能壓進來。 */
  static protectedBox(stick: Box): Box {
    return {
      x: stick.x,
      y: stick.y - TouchJoystickLayout.LABEL_PX,
      w: stick.w,
      h: stick.h + TouchJoystickLayout.LABEL_PX,
    };
  }

  static plan(args: {
    width: number;
    height: number;
    entry: Size | null;
    safe?: Partial<Insets>;
    headerPx?: number;
  }): JoystickPlan {
    const safeLeft = Math.max(0, args.safe?.left ?? 0);
    const safeRight = Math.max(0, args.safe?.right ?? 0);
    const safeBottom = Math.max(0, args.safe?.bottom ?? 0);
    const safeTop = Math.max(0, args.safe?.top ?? 0);
    const header = args.headerPx ?? TouchJoystickLayout.HEADER_FALLBACK_PX;
    const bottom = Math.max(TouchJoystickLayout.BOTTOM_PAD_PX, safeBottom);
    const left = Math.max(TouchJoystickLayout.SIDE_PAD_PX, safeLeft);
    let right = Math.max(TouchJoystickLayout.SIDE_PAD_PX, safeRight);
    const resting = TouchJoystickLayout.restingEntry(args.entry, args.width, args.height);
    const minTop = header + TouchJoystickLayout.HEADER_GAP_PX + safeTop;

    const fitSize = (insetRight: number): number => {
      const maxH = Math.floor(args.height - minTop - bottom - TouchJoystickLayout.LABEL_PX);
      const maxW = Math.floor((args.width - left - insetRight - TouchJoystickLayout.CLEAR_PX) / 2);
      return Math.min(TouchJoystickLayout.STICK_PX, Math.max(0, maxH), Math.max(0, maxW));
    };

    const overlapsResting = (size: number, insetRight: number): boolean => {
      if (!resting || size <= 0) return false;
      const y = args.height - bottom - size;
      const stick: Box = { x: args.width - insetRight - size, y, w: size, h: size };
      return TouchJoystickLayout.boxesOverlap(resting, TouchJoystickLayout.protectedBox(stick));
    };

    let size = fitSize(right);
    let entryLift: number | null = null;
    if (resting && overlapsResting(size, right)) {
      const lift = bottom + size + TouchJoystickLayout.LABEL_PX + TouchJoystickLayout.CLEAR_PX;
      const entryTop = args.height - lift - resting.h;
      if (entryTop >= minTop) {
        entryLift = lift;
      } else {
        right = Math.max(right, Math.ceil(resting.w + TouchJoystickLayout.ENTRY_REST_PX + TouchJoystickLayout.CLEAR_PX));
        size = fitSize(right);
      }
    }

    if (entryLift != null) {
      entryLift = bottom + size + TouchJoystickLayout.LABEL_PX + TouchJoystickLayout.CLEAR_PX;
      const entryTop = args.height - entryLift - (resting?.h ?? 0);
      if (entryTop < minTop && resting) {
        entryLift = null;
        right = Math.max(right, Math.ceil(resting.w + TouchJoystickLayout.ENTRY_REST_PX + TouchJoystickLayout.CLEAR_PX));
        size = fitSize(right);
      }
    }

    return {
      sizePx: size,
      leftPx: left,
      rightPx: right,
      bottomPx: bottom,
      entryLiftPx: entryLift,
      bandPx: bottom + size + TouchJoystickLayout.LABEL_PX + TouchJoystickLayout.CLEAR_PX,
    };
  }

  static readSafeInsets(doc: Document): Insets {
    const zero = { left: 0, right: 0, bottom: 0, top: 0 };
    const view = doc.defaultView;
    if (!view || !doc.body) return zero;
    const probe = doc.createElement('div');
    probe.style.cssText = [
      'position:fixed',
      'left:0',
      'top:0',
      'visibility:hidden',
      'pointer-events:none',
      'padding-top:env(safe-area-inset-top,0px)',
      'padding-right:env(safe-area-inset-right,0px)',
      'padding-bottom:env(safe-area-inset-bottom,0px)',
      'padding-left:env(safe-area-inset-left,0px)',
    ].join(';');
    doc.body.appendChild(probe);
    const cs = view.getComputedStyle(probe);
    const px = (value: string): number => {
      const n = Number.parseFloat(value);
      return Number.isFinite(n) ? n : 0;
    };
    const insets = {
      top: px(cs.paddingTop),
      right: px(cs.paddingRight),
      bottom: px(cs.paddingBottom),
      left: px(cs.paddingLeft),
    };
    probe.remove();
    return insets;
  }

  /** 直式手機沿用原媒體查詢。其餘尺寸把讓位寫進 CSS 變數。 */
  static apply(doc: Document): void {
    const root = doc.documentElement;
    const clear = (): void => {
      root.style.removeProperty('--entry-lift');
      root.style.removeProperty('--joystick-right');
      root.style.removeProperty('--joystick-left');
      root.style.removeProperty('--joystick-size');
      root.style.removeProperty('--joystick-band');
      root.style.removeProperty('--header-h');
    };
    const view = doc.defaultView;
    if (!view) {
      clear();
      return;
    }
    const width = view.innerWidth;
    const height = view.innerHeight;
    const visible = doc.body.classList.contains('touch-joysticks')
      && !doc.body.classList.contains('gamepad-connected')
      && !doc.body.classList.contains('ble-connected');
    if (PortraitChrome.isPortraitPhone(width, height) || !visible) {
      clear();
      return;
    }
    const entryEl = doc.getElementById('entry-group');
    const rect = entryEl?.getBoundingClientRect();
    const entry = rect && rect.width > 1 && rect.height > 1 ? { w: rect.width, h: rect.height } : null;
    const headerEl = doc.getElementById('header');
    const measuredHeader = headerEl?.getBoundingClientRect().height ?? 0;
    const headerPx = measuredHeader > 0 ? measuredHeader : TouchJoystickLayout.HEADER_FALLBACK_PX;
    const plan = TouchJoystickLayout.plan({
      width,
      height,
      entry,
      safe: TouchJoystickLayout.readSafeInsets(doc),
      headerPx,
    });
    root.style.setProperty('--header-h', `${headerPx}px`);
    root.style.setProperty('--joystick-band', `${plan.bandPx}px`);
    if (plan.entryLiftPx != null) root.style.setProperty('--entry-lift', `${plan.entryLiftPx}px`);
    else root.style.removeProperty('--entry-lift');
    if (plan.rightPx !== TouchJoystickLayout.SIDE_PAD_PX) root.style.setProperty('--joystick-right', `${plan.rightPx}px`);
    else root.style.removeProperty('--joystick-right');
    if (plan.leftPx !== TouchJoystickLayout.SIDE_PAD_PX) root.style.setProperty('--joystick-left', `${plan.leftPx}px`);
    else root.style.removeProperty('--joystick-left');
    if (plan.sizePx !== TouchJoystickLayout.STICK_PX) root.style.setProperty('--joystick-size', `${plan.sizePx}px`);
    else root.style.removeProperty('--joystick-size');
  }
}
