// 搖桿選單導覽 — overlay 時接管飛行鍵，像主機遊戲：移動焦點、A 確認、B 返回。
// 飛行中：START 暫停、Y / SELECT 開關卡選單。校正精靈期間不介入（要量測按鍵）。
import { bus, sound } from '../core/events';
import { isPausable, togglePause } from '../core/pause';
import { calibration, gamepadConfig } from '../input/calibration';
import { bleState, bleUiButtons } from '../input/ble';
import { gamepadState, isButtonJustPressed } from '../input/gamepad';
import {
  coalesceNav,
  digitalFromDpad,
  digitalFromStick,
  moveGridIndex,
  shouldRepeatNav,
  type DigitalDir,
} from '../input/padUiIntent';
import { playUiNavSound } from './audio';

const $ = (id: string): HTMLElement | null => document.getElementById(id);

const GP_Y = 3;
const GP_SELECT = 8;
const GP_START = 9;
const GP_DPAD_UP = 12;
const GP_DPAD_DOWN = 13;
const GP_DPAD_LEFT = 14;
const GP_DPAD_RIGHT = 15;

const INITIAL_REPEAT = 18;
const REPEAT_EVERY = 6;

const ZERO_DIR: DigitalDir = { x: 0, y: 0 };

type SceneId =
  | 'none'
  | 'login'
  | 'guide'
  | 'intro'
  | 'complete'
  | 'pause'
  | 'levels'
  | 'hint'
  | 'settings'
  | 'invite'
  | 'hud';

interface Scene {
  id: SceneId;
  /** 攔截飛行（A/B 改為確認/返回） */
  capture: boolean;
  items: HTMLElement[];
  columns: number;
  hint: string;
  onCancel?: () => void;
}

let capturing = false;
let focusIndex = 0;
let sceneId: SceneId = 'none';
let prevDir: DigitalDir = ZERO_DIR;
let heldTicks = 0;
let hintEl: HTMLDivElement | null = null;
let lastHint = '';
let lastHintVisible = false;
let focusedEl: HTMLElement | null = null;

export function isPadUiCapturing(): boolean {
  return capturing;
}

function overlayShow(id: string): boolean {
  return !!$(id)?.classList.contains('show');
}

function actionable(el: HTMLElement): boolean {
  if ((el as HTMLButtonElement).disabled) return false;
  const s = getComputedStyle(el);
  if (s.display === 'none' || s.visibility === 'hidden') return false;
  return el.getClientRects().length > 0;
}

function qAll(sel: string, root: ParentNode = document): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(sel)].filter(actionable);
}

function resolveScene(): Scene {
  if (overlayShow('invite-modal')) {
    return {
      id: 'invite',
      capture: true,
      items: qAll('#invite-modal button'),
      columns: 1,
      hint: 'A 確認',
    };
  }
  if (overlayShow('login-modal')) {
    const account = $('login-pane-account') && !$('login-pane-account')!.hidden;
    const items = account
      ? [...qAll('#login-tabs .login-tab'), ...qAll('#acct-mode-switch, #acct-login-btn')]
      : qAll('#emoji-picker .emoji-btn');
    return {
      id: 'login',
      capture: true,
      items,
      columns: account ? 2 : 6,
      hint: account ? '↕ 選擇  ·  A 登入' : '選擇動物  ·  A 開始飛行',
    };
  }
  if ($('guide-root')) {
    return {
      id: 'guide',
      capture: true,
      items: qAll('#guide-root .guide-next, #guide-root .guide-skip').sort((a, b) =>
        a.classList.contains('guide-next') ? -1 : b.classList.contains('guide-next') ? 1 : 0,
      ),
      columns: 2,
      hint: 'A 下一步  ·  B 跳過',
      onCancel: () => $('guide-root')?.querySelector<HTMLButtonElement>('.guide-skip')?.click(),
    };
  }
  if (overlayShow('pad-settings-overlay')) {
    return {
      id: 'settings',
      capture: true,
      items: qAll('#pad-settings-overlay button'),
      columns: 1,
      hint: '↕ 選擇  ·  A 確認  ·  B 關閉',
      onCancel: () => $('pad-settings-close')?.click(),
    };
  }
  if (overlayShow('level-complete')) {
    return {
      id: 'complete',
      capture: true,
      items: qAll('#level-complete button'),
      columns: 1,
      hint: '↕ 選擇  ·  A 確認  ·  B 留在本關',
      onCancel: () => $('level-complete-stay')?.click(),
    };
  }
  if (overlayShow('pause-overlay')) {
    return {
      id: 'pause',
      capture: true,
      items: qAll('#pause-overlay button'),
      columns: 1,
      hint: 'A 繼續  ·  ↕ 選擇',
      onCancel: () => $('pause-resume')?.click(),
    };
  }
  if (overlayShow('level-intro')) {
    return {
      id: 'intro',
      capture: true,
      items: qAll('#level-intro-start'),
      columns: 1,
      hint: 'A 開始',
    };
  }
  if ($('pad-hint')?.classList.contains('show')) {
    return {
      id: 'hint',
      capture: true,
      items: qAll('#pad-hint-dismiss'),
      columns: 1,
      hint: 'A 知道了',
      onCancel: () => $('pad-hint-dismiss')?.click(),
    };
  }
  if ($('level-selector')?.classList.contains('open')) {
    return {
      id: 'levels',
      capture: true,
      items: qAll('#level-selector-btns .level-btn:not(.entitlement-locked)'),
      columns: 1,
      hint: '↕ 選關  ·  A 進入  ·  B 關閉',
      onCancel: closeLevelMenu,
    };
  }
  return {
    id: 'hud',
    capture: false,
    items: [],
    columns: 1,
    hint: 'START 暫停  ·  Y 關卡選單',
  };
}

