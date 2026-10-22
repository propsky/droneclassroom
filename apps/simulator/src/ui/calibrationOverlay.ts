// 搖桿校正精靈 overlay — 只渲染與接線。狀態機在 input/calibration.ts，透過 calib-view 訂閱。
import { bus } from '../core/events';
import {
  startCalibration,
  endCalibration,
  skipCalibStep,
  confirmCalibration,
  acceptCalibPartial,
  confirmCalibHandsOff,
  pickCalibAxis,
  pickCalibButton,
  listenAllCalib,
  type CalibView,
} from '../input/calibration';

const $ = (id: string): HTMLElement | null => document.getElementById(id);

function setHidden(id: string, hidden: boolean): void {
  const el = $(id);
  if (el) el.hidden = hidden;
}

function setText(id: string, text: string): void {
  const el = $(id);
  if (el) el.textContent = text;
}

function signed(n: number): string {
  const sign = n > 0 || Object.is(n, 0) ? '+' : '';
  return sign + n.toFixed(2);
}

let axisSig = '';
let btnSig = '';
let pickSig = '';
let diagramSig = '';
let progressSig = '';

function resetCaches(): void {
  axisSig = '';
  btnSig = '';
  pickSig = '';
  diagramSig = '';
  progressSig = '';
}

function renderDiagram(view: CalibView): void {
  if (view.diagram === diagramSig) return;
  diagramSig = view.diagram;
  const host = $('calib-diagram');
  if (!host) return;
  const stick = (side: 'left' | 'right', title: string, caption: string): string => {
    const on = view.diagram === side ? ' on' : '';
    return `<div class="calib-stick${on}"><b>${title}</b><i></i><small>${caption}</small></div>`;
  };
  host.innerHTML =
    '<div class="calib-sticks">' +
    stick('left', '左手', '油門 ↕　偏航 ↔') +
    stick('right', '右手', '俯仰 ↕　橫滾 ↔') +
    '</div>';
}

function renderProgress(view: CalibView): void {
  const sig = `${view.stepIdx}/${view.total}/${view.done}`;
  if (sig === progressSig) return;
  progressSig = sig;
  const prog = $('calib-progress');
  if (!prog) return;
  prog.replaceChildren();
  for (let i = 0; i < view.total; i++) {
    const dot = document.createElement('div');
    dot.className = 'calib-dot';
    if (i < view.stepIdx) dot.classList.add('active');
    if (i === view.stepIdx && !view.done) dot.classList.add('current');
    prog.appendChild(dot);
  }
}

function renderAxes(view: CalibView): void {
  const box = $('calib-axes');
  if (!box) return;
  const sig = view.axes.map((a) => a.index).join(',');
  if (sig !== axisSig) {
    axisSig = sig;
    box.replaceChildren();
    if (view.axes.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'calib-axis-row';
      empty.textContent = '這條連線沒有回報任何軸。';
      box.appendChild(empty);
    }
    for (const axis of view.axes) {
      const row = document.createElement('div');
      row.className = 'calib-axis-row';
      row.dataset.index = String(axis.index);
      box.appendChild(row);
    }
  }
  const rows = box.querySelectorAll<HTMLElement>('.calib-axis-row');
  view.axes.forEach((axis, i) => {
    const row = rows[view.axes.length === 0 ? i + 1 : i];
    if (!row) return;
    const raw = Number.isFinite(axis.raw) ? axis.raw.toFixed(2) : '—';
    row.textContent =
      `${axis.deviceLabel}　${axis.radioLabel}　值 ${raw}　差 ${signed(axis.delta)}　` +
      `行程 ${axis.span.toFixed(2)}　${axis.tag}`;
  });
}

function renderButtons(view: CalibView): void {
  const box = $('calib-btns');
  if (!box) return;
  const sig = view.buttons.map((b) => b.index).join(',');
  if (sig !== btnSig) {
    btnSig = sig;
    box.replaceChildren();
    for (const button of view.buttons) {
      const chip = document.createElement('span');
      chip.className = 'calib-btn';
      chip.dataset.index = String(button.index);
      chip.textContent = String(button.index);
      box.appendChild(chip);
    }
  }
  const chips = box.querySelectorAll<HTMLElement>('.calib-btn');
  view.buttons.forEach((button, i) => {
    const chip = chips[i];
    if (!chip) return;
    chip.classList.toggle('on', button.pressed);
    chip.classList.toggle('changed', button.changed);
    chip.title = button.changed ? '相對這一步的基線有變化' : '按鈕';
  });
}

