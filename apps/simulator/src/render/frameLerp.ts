// 跟拍鏡頭的平滑：原本每張畫面固定往目標靠一個比例（以 60fps 調的手感）。
// 畫面掉到 30fps 時每秒只靠一半次數，鏡頭就明顯拖在後面。
// 改成依經過的時間換算：60fps 時與原本完全相同，其他幀率每秒靠近的程度一樣。

export class FrameLerp {
  /** 原本手感調校時的畫面間隔 */
  static readonly REF_MS = 1000 / 60;
  /** 超過這麼久（切走分頁、卡頓）當成這麼久，回來時鏡頭不會瞬間跳到位 */
  static readonly MAX_MS = 100;

  /** 60fps 時每張畫面靠近 `perFrame60`，換算成經過 `dtMs` 時該靠近的比例。 */
  static alpha(perFrame60: number, dtMs: number): number {
    if (!(dtMs > 0)) return 0;
    const dt = Math.min(dtMs, FrameLerp.MAX_MS);
    return 1 - Math.pow(1 - perFrame60, dt / FrameLerp.REF_MS);
  }
}
