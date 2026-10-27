// 足球 HUD：右下兩顆進場按鈕（單人練習 / 多人對戰）＋
// 練習模式右上 HUD（目前分數）＋多人比分寫在左下 #level-timer（對齊 legacy）。
// 純 DOM；名字 / 狀態一律 textContent 寫入（不吃使用者輸入的 HTML）。
import {
  getSoccerFeel,
  setSoccerFeel,
  SOCCER_FEELS,
  type SoccerFeelId,
} from '../soccer/flightFeel';
import { SoccerFeelLayout } from './soccerFeelLayout';

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
  if (lt && !on) lt.textContent = '--';
  if (!on) practiceStatusCache = '';
  if (on) document.querySelectorAll('.level-btn').forEach((b) => b.classList.remove('active'));
}

let practiceStatusCache = '';

/** 練習分數（每 tick 呼叫，有變才寫 DOM）。右上與左下同一句。 */
export function setPracticeStatus(text: string): void {
  if (text === practiceStatusCache) return;
  practiceStatusCache = text;
  const el = $('soccer-status');
  if (el) el.textContent = text;
  const lt = $('level-timer');
  if (lt) lt.textContent = text;
}

// =============================================================================
// 多人對戰（比分 / 倒數 / 我的隊伍角色 → 左下 #level-timer，對齊 legacy）
// =============================================================================
let matchTimerCache = '';
let matchClock = false;

/** 對戰比分占用左下計時格時，關卡計時不要蓋掉 */
export function matchClockOwned(): boolean {
  return matchClock;
}

export function setSoccerMatchTimer(text: string): void {
  if (text === matchTimerCache) return;
  matchTimerCache = text;
  const el = $('level-timer');
  if (el) el.textContent = text;
}

export function showSoccerMatchHud(on: boolean): void {
  matchClock = on;
  $('soccer-mp-btn')?.classList.toggle('active', on);
  matchTimerCache = '';
  setSoccerMatchTimer(on ? '臺北賽制｜等待開始' : '--');
  if (on) document.querySelectorAll('.level-btn').forEach((b) => b.classList.remove('active'));
}

/** 左下比分列。純函式，方便測試賽制文案（不碰 DOM） */
export interface SoccerHudInput {
  status: string;
  mode: 'striker';
  scores: { blue: number; red: number };
  sets: { blue: number; red: number };
  period: number;
  endTime: number;
  now: number;
  myTeam: 'blue' | 'red' | null;
  myStriker: boolean;
  /** 自己這隊剛得分，還沒全員回己方半場 */
  needReturn: boolean;
  /** PK 這一記輪到自己主罰（可以不是開賽時的前鋒） */
  pkMine?: boolean;
  pkScores: { blue: number; red: number };
  pkTurn: 'blue' | 'red' | null;
  pkRound: number;
  card?: 'yellow' | 'red' | null;
  disabled?: boolean;
  feelLabel?: string;
  /** 沒帶 ruleset 的舊畫面當臺北。明確寫 f9a 的舊紀錄仍走下面的句子，避免讀取時崩潰。 */
  ruleset?: 'f9a' | 'taipei';
  phase?: string;
  deductions?: { blue: number; red: number };
}

function fmtClock(endTime: number, now: number): string {
  const rem = Math.max(0, Math.ceil((endTime - now) / 1000));
  return `${Math.floor(rem / 60)}:${String(rem % 60).padStart(2, '0')}`;
}

