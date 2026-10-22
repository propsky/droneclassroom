// 實體搖桿（Web Gamepad API）— 輪詢 + 校正套用（Phase 2）。
// 標準 mapping 只是初始猜測：axes[0]=左X(yaw)、axes[1]=左Y(throttle)、axes[2]=右X(roll)、axes[3]=右Y(pitch)。
// 每軸讀值經 (raw - center) / range 正規化再套死區（center/range 來自校正精靈，預設 0/1）。
// 開發後門：?fakepad=1 注入假搖桿訊號（headless 驗收 / 沒實體搖桿時測校正精靈用）。
// 軸數以連線實際回報為準，不補 0、不截成 4，校正精靈才不會把「沒有的軸」看成停在中心的開關。
import { bus, toast } from '../core/events';
import { gamepadConfig } from './calibration';
import { normalizeGamepadAxis } from './padMath';

export const gamepadState = {
  connected: false,
  index: null as number | null,
  id: '',
  axes: [] as number[],
  buttons: [] as boolean[],
  prevButtons: [] as boolean[],
};

/** 瀏覽器一條連線實際會露出的軸上限；超出的不讀，缺少的不補。 */
const MAX_REPORTED_AXES = 16;

function reportedAxes(src: ArrayLike<number>): number[] {
  const n = Math.min(src.length, MAX_REPORTED_AXES);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const v = Number(src[i]);
    out.push(Number.isFinite(v) ? v : 0);
  }
  return out;
}

// =============================================================================
// ?fakepad=1 開發後門：假 gamepad 訊號源
// =============================================================================
interface FakePad {
  axes: number[];
  buttons: boolean[];
}
let fakepad: FakePad | null = null;

function setGamepadConnected(on: boolean, id = ''): void {
  gamepadState.connected = on;
  document.body.classList.toggle('gamepad-connected', on);
  bus.emit('pad-connection', { kind: 'gamepad', connected: on, label: id || gamepadState.id });
}

function disconnectGamepad(): void {
  gamepadState.index = null;
  gamepadState.id = '';
  gamepadState.axes = [];
  gamepadState.buttons = [];
  gamepadState.prevButtons = [];
  setGamepadConnected(false);
}

/** 校正精靈用的即時快照。fakepad 直接讀目前的陣列，不經過補 0。 */
export function readGamepadSnapshot(): { connected: boolean; axes: number[]; buttons: boolean[] } {
  if (fakepad) {
    return {
      connected: true,
      axes: reportedAxes(fakepad.axes),
      buttons: fakepad.buttons.slice(),
    };
  }
  if (!gamepadState.connected) return { connected: false, axes: [], buttons: [] };
  return {
    connected: true,
    axes: gamepadState.axes.slice(),
    buttons: gamepadState.buttons.slice(),
  };
}

function initFakepad(): void {
  if (!new URLSearchParams(location.search).has('fakepad')) return;
  fakepad = { axes: [0, 0, 0, 0], buttons: new Array<boolean>(17).fill(false) };
  (window as unknown as Record<string, unknown>)['__fakepad'] = fakepad;
  gamepadState.index = -1;
  gamepadState.id = 'Fake Gamepad (?fakepad=1)';
  gamepadState.axes = reportedAxes(fakepad.axes);
  gamepadState.buttons = fakepad.buttons.slice();
  gamepadState.prevButtons = fakepad.buttons.slice();
  setGamepadConnected(true, gamepadState.id);
  toast('🎮 假搖桿已連線（?fakepad=1 測試模式）', 'success');
}

function connect(gp: Gamepad): void {
  if (gamepadState.connected && gamepadState.index === gp.index) return;
  gamepadState.index = gp.index;
  gamepadState.id = gp.id;
  setGamepadConnected(true, gp.id);
  toast(`🎮 偵測到搖桿：${gp.id.substring(0, 40)}`, 'success');
  if (!gp.mapping) {
    setTimeout(
      () => toast('⚠ 非標準搖桿 — 點右上「搖桿」→ 開始校正精靈', 'warning'),
      2500,
    );
  }
}

export function initGamepad(): void {
  initFakepad();
  if (!('getGamepads' in navigator)) {
    console.warn('此瀏覽器不支援 Web Gamepad API');
    return;
  }
  window.addEventListener('gamepadconnected', (e) => connect(e.gamepad));
  window.addEventListener('gamepaddisconnected', (e) => {
    if (gamepadState.index === e.gamepad.index) {
      disconnectGamepad();
      toast('搖桿已斷線');
    }
  });
}

/** 每 tick 輪詢（Gamepad API 沒有 per-frame event） */
export function pollGamepad(): void {
  if (fakepad) {
    gamepadState.prevButtons = gamepadState.buttons;
    gamepadState.axes = reportedAxes(fakepad.axes);
    gamepadState.buttons = fakepad.buttons.slice();
    return;
  }
  if (!('getGamepads' in navigator)) return;
  const gamepads = navigator.getGamepads();
  if (!gamepadState.connected) {
    for (const g of gamepads) {
      if (g?.connected) {
        connect(g);
        break;
      }
    }
    if (!gamepadState.connected) return;
  }
  const gp = gamepadState.index !== null ? gamepads[gamepadState.index] : null;
  if (!gp || !gp.connected) {
    if (gamepadState.connected) {
      disconnectGamepad();
      toast('搖桿已斷線');
    }
    return;
  }
  gamepadState.prevButtons = gamepadState.buttons;
  gamepadState.axes = reportedAxes(gp.axes);
  gamepadState.buttons = gp.buttons.map((b) => b.pressed);
}

function axis(i: number): number {
  const raw = gamepadState.axes[i] ?? 0;
  const c = gamepadConfig.center[i] ?? 0;
  const r = gamepadConfig.range[i] || 1;
  return normalizeGamepadAxis(raw, c, r, gamepadConfig.deadzone);
}

export function gamepadAxes(): { throttle: number; yaw: number; pitch: number; roll: number } {
  if (!gamepadState.connected) return { throttle: 0, yaw: 0, pitch: 0, roll: 0 };
  let throttle = axis(gamepadConfig.axes.throttle);
  let pitch = axis(gamepadConfig.axes.pitch);
  let yaw = axis(gamepadConfig.axes.yaw);
  let roll = axis(gamepadConfig.axes.roll);
  if (gamepadConfig.invertThrottle) throttle = -throttle;
  if (gamepadConfig.invertPitch) pitch = -pitch;
  if (gamepadConfig.invertYaw) yaw = -yaw;
  if (gamepadConfig.invertRoll) roll = -roll;
  return { throttle, yaw, pitch, roll };
}

export function isButtonJustPressed(idx: number): boolean {
  return !!gamepadState.buttons[idx] && !gamepadState.prevButtons[idx];
}

export function supportsGamepadApi(): boolean {
  return fakepad !== null || 'getGamepads' in navigator;
}
