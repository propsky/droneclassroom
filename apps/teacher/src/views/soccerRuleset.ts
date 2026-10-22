// 老師後台的足球賽制選項。F9A 維持三局兩勝；臺北賽制是單場。
import type { SoccerRuleset } from '@creafly/shared';

export class SoccerRulesetForm {
  static parse(raw: unknown): SoccerRuleset {
    return raw === 'taipei' ? 'taipei' : 'f9a';
  }

  static hint(ruleset: SoccerRuleset): string {
    if (ruleset === 'taipei') {
      return '臺北市115：單場決勝負，預設 2 分鐘。淨分高者勝；同分則先進第 1 球的隊伍勝，不打 PK、不打黃金進球。提前升空、停留或反向穿越己方球門、結束後 10 秒內沒落地，各扣 1 分。建議場地用 F9A-B。';
    }
    return '前鋒穿門：只有攻擊手穿對方圓環得分，得分後該隊還能飛的人要回己方半場。三局兩勝、局間休息；平手先 PK，再黃金進球。打進自己的門不算分。';
  }

  /** 切到臺北賽制時，若還停在 F9A 的 3 分鐘，改成條文的 2 分鐘。其他時長不動。 */
  static durationOnChange(current: string, ruleset: SoccerRuleset): string {
    if (ruleset === 'taipei' && current === '180') return '120';
    return current;
  }
}
