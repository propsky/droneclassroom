import { describe, expect, it } from 'vitest';
import {
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

describe('F9A 階段一場地與圓環', () => {
  it('場地 14×7×5，長是寬的兩倍', () => {
    expect(SOCCER_FIELD.halfX * 2).toBe(7);
    expect(SOCCER_FIELD.halfZ * 2).toBe(14);
    expect(SOCCER_FIELD.halfZ).toBe(SOCCER_FIELD.halfX * 2);
    expect(SOCCER_FIELD.top).toBe(5);
  });

  it('圓環內徑 70cm、厚度 20cm、外徑 110cm，中心高 3.25m、離底線 2m', () => {
    expect(soccerGoalInnerDiameter()).toBeCloseTo(0.7);
    expect(soccerGoalThickness()).toBeCloseTo(0.2);
    expect(soccerGoalOuterDiameter()).toBeCloseTo(1.1);
    expect(SOCCER_FIELD.goalY).toBeCloseTo(3.25);
    expect(SOCCER_GOAL_INSET).toBe(2);
    expect(SOCCER_FIELD.goalZ).toBe(SOCCER_FIELD.halfZ - SOCCER_GOAL_INSET);
    // 環心直徑 = 內半徑 + 管半徑，洞才對得上穿環判定
    expect(soccerGoalTorusDiameter()).toBeCloseTo(0.9);
    expect(soccerGoalTorusThickness()).toBeCloseTo(0.2);
  });

  it('起飛區是底線中段約 1m 窄帶', () => {
    expect(SOCCER_START_WIDTH).toBe(1);
    expect(SOCCER_START_DEPTH).toBe(1);
    expect(SOCCER_FIELD.startZ).toBe(SOCCER_FIELD.halfZ - SOCCER_START_DEPTH / 2);
  });

  it('護罩小於內半徑，中心才穿得過 70cm 的洞', () => {
    expect(SOCCER_BALL_R).toBeLessThan(SOCCER_FIELD.goalR);
    expect(SOCCER_BALL_R * 2).toBeLessThan(soccerGoalInnerDiameter());
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
