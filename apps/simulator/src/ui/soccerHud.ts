// 足球 HUD：右下兩顆進場按鈕（單人練習 / 多人對戰）＋
// 練習模式右上 HUD（目前分數）＋多人比分寫在左下 #level-timer（對齊 legacy）。
// 純 DOM；名字 / 狀態一律 textContent 寫入（不吃使用者輸入的 HTML）。
import {
  getSoccerFeel,
  setSoccerFeel,
  soccerSpeedScale,
  SOCCER_FEELS,
  type SoccerFeelId,
} from '../soccer/flightFeel';
import { flags } from '../core/droneState';
import { bus } from '../core/events';
import type { FlightPhysics } from '@creafly/shared';
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
  endTime: number;
  now: number;
  myTeam: 'blue' | 'red' | null;
  myStriker: boolean;
  /** 自己這隊剛得分，還沒全員回己方半場 */
  needReturn: boolean;
  card?: 'yellow' | 'red' | null;
  disabled?: boolean;
  feelLabel?: string;
  phase?: string;
  deductions?: { blue: number; red: number };
}

function fmtClock(endTime: number, now: number): string {
  const rem = Math.max(0, Math.ceil((endTime - now) / 1000));
  return `${Math.floor(rem / 60)}:${String(rem % 60).padStart(2, '0')}`;
}

/** 多人足球 HUD 一行字：臺北賽制比分、扣分、倒數、回半場 */
export function formatSoccerMatchLine(s: SoccerHudInput): string {
  const me = s.myTeam === 'red' ? '紅隊' : s.myTeam === 'blue' ? '藍隊' : '—';
  const role = s.mode === 'striker' ? (s.myStriker ? '・前鋒' : '・防守') : '';
  const who = `我：${me}${role}`;
  const back = s.mode === 'striker' && s.needReturn && s.status === 'running' ? '｜全隊先退回半場' : '';
  const card =
    s.card === 'red'
      ? '｜紅牌・整場出場'
      : s.card === 'yellow'
        ? '｜黃牌・本局出場'
        : s.disabled
          ? '｜本局少一人'
          : '';
  const feel = s.feelLabel ? `｜手感${s.feelLabel}` : '';
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

let feelWired = false;

/** 飛行手感。練習與對戰都顯示；沒有這列時不改 DOM。 */
export function showSoccerFeel(on: boolean): void {
  const bar = $('soccer-feel');
  if (!bar) return;
  bar.style.display = on ? 'block' : 'none';
  if (on) SoccerFeelLayout.apply(document);
  if (!feelWired) {
    feelWired = true;
    bus.on('physics-changed', paintFeel);
    bus.on('soccer-field-changed', paintFeel);
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
  const note = $('soccer-feel-note');
  if (note) note.textContent = soccerFeelNote(current, flags.physics, soccerSpeedScale());
}

const mps = (v: number): string => `${v.toFixed(1)} m/s`;

/** 手感列底下的一行說明：這一檔多快、放開會怎樣（簡易 ↔ 真實物理差在這裡看得出來） */
export function soccerFeelNote(id: SoccerFeelId, physics: FlightPhysics, scale: number): string {
  const p = SOCCER_FEELS[id];
  const top = `最快 ${mps(p.topSpeed * scale)}`;
  if (physics === 'real') {
    const same = p.altitudeHold ? '' : '（真實物理本來就不定高，同模擬）';
    return `真實物理：油門＋重力，放開會滑行・${top}${same}`;
  }
  if (!p.altitudeHold) return `${top}・不定高，鬆開上升會往下掉`;
  return `${top}・升降 ${mps(p.climb * scale)}・放開就停`;
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
