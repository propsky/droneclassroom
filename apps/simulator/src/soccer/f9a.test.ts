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
import { soccerBoundaryMarkSize } from './field';
import { formatSoccerMatchLine, type SoccerHudInput } from '../ui/soccerHud';

describe('預設場地', () => {
  it('預設是臺北賽制的 F9A-B 小場，不是 14 m 大場', () => {
    expect(DEFAULT_SOCCER_CLASS).toBe('F9A-B');
    expect(SOCCER_FIELD.halfX * 2).toBe(3);
    expect(SOCCER_FIELD.halfZ * 2).toBe(6);
    expect(SOCCER_FIELD.top).toBe(3);
    expect(SOCCER_FIELD.goalR).toBe(F9A_B.goalR);
    expect(SOCCER_FIELD.shieldR).toBe(F9A_B.shieldR);
    expect(SOCCER_BALL_R).toBeCloseTo(0.1);
    expect(SOCCER_START_DEPTH).toBe(1);
    expect(SOCCER_GOAL_INSET).toBe(1);
    expect(SOCCER_FIELD.goalZ).toBeCloseTo(2);
    expect(SOCCER_FIELD.startZ).toBeCloseTo(SOCCER_FIELD.halfZ - 0.5);
    expect(SOCCER_BALL_R).toBeLessThan(SOCCER_FIELD.goalR);
  });
});

describe('F9A-A 場地與圓環', () => {
  it('大場數字仍在，給進階 F9A 用', () => {
    expect(F9A_A.halfX * 2).toBe(7);
    expect(F9A_A.halfZ * 2).toBe(14);
    expect(F9A_A.top).toBe(5);
    expect(F9A_A.goalR).toBeCloseTo(0.3);
    expect(F9A_A.shieldR).toBeCloseTo(0.2);
  });

  it('內徑 60cm、管厚 20cm、外徑 100cm，圓心 3.30m、離底線 1.5m', () => {
    expect(soccerGoalInnerDiameter(F9A_A.goalR)).toBeCloseTo(0.6);
    expect(soccerGoalThickness(F9A_A.goalTube)).toBeCloseTo(0.2);
    expect(soccerGoalOuterDiameter(F9A_A.goalR, F9A_A.goalTube)).toBeCloseTo(1);
    expect(F9A_A.thicknessMax).toBeCloseTo(0.2);
    expect(F9A_A.innerBottom).toBeCloseTo(3);
    expect(F9A_A.goalY).toBeCloseTo(3.3);
    expect(F9A_A.goalInset).toBe(1.5);
    expect(F9A_A.halfZ - F9A_A.goalInset).toBeCloseTo(5.5);
    expect(soccerBoundaryMarkSize(F9A_A.halfX, F9A_A.halfZ)).toEqual({ width: 7, length: 14 });
    expect(soccerGoalTorusDiameter(F9A_A.goalR, F9A_A.goalTube)).toBeCloseTo(0.8);
    expect(soccerGoalTorusThickness(F9A_A.goalTube)).toBeCloseTo(0.2);
  });

  it('起飛區進深 1.5m，每隊最多 5 人', () => {
    expect(F9A_A.startDepth).toBe(1.5);
    expect(F9A_A.maxPlayers).toBe(5);
    expect(SOCCER_START_WIDTH).toBeCloseTo(SOCCER_BALL_R * 2);
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
    expect(F9A_B.startDepth).toBe(1);
    expect(F9A_B.maxPlayers).toBe(3);
    expect(F9A_B.halfZ - F9A_B.goalInset).toBeCloseTo(2);
    expect(soccerBoundaryMarkSize(F9A_B.halfX, F9A_B.halfZ)).toEqual({ width: 3, length: 6 });
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
    ...over,
  };
}

describe('F9A 階段一 HUD 賽制', () => {
  it('沒寫賽制是臺北；舊的 f9a 紀錄仍讀得出三局兩勝', () => {
    expect(formatSoccerMatchLine(hud())).toContain('臺北賽制');
    expect(formatSoccerMatchLine(hud())).not.toContain('三局兩勝');
    expect(formatSoccerMatchLine(hud({ ruleset: 'f9a' }))).toContain('三局兩勝');
    expect(formatSoccerMatchLine(hud({ ruleset: 'f9a' }))).toContain('我：藍隊・前鋒');
  });

  it('臺北賽制寫扣分與降落，不寫三局兩勝', () => {
    const line = formatSoccerMatchLine(
      hud({
        ruleset: 'taipei',
        status: 'running',
        scores: { blue: 1, red: 1 },
        deductions: { blue: 0, red: 1 },
        endTime: 120_000,
        now: 0,
      }),
    );
    expect(line).toContain('臺北賽制');
    expect(line).toContain('扣分 0:1');
    expect(line).not.toContain('三局兩勝');
    expect(formatSoccerMatchLine(hud({ ruleset: 'taipei', phase: 'landing', endTime: 10_000 }))).toContain(
      '降落倒數',
    );
  });

  it('舊的 f9a 紀錄仍顯示局數、休息、黃金進球與 PK', () => {
    const line = formatSoccerMatchLine(
      hud({
        ruleset: 'f9a',
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
    expect(line).toContain('全隊先退回半場');
    expect(
      formatSoccerMatchLine(hud({ ruleset: 'f9a', status: 'break', sets: { blue: 1, red: 0 }, endTime: 15_000 })),
    ).toContain('局間休息');
    expect(formatSoccerMatchLine(hud({ ruleset: 'f9a', status: 'golden', endTime: 180_000, now: 0 }))).toContain(
      '黃金進球',
    );
    const pk = formatSoccerMatchLine(
      hud({
        ruleset: 'f9a',
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

  it('非攻擊手的計分列不寫犯規', () => {
    const line = formatSoccerMatchLine(
      hud({ status: 'running', myStriker: false, endTime: 60_000 }),
    );
    expect(line).not.toContain('犯規');
    expect(line).toContain('・防守');
  });
});
