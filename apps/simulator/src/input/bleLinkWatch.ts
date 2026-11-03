// 藍牙搖桿斷訊保護。
// 藍牙收不到封包時，系統要等連線逾時（常常好幾秒）才會報斷線；這段期間 bleState.pad 停在最後一筆，
// 無人機會照最後的桿量一直飛。超過 STALE_MS 沒收到新封包就把四軸當 0。
//
// 只對「固定週期送」的搖桿啟用（pyController 每 50ms 送一筆，桿不動也照送）：
// 收過兩筆內容完全相同的連續封包才算週期送。只在有變化才送的搖桿永遠不啟用，
// 否則學生穩穩推著桿不動時會被誤判成斷訊。

export type BleLinkStatus = 'fresh' | 'stale' | 'went-stale';

export class BleLinkWatch {
  /** 約 10 筆沒到（50ms 一筆）才算斷訊：偶爾掉一兩筆不會誤判 */
  static readonly STALE_MS = 500;

  private last = -Infinity;
  private lastKey: string | null = null;
  private periodic = false;
  private stale = false;

  /** 收到一筆封包。`key` 是封包內容（比對是否與上一筆相同）。回傳 true = 剛從斷訊恢復。 */
  packet(now: number, key: string): boolean {
    if (key === this.lastKey) this.periodic = true;
    this.lastKey = key;
    this.last = now;
    const recovered = this.stale;
    this.stale = false;
    return recovered;
  }

  /** 每 tick 問一次：現在的桿量還能不能信。'went-stale' 只在剛斷的那一次回傳。 */
  check(now: number): BleLinkStatus {
    if (!this.periodic || now - this.last <= BleLinkWatch.STALE_MS) return 'fresh';
    if (this.stale) return 'stale';
    this.stale = true;
    return 'went-stale';
  }

  reset(): void {
    this.last = -Infinity;
    this.lastKey = null;
    this.periodic = false;
    this.stale = false;
  }
}
