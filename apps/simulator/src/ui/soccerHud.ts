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
  setSoccerMatchTimer(on ? '等待開始' : '--');
  if (on) document.querySelectorAll('.level-btn').forEach((b) => b.classList.remove('active'));
}