function renderPicks(view: CalibView): void {
  const host = $('calib-picks');
  if (host) host.hidden = !view.showPicks;
  if (!view.showPicks) return;
  const focus = view.focus ? `${view.focus.kind}:${view.focus.index}` : '';
  const sig =
    view.axes.map((a) => a.index).join(',') +
    '|' +
    view.buttons.map((b) => b.index).join(',') +
    '|' +
    focus;
  if (sig === pickSig) return;
  pickSig = sig;
  const axesBox = $('calib-pick-axes');
  const btnBox = $('calib-pick-buttons');
  if (!axesBox || !btnBox) return;
  axesBox.replaceChildren();
  btnBox.replaceChildren();
  for (const axis of view.axes) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'calib-pick';
    if (view.focus?.kind === 'axis' && view.focus.index === axis.index) button.classList.add('on');
    button.textContent = axis.deviceLabel;
    button.addEventListener('click', () => pickCalibAxis(axis.index));
    axesBox.appendChild(button);
  }
  for (const padButton of view.buttons) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'calib-pick';
    if (view.focus?.kind === 'button' && view.focus.index === padButton.index) {
      button.classList.add('on');
    }
    button.textContent = `按鈕 ${padButton.index}`;
    button.addEventListener('click', () => pickCalibButton(padButton.index));
    btnBox.appendChild(button);
  }
}

function renderSummary(lines: string[]): void {
  const box = $('calib-result');
  if (!box) return;
  box.replaceChildren();
  for (const line of lines) {
    const row = document.createElement('div');
    row.textContent = line;
    box.appendChild(row);
  }
}

function render(view: CalibView): void {
  setText('calib-mode-note', view.modeNote);
  setText('calib-step-label', view.label);
  setText('calib-hint', view.hint);
  renderDiagram(view);
  renderProgress(view);

  const letGo = view.letGo;
  setHidden('calib-letgo', !letGo && !view.showHandsOff);
  if (view.showHandsOff || letGo) setHidden('calib-letgo', false);
  else setHidden('calib-letgo', true);
  if (letGo) {
    const fill = $('calib-timer-fill');
    if (fill) fill.style.width = `${letGo.pct}%`;
    setText('calib-timer-text', `放開倒數 ${letGo.remainSec} 秒（時間只推進這一頁）`);
  } else if (view.showHandsOff) {
    const fill = $('calib-timer-fill');
    if (fill) fill.style.width = '0%';
    setText('calib-timer-text', '先放開搖桿，再推這一步。時間到也會開始聽，但不會自己採納。');
  }

  setHidden('calib-seen', !view.showConfirm);
  setText('calib-seen-text', view.seenText ?? '');
  const also = $('calib-also-seen');
  if (also) {
    also.hidden = !view.alsoSeenText;
    also.textContent = view.alsoSeenText ?? '';
  }
  setText('calib-confirm', view.confirmLabel);

  const showNote = (id: string, text: string | null): void => {
    setHidden(id, !text);
    if (text) setText(id, text);
  };
  showNote('calib-idle', view.idleHint);
  showNote('calib-occupied', view.occupiedHint);
  showNote('calib-motion', view.motionHint);
  showNote('calib-extra', view.extraHint);
  showNote('calib-mismatch', view.mismatchHint);
  setHidden('calib-partial', !view.showUsePartial);
  showNote('calib-missing', view.missingAxesNote);
  setText('calib-hat', view.hatNote);

  renderAxes(view);
  renderButtons(view);
  renderPicks(view);

  setHidden('calib-result', !view.done);
  if (view.done) renderSummary(view.summaryLines);
  setHidden('calib-save', !view.done);
  setHidden('calib-skip', !view.showSkip);
  const inline = $('calib-skip-inline');
  if (inline) inline.hidden = !view.showConfirm;
  for (const id of ['calib-skip', 'calib-skip-inline']) {
    $(id)?.classList.toggle('prominent', view.skipProminent);
  }
}

export function initCalibrationOverlay(): void {
  bus.on('calib-show', ({ show }) => {
    $('calib-overlay')?.classList.toggle('show', show);
    if (show) resetCaches();
  });
  bus.on('calib-view', (view) => render(view));

  $('calib-skip')?.addEventListener('click', () => skipCalibStep());
  $('calib-skip-inline')?.addEventListener('click', () => skipCalibStep());
  $('calib-cancel')?.addEventListener('click', () => endCalibration(false));
  $('calib-save')?.addEventListener('click', () => endCalibration(true));
  $('calib-confirm')?.addEventListener('click', () => confirmCalibration());
  $('calib-partial')?.addEventListener('click', () => acceptCalibPartial());
  $('calib-hands-off')?.addEventListener('click', () => confirmCalibHandsOff());
  $('calib-listen-all')?.addEventListener('click', () => listenAllCalib());

  if (new URLSearchParams(location.search).has('calib')) {
    setTimeout(() => startCalibration(), 1500);
  }
}
