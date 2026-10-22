// 直式手機的選單抽屜與活動關卡抽屜。
// 版面數字要與 style.css 直式媒體查詢一致（斷點、搖桿直徑、操控帶）。
// 橫式與桌機不進這個斷點，header／活動入口維持原樣。
import { SoccerFeelLayout } from './soccerFeelLayout';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SafeInsets {
  left: number;
  right: number;
  bottom: number;
}

interface MemoryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** 直式手機：漢堡選單 + 活動關卡抽屜（預設收合、記住開合）。 */
export class PortraitChrome {
  /** 與 style.css `@media` 同一條查詢。 */
  static readonly QUERY = '(orientation: portrait) and (max-width: 520px)';
  static readonly MAX_WIDTH_PX = 520;
  /** 直式搖桿圓盤。360 寬放得下左右各一顆，且不互壓。 */
  static readonly STICK_PX = 132;
  /** 對應 tokens --sp-3。 */
  static readonly SIDE_PAD_PX = 12;
  /** 對應 tokens --sp-5（圓盤底緣，再與 safe-area 取大）。 */
  static readonly BOTTOM_PAD_PX = 24;
  /** 圓盤上方標籤高度，對應 .joystick-label。 */
  static readonly LABEL_PX = 24;
  /** 操控帶與標籤之間的空隙，對應 --sp-2。 */
  static readonly BAND_GAP_PX = 8;
  /** 左右圓盤之間至少留的縫。 */
  static readonly STICK_SEPARATION_PX = 16;

  static readonly PHONE_CLASS = 'portrait-phone';
  static readonly MENU_CLASS = 'portrait-menu-open';
  static readonly ENTRY_CLASS = 'entry-open';
  static readonly STORAGE_KEY = 'creafly_portrait_entry_open';

  /** 直向且寬度落在手機範圍（390 / 360）。橫式、桌機、平板直式都不算。 */
  static isPortraitPhone(width: number, height: number): boolean {
    return width > 0 && height >= width && width <= PortraitChrome.MAX_WIDTH_PX;
  }

  /** 活動關卡預設收合；只有明確存過「開」才展開。 */
  static readEntryOpen(storage: MemoryStorage): boolean {
    try {
      return storage.getItem(PortraitChrome.STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  }

  static writeEntryOpen(storage: MemoryStorage, open: boolean): void {
    try {
      storage.setItem(PortraitChrome.STORAGE_KEY, open ? '1' : '0');
    } catch {
      /* 隱私模式：這一場記不住，下次仍預設收合 */
    }
  }

  static stickSizePx(width: number, safeLeft = 0, safeRight = 0): number {
    const left = Math.max(PortraitChrome.SIDE_PAD_PX, safeLeft);
    const right = Math.max(PortraitChrome.SIDE_PAD_PX, safeRight);
    const room = width - left - right - PortraitChrome.STICK_SEPARATION_PX;
    const fitted = Math.floor(room / 2);
    return Math.min(PortraitChrome.STICK_PX, Math.max(96, fitted));
  }

  /** 從視窗底緣算起、浮層不可進入的高度（含安全區、圓盤、標籤）。 */
  static controlBandPx(safeBottom: number, stickPx: number): number {
    const bottom = Math.max(PortraitChrome.BOTTOM_PAD_PX, safeBottom);
    return bottom + stickPx + PortraitChrome.LABEL_PX + PortraitChrome.BAND_GAP_PX;
  }

  static stickLayout(width: number, height: number, safe: SafeInsets): { size: number; left: Box; right: Box } {
    const size = PortraitChrome.stickSizePx(width, safe.left, safe.right);
    const bottom = Math.max(PortraitChrome.BOTTOM_PAD_PX, safe.bottom);
    const left = Math.max(PortraitChrome.SIDE_PAD_PX, safe.left);
    const right = Math.max(PortraitChrome.SIDE_PAD_PX, safe.right);
    const y = height - bottom - size;
    return {
      size,
      left: { x: left, y, w: size, h: size },
      right: { x: width - right - size, y, w: size, h: size },
    };
  }

  /** 圓盤內緣取樣（避開方框四角，那些點在圓形搖桿外面）。 */
  static circleSamples(box: Box, fraction = 0.35): Array<{ x: number; y: number }> {
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    const rad = (box.w / 2) * fraction;
    return [
      { x: cx, y: cy },
      { x: cx, y: cy - rad },
      { x: cx, y: cy + rad },
      { x: cx - rad, y: cy },
      { x: cx + rad, y: cy },
    ];
  }

  static contains(box: Box, point: { x: number; y: number }): boolean {
    return point.x >= box.x && point.x <= box.x + box.w && point.y >= box.y && point.y <= box.y + box.h;
  }

  static boxesOverlap(a: Box, b: Box): boolean {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  /** 點擊是否落在搖桿區（nipplejs 的圓盤節點也算）。 */
  static hitIsStick(stick: Element, hit: Element | null): boolean {
    return !!hit && (hit === stick || stick.contains(hit));
  }

  static init(doc: Document = document): void {
    const menuBtn = doc.getElementById('portrait-menu-btn');
    const entryBtn = doc.getElementById('entry-drawer-toggle');
    const tools = doc.getElementById('header-tools');
    const view = doc.defaultView;
    if (!menuBtn || !entryBtn || !tools || !view?.matchMedia) return;

    const mq = view.matchMedia(PortraitChrome.QUERY);
    let menuOpen = false;
    let entryOpen = PortraitChrome.readEntryOpen(view.localStorage);

    const render = (): void => {
      const portrait = mq.matches;
      if (!portrait) menuOpen = false;
      doc.body.classList.toggle(PortraitChrome.PHONE_CLASS, portrait);
      doc.body.classList.toggle(PortraitChrome.MENU_CLASS, portrait && menuOpen);
      doc.body.classList.toggle(PortraitChrome.ENTRY_CLASS, portrait && entryOpen);
      menuBtn.setAttribute('aria-expanded', String(portrait && menuOpen));
      entryBtn.setAttribute('aria-expanded', String(portrait && entryOpen));
      menuBtn.title = menuOpen ? '關閉選單' : '選單';
      entryBtn.title = entryOpen ? '收合活動關卡' : '活動關卡';
      SoccerFeelLayout.apply(doc);
    };

    menuBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      menuOpen = !menuOpen;
      render();
    });
    entryBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      entryOpen = !entryOpen;
      PortraitChrome.writeEntryOpen(view.localStorage, entryOpen);
      render();
    });
    doc.addEventListener('click', (event) => {
      if (!menuOpen) return;
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (menuBtn.contains(target) || tools.contains(target)) return;
      menuOpen = false;
      render();
    });
    mq.addEventListener('change', render);
    render();
  }
}
