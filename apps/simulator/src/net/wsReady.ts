// 等 WebSocket 連上（含 register 已送出）再做事，逾時就放棄。
// 重新整理時關卡資料（走快取）常比 WebSocket 先到：授權模式的第一關若立刻判「沒連線」就放棄，
// 學生會停在沒有關卡、沒有「開始」鈕的畫面（Safari／iPad 特別容易，見 e2e portrait-controls）。

export interface WsReadySource {
  connected(): boolean;
  /** 訂閱「已連線」，回傳取消訂閱 */
  onConnected(fn: () => void): () => void;
}

export class WsReady {
  /** 連上 → true；ms 內沒連上 → false */
  static wait(src: WsReadySource, ms: number): Promise<boolean> {
    if (src.connected()) return Promise.resolve(true);
    return new Promise((resolve) => {
      const off = src.onConnected(() => {
        clearTimeout(timer);
        off();
        resolve(true);
      });
      const timer = setTimeout(() => {
        off();
        resolve(false);
      }, ms);
    });
  }
}
