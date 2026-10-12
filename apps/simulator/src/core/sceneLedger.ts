// 場景物件帳本。render 在建立／清除 mesh 時回報數量，
// 測試可断言退出場次後各桶歸零。不擁有 dispose（避免和 render 雙重釋放）。

export class SceneLedger {
  private static counts = new Map<string, number>();

  /** 設定某桶目前還活著的物件數。0 會把桶拿掉。 */
  static set(bucket: string, count: number): void {
    if (count <= 0) this.counts.delete(bucket);
    else this.counts.set(bucket, count);
  }

  static count(bucket: string): number {
    return this.counts.get(bucket) ?? 0;
  }

  static total(): number {
    let n = 0;
    for (const v of this.counts.values()) n += v;
    return n;
  }

  static snapshot(): Record<string, number> {
    return Object.fromEntries(this.counts);
  }
}
