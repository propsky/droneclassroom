// 進球公告文案。學生端與老師端用同一份字，畫面各自畫。
import type { SoccerTeam } from './protocol';

export interface GoalAnnounceInput {
  team: SoccerTeam;
  byName: string;
  scores: Record<SoccerTeam, number>;
  own?: boolean;
  pk?: boolean;
}

export interface GoalAnnounceCopy {
  /** 小標：進球 / 點球 / 烏龍球 */
  kicker: string;
  /** 主標 */
  title: string;
  /** 得分者。沒有名字就空字串，畫面不畫這一行 */
  who: string;
  /** `紅 2 : 1 藍` */
  score: string;
  own: boolean;
}

export class GoalAnnounce {
  /** 公告停住的時間，之後才開始淡出 */
  static readonly HOLD_MS = 3000;
  /** 淡出時長，要跟畫面的 opacity transition 一致 */
  static readonly FADE_MS = 600;

  static scoreLine(scores: Record<SoccerTeam, number>): string {
    return `紅 ${scores.red} : ${scores.blue} 藍`;
  }

  static teamName(team: SoccerTeam): string {
    return team === 'red' ? '紅隊' : '藍隊';
  }

  static copy(input: GoalAnnounceInput): GoalAnnounceCopy {
    const score = GoalAnnounce.scoreLine(input.scores);
    const name = input.byName.trim();
    if (input.own) {
      return {
        kicker: '烏龍球',
        title: '這球不算',
        who: name ? `${name} 打進自己的球門，雙方都不得分` : '打進自己的球門，雙方都不得分',
        score,
        own: true,
      };
    }
    const team = GoalAnnounce.teamName(input.team);
    if (input.pk) {
      return { kicker: '點球', title: `${team}點球命中`, who: name, score, own: false };
    }
    return { kicker: '進球', title: `${team}進球`, who: name, score, own: false };
  }
}