function padConnected(): boolean {
  return gamepadState.connected || bleState.connected;
}

function readNav(): DigitalDir {
  const gpDown = (i: number): boolean => !!gamepadState.buttons[i];
  if (gamepadState.connected) {
    const left = digitalFromStick(gamepadState.axes[0] ?? 0, -(gamepadState.axes[1] ?? 0));
    const right = digitalFromStick(gamepadState.axes[2] ?? 0, -(gamepadState.axes[3] ?? 0));
    const dpad = digitalFromDpad({
      up: gpDown(GP_DPAD_UP),
      down: gpDown(GP_DPAD_DOWN),
      left: gpDown(GP_DPAD_LEFT),
      right: gpDown(GP_DPAD_RIGHT),
    });
    return coalesceNav(dpad, left, right);
  }
  const ble = bleUiButtons();
  if (!ble) return ZERO_DIR;
  return coalesceNav(
    digitalFromDpad(ble.dpad),
    digitalFromStick(ble.stickX, ble.stickY),
    digitalFromStick(ble.lookX, ble.lookY),
  );
}

function readActions(): { confirm: boolean; cancel: boolean; pause: boolean; menu: boolean } {
  if (gamepadState.connected) {
    return {
      confirm: isButtonJustPressed(gamepadConfig.buttonMap.takeoff),
      cancel: isButtonJustPressed(gamepadConfig.buttonMap.land),
      pause: isButtonJustPressed(GP_START),
      menu: isButtonJustPressed(GP_Y) || isButtonJustPressed(GP_SELECT),
    };
  }
  const ble = bleUiButtons();
  if (!ble) return { confirm: false, cancel: false, pause: false, menu: false };
  return {
    confirm: ble.confirm,
    cancel: ble.cancel,
    pause: ble.pause,
    menu: ble.menu,
  };
}

function clearFocus(): void {
  document.querySelectorAll('.pad-focus').forEach((el) => {
    el.classList.remove('pad-focus', 'pad-focus-pulse');
  });
  focusedEl = null;
}

