// 足球 HUD：右下兩顆進場按鈕（單人練習 / 多人對戰）＋
// 練習模式右上 HUD（drill 清單 + 狀態列）＋多人比分寫在左下 #level-timer（對齊 legacy）。
// 純 DOM；名字 / 狀態一律 textContent 寫入（不吃使用者輸入的 HTML）。
import type { SoccerDrill } from '../soccer/practice';

const $ = (id: string): HTMLElement | null => document.getElementById(id);

/** 綁定右下角兩顆足球按鈕（各自進場 ↔ 離場切換） */
export function initSoccerHud(onTogglePractice: () => void, onToggleMatch: () => void): void {
  $('soccer-btn')?.addEventListener('click', onTogglePractice);
  $('soccer-mp-btn')?.addEventListener('click', onToggleMatch);
}

// =============================================================================
// 單人練習
// =============================================================================
export function showSoccerPracticeHud(on: boolean): void {
  const hud = $('soccer-hud');
  if (hud) hud.style.display = on ? 'block' : 'none';
  $('soccer-btn')?.classList.toggle('active', on);
  const lt = $('level-timer');
  if (lt) lt.textContent = on ? '足球練習' : '--';
  if (on) document.querySelectorAll('.level-btn').forEach((b) => b.classList.remove('active'));
}

/** 重繪 drill 按鈕清單（含最佳紀錄；完成後最佳紀錄更新要重繪） */
export function renderDrillButtons(
  drills: readonly SoccerDrill[],
  bestOf: (id: string) => number,
  onStart: (idx: number) => void,
): void {
  const holder = $('soccer-drills');
  if (!holder) return;
  holder.textContent = '';
  drills.forEach((d, i) => {
    const btn = document.createElement('button');
    btn.className = 'soccer-drill-btn';
    const best = bestOf(d.id);
    const bt =
      d.record && best
        ? (d.target ?? 0) >= 99
          ? ` · 最佳 ${best}`
          : ` · 最佳 ${best.toFixed(1)}s`
        : '';
    btn.textContent = `${d.id} ${d.name}${bt}`;
    btn.title = d.desc;
    btn.addEventListener('click', () => onStart(i));
    holder.appendChild(btn);
  });
}

let practiceStatusCache = '';

/** 練習狀態列（每 tick 呼叫，有變才寫 DOM） */
export function setPracticeStatus(text: string): void {
  if (text === practiceStatusCache) return;
  practiceStatusCache = text;
  const el = $('soccer-status');
  if (el) el.textContent = text;
}

// =============================================================================
// 多人對戰（比分 / 倒數 / 我的隊伍角色 → 左下 #level-timer，對齊 legacy）
// =============================================================================
let matchTimerCache = '';

export function setSoccerMatchTimer(text: string): void {
  if (text === matchTimerCache) return;
  matchTimerCache = text;
  const el = $('level-timer');
  if (el) el.textContent = text;
}

export function showSoccerMatchHud(on: boolean): void {
  $('soccer-mp-btn')?.classList.toggle('active', on);
  matchTimerCache = '';
  setSoccerMatchTimer(on ? '三局兩勝｜等待開始' : '--');
  if (on) document.querySelectorAll('.level-btn').forEach((b) => b.classList.remove('active'));
}

/** 左下比分列。純函式，方便測試賽制文案（不碰 DOM） */
export interface SoccerHudInput {
  status: string;
  mode: 'ball' | 'striker';
  scores: { blue: number; red: number };
  sets: { blue: number; red: number };
  period: number;
  endTime: number;
  now: number;
  myTeam: 'blue' | 'red' | null;
  myStriker: boolean;
  /** 自己是剛得分、還沒回己方半場的攻擊手 */
  needReturn: boolean;
  pkScores: { blue: number; red: number };
  pkTurn: 'blue' | 'red' | null;
  pkRound: number;
  foul: boolean;
}

function fmtClock(endTime: number, now: number): string {
  const rem = Math.max(0, Math.ceil((endTime - now) / 1000));
  return `${Math.floor(rem / 60)}:${String(rem % 60).padStart(2, '0')}`;
}

/** 多人足球 HUD 一行字：局數、本節比分、休息／黃金／PK、回半場與犯規 */
export function formatSoccerMatchLine(s: SoccerHudInput): string {
  const me = s.myTeam === 'red' ? '紅隊' : s.myTeam === 'blue' ? '藍隊' : '—';
  const role = s.mode === 'striker' ? (s.myStriker ? '・前鋒' : '・防守') : '';
  const who = `我：${me}${role}`;
  const back =
    s.mode === 'striker' &&
    s.myStriker &&
    s.needReturn &&
    (s.status === 'running' || s.status === 'golden')
      ? '｜先退回半場'
      : '';
  const foul = s.foul ? '｜犯規：進了自家圓環' : '';

  if (s.mode === 'ball') {
    let t = '等待開始';
    if (s.status === 'running' && s.endTime) t = fmtClock(s.endTime, s.now);
    else if (s.status === 'countdown') t = '3-2-1…';
    else if (s.status === 'done') t = '結束';
    return `藍 ${s.scores.blue} : ${s.scores.red} 紅｜${t}｜${who}`;
  }

  const sets = `局數 ${s.sets.blue}:${s.sets.red}`;
  if (s.status === 'countdown') return `三局兩勝｜第${s.period || 1}局｜3-2-1…｜${who}`;
  if (s.status === 'done') return `結束｜${sets}｜藍 ${s.scores.blue} : ${s.scores.red} 紅｜${who}`;
  if (s.status === 'break') {
    const t = s.endTime ? fmtClock(s.endTime, s.now) : '—';
    return `局間休息｜${sets}｜${t}｜${who}`;
  }
  if (s.status === 'golden') {
    const t = s.endTime ? fmtClock(s.endTime, s.now) : '—';
    return `黃金進球｜${sets}｜藍 ${s.scores.blue} : ${s.scores.red} 紅｜${t}｜${who}${back}${foul}`;
  }
  if (s.status === 'pk') {
    const t = s.endTime ? fmtClock(s.endTime, s.now) : '—';
    const side = s.pkTurn === 'red' ? '紅方罰球' : '藍方罰球';
    const mine = s.pkTurn && s.pkTurn === s.myTeam && s.myStriker ? '｜輪到你' : '';
    return `PK 第${s.pkRound || 1}輪｜${side}｜點球 ${s.pkScores.blue}:${s.pkScores.red}｜${t}｜${who}${mine}${foul}`;
  }
  if (s.status === 'running') {
    const t = s.endTime ? fmtClock(s.endTime, s.now) : '—';
    return `${sets}｜第${s.period || 1}局 藍 ${s.scores.blue} : ${s.scores.red} 紅｜${t}｜${who}${back}${foul}`;
  }
  return `三局兩勝｜藍 ${s.scores.blue} : ${s.scores.red} 紅｜等待開始｜${who}`;
}
