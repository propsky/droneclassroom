// 房間足球場地：老師選 F9A-A 或 F9A-B，或不釘選（跟伺服器 SOCCER_CLASS）。
// 正式環境部署沒有設 SOCCER_CLASS，程式預設 F9A-A。
import type { SoccerClassCode } from '@creafly/shared';

export class SoccerFieldChoice {
  static readonly DEFAULT: SoccerClassCode = 'F9A-A';

  static parse(raw: unknown): SoccerClassCode | null {
    return raw === 'F9A-A' || raw === 'F9A-B' ? raw : null;
  }

  /** 房間列表沒帶時當成 F9A-A（與伺服器預設、舊客戶端同一組）。 */
  static effective(raw: unknown): SoccerClassCode {
    return SoccerFieldChoice.parse(raw) ?? SoccerFieldChoice.DEFAULT;
  }

  static label(code: SoccerClassCode): string {
    return code === 'F9A-B'
      ? 'F9A-B（6×3×3 m，每隊最多 3 人）'
      : 'F9A-A（14×7×5 m，每隊最多 5 人）';
  }

  static shortLabel(code: SoccerClassCode): string {
    return code === 'F9A-B' ? 'F9A-B' : 'F9A-A';
  }

  /** 新增房間：空字串不送欄位，讓伺服器用 SOCCER_CLASS。 */
  static forCreate(value: string): { soccerClass?: SoccerClassCode } {
    const parsed = SoccerFieldChoice.parse(value);
    return parsed ? { soccerClass: parsed } : {};
  }

  /**
   * 房間設定要不要改場地。
   * 空字串且目前有釘選 → 送 server（改跟伺服器）。
   * 選了跟現況不同的代碼，或把「跟著伺服器」釘成明確的一組 → 送該代碼。
   */
  static forUpdate(
    value: string,
    current: { soccerClass?: string; soccerClassPinned?: boolean },
  ): { soccerClass?: SoccerClassCode | 'server' } {
    if (value === '') {
      return current.soccerClassPinned ? { soccerClass: 'server' } : {};
    }
    const parsed = SoccerFieldChoice.parse(value);
    if (!parsed) return {};
    if (!current.soccerClassPinned || parsed !== current.soccerClass) return { soccerClass: parsed };
    return {};
  }

  /** 設定選單的值：沒釘選是空字串（沿用伺服器預設）。 */
  static selectValue(pinned: boolean | undefined, code: unknown): string {
    if (!pinned) return '';
    return SoccerFieldChoice.effective(code);
  }
}
