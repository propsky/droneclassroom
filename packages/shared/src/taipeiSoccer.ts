// 臺北市 115 年度無人機足球（附件4）的結算文案與淨分。
// 伺服器算勝負；這裡只把已經算好的數字排成老師／學生看得到的句子。
import type { SoccerRuleset, SoccerTeam } from './protocol';

export interface SoccerResultInput {
  ruleset?: SoccerRuleset;
  winner: SoccerTeam | 'draw';
  goals: Record<SoccerTeam, number>;
  deductions?: Record<SoccerTeam, number>;
  firstGoal?: SoccerTeam | null;
  sets?: Record<SoccerTeam, number>;
  pkScores?: Record<SoccerTeam, number>;
  reason?: string;
}

const TEAM: Record<SoccerTeam, string> = { blue: '藍隊', red: '紅隊' };

export class TaipeiScore {
  static net(goals: number, deductions: number): number {
    return goals - deductions;
  }

  static winner(
    blueNet: number,
    redNet: number,
    firstGoal: SoccerTeam | null | undefined,
  ): SoccerTeam | 'draw' {
    if (blueNet > redNet) return 'blue';
    if (redNet > blueNet) return 'red';
    if (firstGoal === 'blue' || firstGoal === 'red') return firstGoal;
    return 'draw';
  }
}

export class SoccerPenaltyLabel {
  static text(reason: string | undefined): string {
    switch (reason) {
      case 'early_takeoff':
        return '提前升空';
      case 'own_goal_dwell':
        return '停留己方球門';
      case 'reverse_block':
        return '反向穿越己方球門';
      case 'late_landing':
        return '結束後未降落';
      case 'manual':
        return '裁判扣分';
      case 'conduct':
        return '行為';
      default:
        return reason || '警告';
    }
  }
}

/** 結算蓋板的句子。臺北賽制寫出扣分與先進球；F9A 維持局數／點球。 */
export class SoccerResultCopy {
  static kicker(input: SoccerResultInput): string {
    return input.ruleset === 'taipei' ? '臺北賽制' : 'F9A';
  }

  static title(input: SoccerResultInput): string {
    if (input.winner === 'blue') return '藍隊勝';
    if (input.winner === 'red') return '紅隊勝';
    return '平手';
  }

  static rows(input: SoccerResultInput): string[] {
    const g = input.goals;
    const lines = [`進球　藍 ${g.blue} : ${g.red} 紅`];
    if (input.ruleset === 'taipei') {
      const d = input.deductions ?? { blue: 0, red: 0 };
      const netB = TaipeiScore.net(g.blue, d.blue);
      const netR = TaipeiScore.net(g.red, d.red);
      lines.push(`扣分　藍 ${d.blue} : ${d.red} 紅`);
      lines.push(`淨分　藍 ${netB} : ${netR} 紅`);
      lines.push(
        input.firstGoal === 'blue' || input.firstGoal === 'red'
          ? `先進球　${TEAM[input.firstGoal]}`
          : '先進球　尚無',
      );
      if (netB === netR && (input.firstGoal === 'blue' || input.firstGoal === 'red')) {
        lines.push('同分，由先進第 1 球的隊伍獲勝');
      }
      return lines;
    }
    if (input.sets) lines.push(`局數　藍 ${input.sets.blue} : ${input.sets.red} 紅`);
    if (input.reason === 'pk' && input.pkScores) {
      lines.push(`點球　藍 ${input.pkScores.blue} : ${input.pkScores.red} 紅`);
    }
    return lines;
  }

  static detail(input: SoccerResultInput): string {
    if (input.ruleset === 'taipei') {
      return '單場決勝負。淨分高者勝；淨分相同則先進第 1 球的隊伍勝。不打 PK、不打黃金進球。';
    }
    return '三局兩勝。平手才進 PK 或黃金進球。';
  }
}
