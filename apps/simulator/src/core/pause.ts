// 暫停 / 繼續 — 單人關卡（手動與程式模式皆可）。
// 暫停中主迴圈不 tick：物理 / motion plan / 關卡判定全部凍結；
// 恢復時把暫停時長補回 levelState.startTime 與 programState.startTime，
// 計時（HUD、成績、cf_elapsed）都不把暫停時間算進去。
// 多人賽局（大亂鬥 / 足球）為伺服器權威時間，不可暫停 —— 由 UI 層把按鈕收起。
import { flags } from './droneState';
import { levelState } from './level';
import { programState } from './program';
import { bus, toast } from './events';

/** 目前是否可暫停：要有關卡、且不在 3-2-1 倒數中 */
export function isPausable(): boolean {
  return levelState.current !== null && !flags.countdownActive;
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
  // 把暫停時長補回計時基準 → elapsed 不含暫停時間
  if (levelState.startTime) levelState.startTime += pausedMs;
  if (programState.running && programState.startTime) programState.startTime += pausedMs;
  levelState.pausedAt = 0;
  flags.paused = false;
  bus.emit('level-paused', { paused: false });
  toast('▶ 繼續', 'success');
}

export function togglePause(): void {
  if (flags.paused) resumeGame();
  else pauseGame();
}
