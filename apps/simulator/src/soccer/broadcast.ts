// 足球轉播視覺用的純資料：護罩隊色、七段計分（臺北賽制：進球、扣分、倒數）、攻擊手旗號、結束標題。
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

/** 剩餘秒數 → 兩位數分：秒 */
export function formatClock(sec: number): string {
  const s = Math.max(0, Math.min(99 * 60 + 59, Math.floor(sec)));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

export interface BroadcastInput {
  status: string;
  mode: 'striker';
  /** 進球（未扣分） */
  scores: { blue: number; red: number };
  deductions: { blue: number; red: number };
  /** 伺服器判的勝方；比賽中為 null */
  winner: 'blue' | 'red' | 'draw' | null;
  endTime: number;
  now: number;
  myTeam: 'blue' | 'red' | null;
  myStriker: boolean;
  needReturn: boolean;
}

export interface BroadcastView {
  /** 剩餘秒 */
  remainSec: number;
  blueDeductions: number;
  redDeductions: number;
  blueGoals: number;
  redGoals: number;
  /** 攻擊手旗號；空字串 = 不顯示 */
  flag: '' | '可得分' | '請返場';
  ended: boolean;
  /** 結束畫面大標題 */
  title: string;
  /** 結束畫面副標（淨分、進球、扣分） */
  detail: string;
}

/** 臺北賽制一場 2 分鐘（伺服器 taipei_rules.MATCH_SEC），等待開賽時計分板先顯示這個 */
const MATCH_SEC = 120;

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
  const timed = s.status === 'running' || s.status === 'countdown';
  const blueGoals = clampDigit(s.scores.blue);
  const redGoals = clampDigit(s.scores.red);
  const blueDeductions = clampDigit(s.deductions.blue, 9);
  const redDeductions = clampDigit(s.deductions.red, 9);
  const showFlag = s.mode === 'striker' && s.myStriker && s.status === 'running';
  const flag: BroadcastView['flag'] = !showFlag ? '' : s.needReturn ? '請返場' : '可得分';
  const ended = s.status === 'done';
  // 老師中途結束沒有勝方，只寫「比賽結束」
  const title =
    s.winner === 'blue' ? '藍隊獲勝' : s.winner === 'red' ? '紅隊獲勝' : s.winner === 'draw' ? '兩隊平手' : '比賽結束';
  const netB = s.scores.blue - s.deductions.blue;
  const netR = s.scores.red - s.deductions.red;
  const detail = `淨分 ${netB}:${netR}｜進球 ${blueGoals}:${redGoals}｜扣分 ${blueDeductions}:${redDeductions}`;
  return {
    remainSec: timed ? remainSec(s.endTime, s.now) : ended ? 0 : MATCH_SEC,
    blueDeductions,
    redDeductions,
    blueGoals,
    redGoals,
    flag,
    ended,
    title,
    detail,
  };
}

/** 單人自由練習的計分板：只顯示累計進球，不顯示返場旗號，也不結束練習。 */
export function readPracticeBroadcast(p: { goals: number; elapsedSec: number }): BroadcastView {
  const goals = clampDigit(p.goals);
  return {
    remainSec: Math.max(0, Math.floor(p.elapsedSec)),
    blueDeductions: 0,
    redDeductions: 0,
    blueGoals: goals,
    redGoals: 0,
    flag: '',
    ended: false,
    title: '',
    detail: `分數：${goals}`,
  };
}
