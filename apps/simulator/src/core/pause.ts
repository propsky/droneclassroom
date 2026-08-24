// 暫停 / 繼續 — 單人關卡（手動與程式模式皆可）。
// 暫停中主迴圈不 tick：物理 / motion plan / 關卡判定全部凍結；
// 恢復時把暫停時長補回 levelState.startTime 與 programState.startTime，
// 計時（HUD、成績、cf_elapsed）都不把暫停時間算進去。
// 多人賽局（大亂鬥 / 足球）為伺服器權威時間，不可暫停 —— 由 UI 層把按鈕收起。
import { flags } from './droneState';
import { levelState } from './level';
import { bus, toast } from './events';

/** 目前是否可暫停：要有關卡、已按開始、且不在 3-2-1 倒數中
 *（未開始就暫停會讓 pausedAt 早於 startTime，恢復補償把計時推向未來） */
export function isPausable(): boolean {
  return levelState.current !== null && levelState.armed && !flags.countdownActive;
}

export function pauseGame(): void {
  if (flags.paused || !isPausable()) return;
  flags.paused = true;
  levelState.pausedAt = Date.now();
  bus.emit('level-paused', { paused: true });
  toast('⏸ 已暫停', 'warning');
}

export function resumeGame(): void {
  if (!flags.paused) return;
  const pausedMs = levelState.pausedAt ? Date.now() - levelState.pausedAt : 0;
  // 把暫停時長補回關卡計時基準（牆鐘語意）→ elapsed 不含暫停時間。
  // 程式計時（cf_elapsed）走模擬時間，暫停時 tick 不前進、自然凍結，不需補償。
  if (levelState.startTime) levelState.startTime += pausedMs;
  levelState.pausedAt = 0;
  flags.paused = false;
  bus.emit('level-paused', { paused: false });
  toast('▶ 繼續', 'success');
}

export function togglePause(): void {
  if (flags.paused) resumeGame();
  else pauseGame();
}