function applyFocus(el: HTMLElement, pulse: boolean): void {
  if (focusedEl === el && el.classList.contains('pad-focus')) {
    if (!pulse) return;
  } else {
    clearFocus();
    el.classList.add('pad-focus');
    focusedEl = el;
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  if (pulse) {
    el.classList.remove('pad-focus-pulse');
    void el.offsetWidth;
    el.classList.add('pad-focus-pulse');
  }
}

function pulseConfirm(el: HTMLElement): void {
  el.classList.add('pad-confirm');
  window.setTimeout(() => el.classList.remove('pad-confirm'), 160);
  try {
    navigator.vibrate?.(12);
  } catch {
    /* ignore */
  }
  sound('beep');
}

function setHint(text: string, visible: boolean, hud: boolean): void {
  if (!hintEl) return;
  hintEl.classList.toggle('hud', hud);
  if (text === lastHint && visible === lastHintVisible) return;
  lastHint = text;
  lastHintVisible = visible;
  hintEl.innerHTML = text
    .split('·')
    .map((part) => {
      const t = part.trim();
      const sp = t.indexOf(' ');
      if (sp < 0) return `<span class="pad-ui-chip">${escapeHtml(t)}</span>`;
      return `<span class="pad-ui-chip"><kbd>${escapeHtml(t.slice(0, sp))}</kbd>${escapeHtml(t.slice(sp))}</span>`;
    })
    .join('');
  hintEl.classList.toggle('show', visible);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function preferredIndex(scene: Scene): number {
  if (scene.id === 'levels') {
    const i = scene.items.findIndex((el) => el.classList.contains('active'));
    return i >= 0 ? i : 0;
  }
  if (scene.id === 'login') {
    const selected = scene.items.findIndex((el) => el.classList.contains('selected'));
    if (selected >= 0) return selected;
    const start = scene.items.findIndex((el) => el.id === 'login-start' || el.id === 'acct-login-btn');
    return start >= 0 ? start : 0;
  }
  if (scene.id === 'guide') {
    const i = scene.items.findIndex((el) => el.classList.contains('guide-next'));
    return i >= 0 ? i : 0;
  }
  if (scene.id === 'settings') {
    const i = scene.items.findIndex((el) => el.id === 'pad-settings-close');
    return i >= 0 ? i : Math.max(0, scene.items.length - 1);
  }
  return 0;
}

function clickItem(el: HTMLElement): void {
  pulseConfirm(el);
  el.click();
}

function closeLevelMenu(): void {
  $('level-selector')?.classList.remove('open');
}

function openLevelMenu(): void {
  const sel = $('level-selector');
  if (!sel || sel.classList.contains('locked')) {
    bus.emit('toast', { text: '🔒 老師已鎖定關卡，無法自行切換', kind: 'warning' });
    return;
  }
  sel.classList.add('open');
  sound('beep');
}

function confirmLogin(el: HTMLElement): void {
  if (el.classList.contains('emoji-btn')) {
    if (!el.classList.contains('selected')) el.click();
    const start = $('login-start');
    if (start) clickItem(start);
    else clickItem(el);
    return;
  }
  clickItem(el);
}

function maybeSelectEmoji(el: HTMLElement): void {
  if (!el.classList.contains('emoji-btn') || el.classList.contains('selected')) return;
  el.click();
}

function navFeedback(): void {
  playUiNavSound();
  try {
    navigator.vibrate?.(8);
  } catch {
    /* ignore */
  }
}

function resetPadUi(): void {
  capturing = false;
  sceneId = 'none';
  clearFocus();
  setHint('', false, false);
  prevDir = ZERO_DIR;
  heldTicks = 0;
}

/** 每物理 tick：在 pollGamepad 之後呼叫 */
export function tickPadUi(): void {
  if (calibration.active || !padConnected()) {
    if (sceneId !== 'none' || lastHintVisible) resetPadUi();
    return;
  }

  const scene = resolveScene();
  capturing = scene.capture;
  const sceneChanged = scene.id !== sceneId;
  if (sceneChanged) {
    sceneId = scene.id;
    focusIndex = preferredIndex(scene);
    prevDir = ZERO_DIR;
    heldTicks = 0;
  }
  if (scene.items.length > 0 && focusIndex >= scene.items.length) {
    focusIndex = preferredIndex(scene);
  }

  setHint(scene.hint, true, scene.id === 'hud');

  const dir = readNav();
  const rep = shouldRepeatNav(prevDir, dir, heldTicks, INITIAL_REPEAT, REPEAT_EVERY);
  prevDir = dir;
  heldTicks = rep.heldTicks;
  let moved = false;
  if (rep.fire && scene.items.length > 0) {
    const next = moveGridIndex(focusIndex, dir.x, dir.y, scene.items.length, scene.columns);
    if (next !== focusIndex) {
      focusIndex = next;
      moved = true;
    }
  }

  const target = scene.items[focusIndex];
  if (target) {
    const stale = focusedEl !== target || !target.classList.contains('pad-focus');
    if (sceneChanged || moved || stale) {
      applyFocus(target, sceneChanged || moved);
      if (moved) {
        navFeedback();
        if (scene.id === 'login') maybeSelectEmoji(target);
      }
    }
  } else if (focusedEl) {
    clearFocus();
  }

  const act = readActions();
  if (act.confirm && target) {
    if (scene.id === 'login') confirmLogin(target);
    else clickItem(target);
    return;
  }
  if (act.cancel && scene.onCancel) {
    scene.onCancel();
    return;
  }
  if (act.pause) {
    if (scene.id === 'hud') {
      if (!isPausable()) return;
      togglePause();
      return;
    }
    if (scene.id === 'pause') {
      $('pause-resume')?.click();
      return;
    }
    scene.onCancel?.();
    return;
  }
  if (act.menu) {
    if (scene.id === 'hud') openLevelMenu();
    else if (scene.id === 'levels') closeLevelMenu();
  }
}

export function initPadUi(): void {
  hintEl = document.createElement('div');
  hintEl.id = 'pad-ui-hint';
  hintEl.setAttribute('role', 'status');
  hintEl.setAttribute('aria-live', 'polite');
  document.body.appendChild(hintEl);
  bus.on('pad-connection', () => {
    if (!padConnected()) resetPadUi();
  });
}
