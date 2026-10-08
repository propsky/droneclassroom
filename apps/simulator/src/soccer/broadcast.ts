// 足球轉播視覺用的純資料：護罩隊色、七段計分、攻擊手旗號、結束標題。
// 不碰物理、穿環、罰牌。渲染與 HUD 只讀這裡的結果。
import { soccerTeamColorHex } from './constants';

/** 紅隊攻擊手護罩：亮藍（對方隊色） */
export const GUARD_BRIGHT_BLUE = 0x2ea2ff;
/** 藍隊攻擊手護罩：亮紅（對方隊色） */
export const GUARD_BRIGHT_RED = 0xff2d3a;

/**
 * 護罩顏色。攻擊手用對方隊色，其餘用自己的隊色。
 * 沒分隊又是攻擊手（單人練習）→ 當成藍隊攻擊手，護罩亮紅。
 */
export function soccerGuardColor(team: 'blue' | 'red' | null, striker: boolean): number {
  if (striker) {
    if (team === 'red') return GUARD_BRIGHT_BLUE;
    return GUARD_BRIGHT_RED;
  }
  return soccerTeamColorHex(team);
}

/** 七段順序：a 上、b 右上、c 右下、d 下、e 左下、f 左上、g 中 */
export const SEVEN_SEG: Record<string, readonly number[]> = {
  '0': [1, 1, 1, 1, 1, 1, 0],
  '1': [0, 1, 1, 0, 0, 0, 0],
  '2': [1, 1, 0, 1, 1, 0, 1],
  '3': [1, 1, 1, 1, 0, 0, 1],
  '4': [0, 1, 1, 0, 0, 1, 1],
  '5': [1, 0, 1, 1, 0, 1, 1],
  '6': [1, 0, 1, 1, 1, 1, 1],
  '7': [1, 1, 1, 0, 0, 0, 0],
  '8': [1, 1, 1, 1, 1, 1, 1],
  '9': [1, 1, 1, 1, 0, 1, 1],
};

/** 這個字元亮幾段（測七段表用） */
export function sevenSegOnCount(ch: string): number {
  const row = SEVEN_SEG[ch];
  if (!row) return 0;
  return row.reduce((sum, on) => sum + on, 0);
}

/** 該局剩餘秒數 → 兩位數分：秒 */
export function formatClock(sec: number): string {
  const s = Math.max(0, Math.min(99 * 60 + 59, Math.floor(sec)));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

export interface BroadcastInput {
  status: string;
  mode: 'ball' | 'striker';
  scores: { blue: number; red: number };
  sets: { blue: number; red: number };
  period: number;
  endTime: number;
  now: number;
  myTeam: 'blue' | 'red' | null;
  myStriker: boolean;
  needReturn: boolean;
  pkScores?: { blue: number; red: number };
}

export interface BroadcastView {
  /** 第幾局（至少 1，等待開賽時先顯示第 1 局） */
  period: number;
  /** 該局剩餘秒 */
  remainSec: number;
  blueSets: number;
  redSets: number;
  blueGoals: number;
  redGoals: number;
  /** 攻擊手旗號；空字串 = 不顯示 */
  flag: '' | '可得分' | '請返場';
  ended: boolean;
  /** 結束畫面大標題 */
  title: string;
  /** 結束畫面副標（勝局與本局比分） */
  detail: string;
}

function clampDigit(n: number, max = 99): number {
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(max, Math.floor(n));
}

function remainSec(endTime: number, now: number): number {
  if (!endTime) return 0;
  return Math.max(0, Math.ceil((endTime - now) / 1000));
}

/** 由對戰狀態做出計分板與結束畫面要的數字（不改狀態本身） */
export function readBroadcast(s: BroadcastInput): BroadcastView {
  const timed =
    s.status === 'running' ||
    s.status === 'golden' ||
    s.status === 'break' ||
    s.status === 'penalty' ||
    s.status === 'pk' ||
    s.status === 'countdown';
  const pk = s.status === 'pk';
  const blueGoals = clampDigit(pk ? (s.pkScores?.blue ?? 0) : s.scores.blue);
  const redGoals = clampDigit(pk ? (s.pkScores?.red ?? 0) : s.scores.red);
  const blueSets = clampDigit(s.sets.blue, 9);
  const redSets = clampDigit(s.sets.red, 9);
  const showFlag =
    s.mode === 'striker' &&
    s.myStriker &&
    (s.status === 'running' || s.status === 'golden' || s.status === 'pk');
  const flag: BroadcastView['flag'] = !showFlag ? '' : s.needReturn ? '請返場' : '可得分';
  const ended = s.status === 'done';
  let title = '比賽結束';
  if (blueSets > redSets) title = '藍隊獲勝';
  else if (redSets > blueSets) title = '紅隊獲勝';
  else if (ended) title = '兩隊平手';
  const detail = `勝局 ${blueSets}:${redSets}｜本局 ${blueGoals}:${redGoals}`;
  return {
    period: Math.max(1, clampDigit(s.period, 9)),
    remainSec: timed ? remainSec(s.endTime, s.now) : s.status === 'done' ? 0 : 180,
    blueSets,
    redSets,
    blueGoals,
    redGoals,
    flag,
    ended,
    title,
    detail,
  };
}

/** 單人練習的計分板：沒有局數時用第 1 局、進球次數，並依來回練習決定旗號 */
export function readPracticeBroadcast(p: {
  running: boolean;
  goals: number;
  elapsedSec: number;
  needReturn: boolean;
  scoredDrill: boolean;
}): BroadcastView {
  const flag: BroadcastView['flag'] = !p.running || !p.scoredDrill ? '' : p.needReturn ? '請返場' : '可得分';
  return {
    period: 1,
    remainSec: Math.max(0, Math.floor(p.elapsedSec)),
    blueSets: 0,
    redSets: 0,
    blueGoals: clampDigit(p.goals),
    redGoals: 0,
    flag,
    ended: false,
    title: '練習結束',
    detail: `穿門 ${clampDigit(p.goals)} 次`,
  };
}
