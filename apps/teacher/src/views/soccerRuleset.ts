// 老師後台的足球賽制選項。F9A 維持三局兩勝；臺北賽制是單場。
import type { SoccerRuleset } from '@creafly/shared';

export class SoccerRulesetForm {
  /** 沒寫、或寫了不認得的值，都是臺北賽制。進階 F9A 必須明確是 f9a。 */
  static parse(raw: unknown): SoccerRuleset {
    return raw === 'f9a' ? 'f9a' : 'taipei';
  }

  static locksField(ruleset: SoccerRuleset): boolean {
    return ruleset === 'taipei';
  }

  static fieldNote(ruleset: SoccerRuleset): string {
    if (SoccerRulesetForm.locksField(ruleset)) {
      return '臺北賽制固定使用 F9A-B 小場（6×3×3 m，每隊 3 人），不能改成大場。';
    }
    return '進階 F9A 可以選大場或小場。沒有釘選時用伺服器的 SOCCER_CLASS（正式環境未設定就是 F9A-A）。';
  }

  static hint(ruleset: SoccerRuleset): string {
    if (ruleset === 'taipei') {
      return '臺北市115（預設）：單場決勝負，預設 2 分鐘，固定 F9A-B 小場。淨分高者勝；同分則先進第 1 球的隊伍勝，不打 PK、不打黃金進球。提前升空、停留或反向穿越己方球門、結束後 10 秒內沒落地，各扣 1 分。';
    }
    return '進階 F9A：只有攻擊手穿對方圓環得分，得分後該隊還能飛的人要回己方半場。三局兩勝、局間休息；平手先 PK，再黃金進球。打進自己的門不算分。場地可以選大場或小場。';
  }

  /** 切到臺北賽制時，若還停在 F9A 的 3 分鐘，改成條文的 2 分鐘。其他時長不動。 */
  static durationOnChange(current: string, ruleset: SoccerRuleset): string {
    if (ruleset === 'taipei' && current === '180') return '120';
    return current;
  }
}
