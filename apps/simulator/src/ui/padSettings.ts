// 搖桿設定面板 + 連線提示 — 死區/反轉微調、校正精靈入口、各裝置連線引導。
import { bus, toast } from '../core/events';
import {
  gamepadConfig,
  saveGamepadConfig,
  resetGamepadConfig,
  startCalibration,
  calibration,
} from '../input/calibration';
import { gamepadState, supportsGamepadApi } from '../input/gamepad';
import { bleState, isBleSupported } from '../input/ble';
import { isTouchDevice } from '../input/joystick';

const $ = (id: string): HTMLElement | null => document.getElementById(id);

const HINT_LS = 'creafly_pad_hint_dismissed';

function syncStatus(): void {
  const el = $('pad-settings-status');
  if (!el) return;
  if (gamepadState.connected) {
    el.innerHTML = `<span class="pad-status-dot on"></span><span>已連線：<b>${escapeHtml(
      gamepadState.id.substring(0, 48),
    )}</b></span>`;
    return;
  }
  if (bleState.connected) {
    el.innerHTML = `<span class="pad-status-dot on"></span><span>BLE 已連線：<b>${escapeHtml(
      bleState.deviceName || 'pyController',
    )}</b></span>`;
    return;
  }
  el.innerHTML = `<span class="pad-status-dot"></span><span>尚未連線搖桿</span>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function syncTuningUi(): void {
  const dz = $('pad-dz') as HTMLInputElement | null;
  const dzVal = $('pad-dz-val');
  const invBtn = $('pad-inv-throttle');
  const gamepadOnly = $('pad-settings-gamepad-only');
  const bleNote = $('pad-settings-ble-note');

  if (dz) dz.value = String(gamepadConfig.deadzone);
  if (dzVal) dzVal.textContent = gamepadConfig.deadzone.toFixed(2);

  if (invBtn) {
    invBtn.textContent = `升降反轉：${gamepadConfig.invertThrottle ? '開' : '關'}`;
    invBtn.classList.toggle('on', gamepadConfig.invertThrottle);
  }

  const gp = gamepadState.connected;
  const ble = bleState.connected;
  if (gamepadOnly) gamepadOnly.style.display = gp ? 'block' : 'none';
  if (bleNote) bleNote.style.display = ble && !gp ? 'block' : 'none';
  const tuning = $('pad-settings-tuning');
  if (tuning) tuning.style.display = gp ? 'block' : 'none';
}

function openSettings(): void {
  syncStatus();
  syncTuningUi();
  $('pad-settings-overlay')?.classList.add('show');
}

function closeSettings(): void {
  $('pad-settings-overlay')?.classList.remove('show');
}

export function initPadSettings(): void {
  $('pad-settings-close')?.addEventListener('click', closeSettings);
  $('pad-settings-overlay')?.addEventListener('click', (e) => {
    if (e.target === $('pad-settings-overlay')) closeSettings();
  });

  $('pad-dz')?.addEventListener('input', (e) => {
    const v = parseFloat((e.target as HTMLInputElement).value);
    gamepadConfig.deadzone = v;
    saveGamepadConfig();
    const dzVal = $('pad-dz-val');
    if (dzVal) dzVal.textContent = v.toFixed(2);
  });

  $('pad-inv-throttle')?.addEventListener('click', () => {
    gamepadConfig.invertThrottle = !gamepadConfig.invertThrottle;
    saveGamepadConfig();
    syncTuningUi();
    toast(
      `升降反轉：${gamepadConfig.invertThrottle ? '開' : '關'} — 推桿向上現在${
        gamepadConfig.invertThrottle ? '下降' : '上升'
      }`,
      'success',
    );
  });

  $('pad-start-calib')?.addEventListener('click', () => {
    closeSettings();
    startCalibration();
  });

  $('pad-reset-all')?.addEventListener('click', () => {
    resetGamepadConfig();
    syncTuningUi();
    toast('已重置搖桿設定', 'success');
  });

  $('calib-fab')?.addEventListener('click', () => openSettings());

  bus.on('pad-connection', () => {
    syncStatus();
    syncTuningUi();
    updatePadHint();
  });
  bus.on('calib-ended', ({ saved }) => {
    if (saved) syncTuningUi();
  });
}

function hintMessage(): string {
  if (isTouchDevice && isBleSupported()) {
    return '接上搖桿後請按任意按鍵讓瀏覽器偵測；或使用上方「連線搖桿」配對 BLE 手把（iPad 請用 Bluefy）。';
  }
  if (isTouchDevice) {
    return '接上搖桿後請按任意按鍵，瀏覽器才會偵測到（iPad Safari 常需此步驟）。';
  }
  if (isBleSupported()) {
    return '接上 USB / 藍牙搖桿後請按任意按鍵；教室 BLE 手把請點上方「連線搖桿」。';
  }
  return '接上搖桿後請按任意按鍵讓瀏覽器偵測。';
}

function updatePadHint(): void {
  const hint = $('pad-hint');
  const text = $('pad-hint-text');
  if (!hint || !text) return;

  const connected = gamepadState.connected || bleState.connected;
  if (connected || calibration.active) {
    hint.classList.remove('show');
    return;
  }

  const dismissed = sessionStorage.getItem(HINT_LS) === '1';
  const canUsePad = supportsGamepadApi() || isBleSupported();
  if (!canUsePad || dismissed) {
    hint.classList.remove('show');
    return;
  }

  text.textContent = hintMessage();
  hint.classList.add('show');
}

export function initPadHint(): void {
  $('pad-hint-dismiss')?.addEventListener('click', () => {
    sessionStorage.setItem(HINT_LS, '1');
    $('pad-hint')?.classList.remove('show');
  });

  bus.on('pad-connection', updatePadHint);
  bus.on('calib-show', ({ show }) => {
    if (show) $('pad-hint')?.classList.remove('show');
    else updatePadHint();
  });

  setTimeout(updatePadHint, 1200);
}

export { openSettings };
