// 老師後台的足球說明。比賽只有臺北賽制，場地固定 F9A-B。
export class SoccerRulesetForm {
  static fieldNote(): string {
    return '場地固定 F9A-B 小場（6×3×3 m，每隊 3 人）。不能改成大場。';
  }

  static hint(): string {
    return '臺北市115：單場決勝負，2 分鐘，固定 F9A-B 小場。淨分高者勝；同分則先進第 1 球的隊伍勝。提前升空、停留或反向穿越己方球門、結束後 10 秒內沒落地，各扣 1 分。';
  }
}