/** 多人足球 HUD 一行字：局數、本節比分、休息／黃金／PK、回半場 */
export function formatSoccerMatchLine(s: SoccerHudInput): string {
  const me = s.myTeam === 'red' ? '紅隊' : s.myTeam === 'blue' ? '藍隊' : '—';
  const role = s.mode === 'striker' ? (s.myStriker ? '・前鋒' : '・防守') : '';
  const who = `我：${me}${role}`;
  const back =
    s.mode === 'striker' &&
    s.needReturn &&
    (s.status === 'running' || s.status === 'golden')
      ? '｜全隊先退回半場'
      : '';
  const card =
    s.card === 'red'
      ? '｜紅牌・整場出場'
      : s.card === 'yellow'
        ? '｜黃牌・本局出場'
        : s.disabled
          ? '｜本局少一人'
          : '';
  const feel = s.feelLabel ? `｜手感${s.feelLabel}` : '';

  const sets = `局數 ${s.sets.blue}:${s.sets.red}`;
  if (s.ruleset !== 'f9a') {
    const d = s.deductions ?? { blue: 0, red: 0 };
    const net = `淨分 ${s.scores.blue - d.blue}:${s.scores.red - d.red}`;
    const ded = `扣分 ${d.blue}:${d.red}`;
    if (s.status === 'countdown') return `臺北賽制｜起槳｜3-2-1…｜${who}${feel}`;
    // 結束時伺服器的 phase 還停在 landing：要先看 done，否則一直顯示「降落倒數 0:00」
    if (s.status === 'done') return `結束｜${net}｜${ded}｜${who}`;
    if (s.phase === 'landing') {
      const t = s.endTime ? fmtClock(s.endTime, s.now) : '—';
      return `降落倒數｜${t}｜${ded}｜${who}`;
    }
    if (s.status === 'running') {
      const t = s.endTime ? fmtClock(s.endTime, s.now) : '—';
      return `臺北賽制｜藍 ${s.scores.blue} : ${s.scores.red} 紅｜${ded}｜${t}｜${who}${back}${card}${feel}`;
    }
    return `臺北賽制｜藍 ${s.scores.blue} : ${s.scores.red} 紅｜${ded}｜等待開始｜${who}${feel}`;
  }
  if (s.status === 'countdown') return `三局兩勝｜第${s.period || 1}局｜起槳｜3-2-1…｜${who}${feel}`;
  if (s.status === 'done') return `結束｜${sets}｜藍 ${s.scores.blue} : ${s.scores.red} 紅｜${who}`;
  if (s.status === 'break') {
    const t = s.endTime ? fmtClock(s.endTime, s.now) : '—';
    return `局間休息｜${sets}｜${t}｜${who}`;
  }
  if (s.status === 'golden') {
    const t = s.endTime ? fmtClock(s.endTime, s.now) : '—';
    return `黃金進球｜${sets}｜藍 ${s.scores.blue} : ${s.scores.red} 紅｜${t}｜${who}${back}${card}${feel}`;
  }
  if (s.status === 'pk') {
    const t = s.endTime ? fmtClock(s.endTime, s.now) : '—';
    const side = s.pkTurn === 'red' ? '紅方罰球' : '藍方罰球';
    const mine =
      s.pkTurn && s.pkTurn === s.myTeam && (s.pkMine ?? s.myStriker) ? '｜輪到你' : '';
    return `PK 第${s.pkRound || 1}輪｜${side}｜點球 ${s.pkScores.blue}:${s.pkScores.red}｜${t}｜${who}${mine}`;
  }
  if (s.status === 'running') {
    const t = s.endTime ? fmtClock(s.endTime, s.now) : '—';
    return `${sets}｜第${s.period || 1}局 藍 ${s.scores.blue} : ${s.scores.red} 紅｜${t}｜${who}${back}${card}${feel}`;
  }
  return `三局兩勝｜藍 ${s.scores.blue} : ${s.scores.red} 紅｜等待開始｜${who}${feel}`;
}

let feelWired = false;

/** 飛行手感。練習與對戰都顯示；沒有這列時不改 DOM。 */
export function showSoccerFeel(on: boolean): void {
  const bar = $('soccer-feel');
  if (!bar) return;
  bar.style.display = on ? 'block' : 'none';
  if (on) SoccerFeelLayout.apply(document);
  if (!feelWired) {
    feelWired = true;
    bar.querySelectorAll<HTMLButtonElement>('[data-feel]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset['feel'];
        if (id === 'beginner' || id === 'sim' || id === 'pro' || id === 'angle') setSoccerFeel(id);
        paintFeel();
      });
    });
  }
  paintFeel();
}

function paintFeel(): void {
  const current = getSoccerFeel();
  document.querySelectorAll<HTMLButtonElement>('#soccer-feel [data-feel]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset['feel'] === current);
  });
}

export function soccerFeelButtonLabel(id: SoccerFeelId): string {
  const p = SOCCER_FEELS[id];
  if (!p.altitudeHold) return p.label;
  return `${p.label} ${p.maxTiltDeg}°`;
}

// =============================================================================
// 攻擊手旗號＋比賽結束畫面（階段三視覺；不改計分列文案）
// =============================================================================
let flagCache = '\0';
let endCache = '';
let endDismissed = false;

/** 可得分 / 請返場。空字串收起 */
export function setSoccerFlag(text: '' | '可得分' | '請返場'): void {
  if (text === flagCache) return;
  flagCache = text;
  const el = $('soccer-flag');
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('is-return', text === '請返場');
  el.classList.toggle('is-ready', text === '可得分');
  el.hidden = text === '';
}

/** 比賽結束蓋板。show=false 時收起；選手按「繼續觀看」只藏這一輪 */
export function setSoccerEndScreen(view: { show: boolean; title: string; detail: string }): void {
  const key = view.show ? `${view.title}|${view.detail}` : '';
  if (!view.show) endDismissed = false;
  if (key === endCache) return;
  endCache = key;
  const el = $('soccer-end');
  if (!el) return;
  const title = $('soccer-end-title');
  const detail = $('soccer-end-detail');
  if (title) title.textContent = view.title;
  if (detail) detail.textContent = view.detail;
  el.hidden = !view.show || endDismissed;
  if (!endWired) {
    endWired = true;
    $('soccer-end-close')?.addEventListener('click', () => {
      endDismissed = true;
      const panel = $('soccer-end');
      if (panel) panel.hidden = true;
    });
  }
}

let endWired = false;
