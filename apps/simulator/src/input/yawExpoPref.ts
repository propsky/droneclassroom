// 偏航指數曲線的開關。0 = 線性（預設），與改動前的搖桿偏航同一條直線。
// 存在自己的 localStorage 鍵，不寫進校正精靈的 gamepadConfig。

export interface ExpoPrefStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export class YawExpoPreference {
  static readonly STORAGE_KEY = 'creafly_yaw_expo';
  static readonly MAX = 100;

  private static value = 0;

  /** 目前生效的 expo（0–100）。飛行迴圈每 tick 讀這個，不碰 storage。 */
  static get(): number {
    return YawExpoPreference.value;
  }

  /** 非有限、≤ 0 → 0；超過 100 → 100。小數四捨五入成 CLI 整數。 */
  static clamp(expo: number): number {
    if (!Number.isFinite(expo) || expo <= 0) return 0;
    const n = Math.round(expo);
    return n > YawExpoPreference.MAX ? YawExpoPreference.MAX : n;
  }

  /** 0 顯示「線性」，其餘顯示百分比。 */
  static label(expo: number): string {
    return expo > 0 ? String(expo) : '線性';
  }

  static read(store: ExpoPrefStore | null | undefined): number {
    if (!store) return 0;
    try {
      return YawExpoPreference.clamp(parseFloat(store.getItem(YawExpoPreference.STORAGE_KEY) ?? ''));
    } catch {
      return 0;
    }
  }

  static write(store: ExpoPrefStore | null | undefined, expo: number): void {
    if (!store) return;
    try {
      store.setItem(YawExpoPreference.STORAGE_KEY, String(YawExpoPreference.clamp(expo)));
    } catch {
      /* 無痕模式記不住，這一場仍用記憶體裡的值 */
    }
  }

  static apply(expo: number): void {
    YawExpoPreference.value = YawExpoPreference.clamp(expo);
  }

  static hydrate(store: ExpoPrefStore | null | undefined): void {
    YawExpoPreference.apply(YawExpoPreference.read(store));
  }

  static persist(store: ExpoPrefStore | null | undefined): void {
    YawExpoPreference.write(store, YawExpoPreference.get());
  }

  static browserStore(): ExpoPrefStore | null {
    try {
      if (typeof localStorage === 'undefined') return null;
      return localStorage;
    } catch {
      return null;
    }
  }
}
