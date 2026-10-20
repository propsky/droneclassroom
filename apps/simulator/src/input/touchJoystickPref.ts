// 畫面上的虛擬搖桿要不要出現。
// 預設只看「主要指標是不是手指」。使用者在工具列按過「觸控搖桿」之後，以 localStorage 為準。

export interface MediaQueryListLike {
  matches: boolean;
}

/** matchMedia 可注入，單元測試不必起瀏覽器。 */
export interface PointerEnv {
  matchMedia(query: string): MediaQueryListLike;
}

export interface PrefStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * 虛擬搖桿的預設與手動覆蓋。
 *
 * 預設開：`matchMedia('(pointer: coarse)')`。手機、平板的主要指標是手指。
 * 預設關：桌機滑鼠／觸控板是 `(pointer: fine)`。
 *
 * 故意不用下面這幾個舊條件（桌機上會誤開，生產環境才會在滑鼠電腦看到兩根搖桿）：
 * - `'ontouchstart' in window`（部分桌機 Chrome 恆為 true）
 * - `navigator.maxTouchPoints > 0`（觸控螢幕筆電、或桌機驅動誤報）
 * - `(any-pointer: coarse)`（有觸控螢幕、但正在用滑鼠的筆電也會中）
 *
 * 這種裝置要搖桿時，用工具列「觸控搖桿」打開；選擇記在 localStorage，蓋過預設，也蓋過 `?joystick=1`。
 */
export class TouchJoystickPreference {
  static readonly STORAGE_KEY = 'creafly_touch_joysticks';

  /** 主要指標是粗指標（手指）才回 true。matchMedia 不可用時當桌機，不預設打開。 */
  static primaryPointerIsCoarse(env: PointerEnv | null | undefined): boolean {
    try {
      return !!env?.matchMedia('(pointer: coarse)').matches;
    } catch {
      return false;
    }
  }

  /**
   * 使用者明確選過才有值：true 顯示、false 隱藏。
   * 沒寫過、寫了別的字、或儲存讀不到，都是 null（沿用裝置預設或網址強制）。
   */
  static readOverride(store: PrefStore | null | undefined): boolean | null {
    if (!store) return null;
    try {
      const raw = store.getItem(TouchJoystickPreference.STORAGE_KEY);
      if (raw === '1') return true;
      if (raw === '0') return false;
      return null;
    } catch {
      return null;
    }
  }

  static writeOverride(store: PrefStore | null | undefined, visible: boolean): void {
    if (!store) return;
    try {
      store.setItem(TouchJoystickPreference.STORAGE_KEY, visible ? '1' : '0');
    } catch {
      /* 無痕模式這一場記不住，下次仍走裝置預設 */
    }
  }

  /**
   * 解析最終要不要顯示。
   * 1. 使用者明確選過 → 用那個值（蓋過預設，也蓋過網址）
   * 2. 否則 `?joystick=1` → 顯示（既有直式測試與教室投影）
   * 3. 否則看主要指標是不是 coarse
   */
  static resolve(override: boolean | null, coarsePointer: boolean, urlForced = false): boolean {
    if (override !== null) return override;
    if (urlForced) return true;
    return coarsePointer;
  }
}
