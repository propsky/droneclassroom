import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SOCCER_CLASS,
  F9A_A,
  F9A_B,
  SOCCER_BALL_R,
  SOCCER_FIELD,
  SOCCER_GOAL_INSET,
  SOCCER_START_DEPTH,
  SOCCER_START_WIDTH,
  soccerGoalInnerDiameter,
  soccerGoalOuterDiameter,
  soccerGoalThickness,
  soccerGoalTorusDiameter,
  soccerGoalTorusThickness,
} from './constants';
import { formatSoccerMatchLine, type SoccerHudInput } from '../ui/soccerHud';

describe('F9A-A 場地與圓環', () => {
  it('預設就是 F9A-A，場地 14×7×5', () => {
    expect(DEFAULT_SOCCER_CLASS).toBe('F9A-A');
    expect(SOCCER_FIELD.halfX * 2).toBe(7);
    expect(SOCCER_FIELD.halfZ * 2).toBe(14);
    expect(SOCCER_FIELD.halfZ).toBe(SOCCER_FIELD.halfX * 2);
    expect(SOCCER_FIELD.top).toBe(5);
    expect(SOCCER_FIELD.goalR).toBe(F9A_A.goalR);
    expect(SOCCER_FIELD.shieldR).toBe(F9A_A.shieldR);
  });

  it('內徑 60cm、管厚 20cm、外徑 100cm，圓心 3.30m、離底線 1.5m', () => {
    expect(soccerGoalInnerDiameter()).toBeCloseTo(0.6);
    expect(soccerGoalThickness()).toBeCloseTo(0.2);
    expect(soccerGoalOuterDiameter()).toBeCloseTo(1);
    expect(F9A_A.thicknessMax).toBeCloseTo(0.2);
    expect(F9A_A.innerBottom).toBeCloseTo(3);
    expect(SOCCER_FIELD.goalY).toBeCloseTo(3.3);
    expect(SOCCER_GOAL_INSET).toBe(1.5);
    expect(SOCCER_FIELD.goalZ).toBe(SOCCER_FIELD.halfZ - SOCCER_GOAL_INSET);
    expect(SOCCER_FIELD.goalZ).toBeCloseTo(5.5);
    // 環心直徑 = 內半徑 + 管半徑，洞才對得上穿環判定
    expect(soccerGoalTorusDiameter()).toBeCloseTo(0.8);
    expect(soccerGoalTorusThickness()).toBeCloseTo(0.2);
  });

  it('起飛區是底線中段約 1m 窄帶', () => {
    expect(SOCCER_START_WIDTH).toBe(1);
    expect(SOCCER_START_DEPTH).toBe(1);
    expect(SOCCER_FIELD.startZ).toBe(SOCCER_FIELD.halfZ - SOCCER_START_DEPTH / 2);
  });

  it('護罩直徑 40cm，小於內徑 60cm', () => {
    expect(SOCCER_BALL_R).toBeCloseTo(0.2);
    expect(SOCCER_BALL_R).toBeLessThan(SOCCER_FIELD.goalR);
    expect(SOCCER_BALL_R * 2).toBeLessThan(soccerGoalInnerDiameter());
  });
});

describe('F9A-B 預設', () => {
  it('場地 6×3×3、內半徑 0.20、外半徑 0.35、離底線 1m、內圈底 2m、護罩 0.10', () => {
    expect(F9A_B.halfZ * 2).toBe(6);
    expect(F9A_B.halfX * 2).toBe(3);
    expect(F9A_B.top).toBe(3);
    expect(F9A_B.goalR).toBeCloseTo(0.2);
    expect(F9A_B.outerR).toBeCloseTo(0.35);
    expect(F9A_B.thicknessMax).toBeCloseTo(0.1);
    // 視覺管徑填滿內緣到外緣，外徑才是 70cm
    expect(F9A_B.goalTube * 2).toBeCloseTo(0.15);
    expect(F9A_B.goalR + F9A_B.goalTube * 2).toBeCloseTo(F9A_B.outerR);
    expect(F9A_B.goalInset).toBe(1);
    expect(F9A_B.innerBottom).toBeCloseTo(2);
    expect(F9A_B.goalY).toBeCloseTo(2.2);
    expect(F9A_B.shieldR).toBeCloseTo(0.1);
    expect(F9A_B.halfZ - F9A_B.goalInset).toBeCloseTo(2);
  });
});

function hud(over: Partial<SoccerHudInput> = {}): SoccerHudInput {
  return {
    status: 'idle',
    mode: 'striker',
    scores: { blue: 0, red: 0 },
    sets: { blue: 0, red: 0 },
    period: 1,
    endTime: 0,
    now: 0,
    myTeam: 'blue',
    myStriker: true,
    needReturn: false,
    pkScores: { blue: 0, red: 0 },
    pkTurn: null,
    pkRound: 0,
    foul: false,
    ...over,
  };
}

describe('F9A 階段一 HUD 賽制', () => {
  it('等待開始寫三局兩勝', () => {
    expect(formatSoccerMatchLine(hud())).toContain('三局兩勝');
    expect(formatSoccerMatchLine(hud())).toContain('我：藍隊・前鋒');
  });

  it('進行中顯示局數、本節比分與回半場', () => {
    const line = formatSoccerMatchLine(
      hud({
        status: 'running',
        scores: { blue: 1, red: 0 },
        sets: { blue: 0, red: 0 },
        endTime: 90_000,
        now: 30_000,
        needReturn: true,
      }),
    );
    expect(line).toContain('局數 0:0');
    expect(line).toContain('第1局 藍 1 : 0 紅');
    expect(line).toContain('1:00');
    expect(line).toContain('先退回半場');
  });

  it('局間休息、黃金進球、PK 各有自己的一行', () => {
    expect(formatSoccerMatchLine(hud({ status: 'break', sets: { blue: 1, red: 0 }, endTime: 15_000 }))).toContain(
      '局間休息',
    );
    expect(
      formatSoccerMatchLine(hud({ status: 'golden', endTime: 180_000, now: 0 })),
    ).toContain('黃金進球');
    const pk = formatSoccerMatchLine(
      hud({
        status: 'pk',
        pkTurn: 'blue',
        pkRound: 2,
        pkScores: { blue: 1, red: 0 },
        endTime: 20_000,
      }),
    );
    expect(pk).toContain('PK 第2輪');
    expect(pk).toContain('藍方罰球');
    expect(pk).toContain('點球 1:0');
    expect(pk).toContain('輪到你');
  });

  it('非攻擊手進自家圓環只在字尾標犯規', () => {
    const line = formatSoccerMatchLine(
      hud({ status: 'running', myStriker: false, foul: true, endTime: 60_000 }),
    );
    expect(line).toContain('犯規：進了自家圓環');
    expect(line).toContain('・防守');
  });
});
