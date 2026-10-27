// 老師後台的足球說明。比賽只有臺北賽制，場地固定 F9A-B。
import type { SoccerRuleset } from '@creafly/shared';

export class SoccerRulesetForm {
  /** 沒寫、f9a、或寫了不認得的值，比賽都是臺北賽制。 */
  static parse(raw: unknown): SoccerRuleset {
    void raw;
    return 'taipei';
  }

  static locksField(_ruleset?: SoccerRuleset): boolean {
    return true;
  }

  static fieldNote(_ruleset?: SoccerRuleset): string {
    return '場地固定 F9A-B 小場（6×3×3 m，每隊 3 人）。不能改成大場。';
  }

  static hint(_ruleset?: SoccerRuleset): string {
    return '臺北市115：單場決勝負，2 分鐘，固定 F9A-B 小場。淨分高者勝；同分則先進第 1 球的隊伍勝。提前升空、停留或反向穿越己方球門、結束後 10 秒內沒落地，各扣 1 分。';
  }
}
