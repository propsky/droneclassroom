// 搖桿校正精靈 overlay — 只負責渲染與按鈕接線；狀態機在 input/calibration.ts。
// 訂閱 bus 的 calib-* 事件：步驟標題/提示、進度點、倒數進度條（獨立 setInterval 驅動）、
// 即時軸值/按鍵、完成後的校正結果摘要。視覺對齊 legacy #calib-overlay。
import { bus } from '../core/events';
import {
  startCalibration,
  endCalibration,
  skipCalibStep,
  gamepadConfig,
} from '../input/calibration';

const $ = (id: string): HTMLElement | null => document.getElementById(id);

function renderProgress(stepIdx: number, total: number): void {
  const prog = $('calib-progress');
  if (!prog) return;
  prog.innerHTML = '';
  for (let i = 0; i < total; i++) {
    const dot = document.createElement('div');
    dot.className = 'calib-dot';
    if (i < stepIdx) dot.classList.add('active');
    if (i === stepIdx) dot.classList.add('current');
    prog.appendChild(dot);
  }
}

function renderResult(): void {
  const r = $('calib-result');
  if (!r) return;
  r.style.display = 'block';
  const c = gamepadConfig.center;
  const rng = gamepadConfig.range;
  const fmt = (i: number): string =>
    `center=${(c[i] ?? 0).toFixed(3)} / range=${(rng[i] ?? 1).toFixed(3)}`;
  r.innerHTML = `
    <b>校正結果：</b><br>
    • 死區：<b>${gamepadConfig.deadzone.toFixed(3)}</b><br>
    • 左 X (旋轉 yaw)：<b>axes[0]</b> — ${fmt(0)}<br>
    • 左 Y (升降 throttle)：<b>axes[1]</b> — ${fmt(1)}<br>
    • 右 X (橫移 roll)：<b>axes[2]</b> — ${fmt(2)}<br>
    • 右 Y (前後 pitch)：<b>axes[3]</b> — ${fmt(3)}<br>
    • 起飛鍵：<b>button ${gamepadConfig.buttonMap.takeoff}</b>
    降落：<b>${gamepadConfig.buttonMap.land}</b>
    重置：<b>${gamepadConfig.buttonMap.reset}</b>
  `;
}

export function initCalibrationOverlay(): void {
  // ---- 顯示 / 隱藏 ----
  bus.on('calib-show', ({ show }) => {
    $('calib-overlay')?.classList.toggle('show', show);
    if (show) {
      const result = $('calib-result');
      if (result) result.style.display = 'none';
      const save = $('calib-save');
      if (save) save.style.display = 'none';
      const timerWrap = $('calib-timer-wrap');
      if (timerWrap) timerWrap.style.display = 'block';
      const fill = $('calib-timer-fill');
      if (fill) fill.style.width = '0%';
    }
  });

  // ---- 步驟切換 ----
  bus.on('calib-step', ({ stepIdx, total, label, hint, hasTimer, durationMs, done }) => {
    const labelEl = $('calib-step-label');
    if (labelEl) labelEl.textContent = label;
    const hintEl = $('calib-hint');
    if (hintEl) hintEl.textContent = hint;
    renderProgress(stepIdx, total);
    // 軸步驟顯示 timer；按鍵步驟 / 完成畫面隱藏
    const timerWrap = $('calib-timer-wrap');
    if (timerWrap) timerWrap.style.display = hasTimer ? 'block' : 'none';
    const fill = $('calib-timer-fill');
    if (fill) fill.style.width = '0%';
    const txt = $('calib-timer-text');
    if (txt && durationMs) txt.textContent = `${Math.ceil(durationMs / 1000)}s`;
    if (done) {
      const save = $('calib-save');
      if (save) save.style.display = 'inline-block';
    }
  });

  // ---- 倒數進度條（獨立 setInterval 驅動，防 rAF 卡住） ----
  bus.on('calib-timer', ({ pct, remainSec }) => {
    const fill = $('calib-timer-fill');
    if (fill) fill.style.width = `${pct}%`;
    const txt = $('calib-timer-text');
    if (txt) txt.textContent = `${remainSec}s`;
  });

  // ---- 即時軸值 / 按鍵 ----
  bus.on('calib-live', ({ axes, buttons }) => {
    const cax = $('calib-axes');
    if (cax) {
      cax.textContent = `axes: ${axes.map((v) => v.toFixed(2).padStart(5)).join(' | ')}`;
    }
    const cbtns = $('calib-btns');
    if (cbtns) {
      const parts: string[] = [];
      for (let i = 0; i < Math.min(17, buttons.length); i++) {
        parts.push(`<span class="calib-btn ${buttons[i] ? 'on' : ''}">${i}</span>`);
      }
      cbtns.innerHTML = parts.join('');
    }
  });

  // ---- 儲存後顯示結果摘要 ----
  bus.on('calib-ended', ({ saved }) => {
    if (saved) renderResult();
  });

  // ---- 按鈕接線 ----
  $('calib-fab')?.addEventListener('click', () => startCalibration());
  $('calib-skip')?.addEventListener('click', () => skipCalibStep());
  $('calib-cancel')?.addEventListener('click', () => endCalibration(false));
  $('calib-save')?.addEventListener('click', () => endCalibration(true));

  // URL 自動啟動校正（教學 / headless 驗收用）
  if (new URLSearchParams(location.search).has('calib')) {
    setTimeout(() => startCalibration(), 1500);
  }
}
