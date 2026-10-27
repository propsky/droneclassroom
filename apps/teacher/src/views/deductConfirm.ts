// 足球扣分要按兩次才送出：扣分是永久的，沒有復原，按鈕又緊鄰「設為前鋒」。
// 足球名單每次位置廣播都會重畫，所以「待確認」狀態存在這裡，不能放在 DOM 上。

export const DEDUCT_CONFIRM_MS = 3000;

export class DeductConfirm {
  private readonly armedUntil = new Map<string, number>();

  constructor(
    private readonly windowMs: number = DEDUCT_CONFIRM_MS,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** 第一次按回 false（進入待確認）；時限內再按同一顆回 true，代表要送出。 */
  press(key: string): boolean {
    const t = this.now();
    const until = this.armedUntil.get(key);
    if (until !== undefined && until >= t) {
      this.armedUntil.delete(key);
      return true;
    }
    this.armedUntil.set(key, t + this.windowMs);
    return false;
  }

  isArmed(key: string): boolean {
    const until = this.armedUntil.get(key);
    return until !== undefined && until >= this.now();
  }

  /** 名單重畫時用的按鈕字 */
  label(key: string, idle: string): string {
    return this.isArmed(key) ? '確定扣 1 分？再按一次' : idle;
  }
}
