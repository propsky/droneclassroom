// 實體搖桿（Web Gamepad API）— 輪詢 + 校正套用（Phase 2）。
// 標準 mapping：axes[0]=左X(yaw)、axes[1]=左Y(throttle)、axes[2]=右X(roll)、axes[3]=右Y(pitch)
// 每軸讀值經 (raw - center) / range 正規化再套死區（center/range 來自校正精靈，預設 0/1）。
// 開發後門：?fakepad=1 注入假搖桿訊號（headless 驗收 / 沒實體搖桿時測校正精靈用）。
import { toast } from '../core/events';
import { gamepadConfig } from './calibration';

export const gamepadState = {
  connected: false,
  index: null as number | null,
  id: '',
  axes: [0, 0, 0, 0] as number[],
  buttons: [] as boolean[],
  prevButtons: [] as boolean[],
};

// =============================================================================
// ?fakepad=1 開發後門：假 gamepad 訊號源
//   - 預設輸出全 0（軸置中、按鍵放開），CDP / console 可寫 window.__fakepad 控制：
//     __fakepad.axes = [0.1, -0.2, 0, 0]; __fakepad.buttons[3] = true;
//   - 校正精靈 headless 驗收靠這個推進狀態機。
// =============================================================================
interface FakePad {
  axes: number[];
  buttons: boolean[];
}
let fakepad: FakePad | null = null;

function initFakepad(): void {
  if (!new URLSearchParams(location.search).has('fakepad')) return;
  fakepad = { axes: [0, 0, 0, 0], buttons: new Array<boolean>(17).fill(false) };
  (window as unknown as Record<string, unknown>)['__fakepad'] = fakepad;
  gamepadState.connected = true;
  gamepadState.index = -1;
  gamepadState.id = 'Fake Gamepad (?fakepad=1)';
  gamepadState.buttons = fakepad.buttons.slice();
  gamepadState.prevButtons = fakepad.buttons.slice();
  document.body.classList.add('gamepad-connected');
  toast('🎮 假搖桿已連線（?fakepad=1 測試模式）', 'success');
}

function connect(gp: Gamepad): void {
  if (gamepadState.connected) return;
  gamepadState.connected = true;
  gamepadState.index = gp.index;
  gamepadState.id = gp.id;
  document.body.classList.add('gamepad-connected');
  toast(`🎮 偵測到搖桿：${gp.id.substring(0, 40)}`, 'success');
  // 非標準 mapping：提示用校正精靈做一次對映
  if (!gp.mapping) {
    setTimeout(() => toast('⚠ 非標準搖桿 — 按右上「⚙ 校正」做一次對映即可', 'warning'), 2500);
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
      gamepadState.connected = false;
      gamepadState.index = null;
      gamepadState.axes = [0, 0, 0, 0];
      gamepadState.buttons = [];
      gamepadState.prevButtons = [];
      document.body.classList.remove('gamepad-connected');
      toast('搖桿已斷線');
    }
  });
}

/** 每 tick 輪詢（Gamepad API 沒有 per-frame event） */
export function pollGamepad(): void {
  // 假搖桿：直接取 __fakepad 的值
  if (fakepad) {
    gamepadState.prevButtons = gamepadState.buttons;
    gamepadState.axes = fakepad.axes.slice(0, 4);
    while (gamepadState.axes.length < 4) gamepadState.axes.push(0);
    gamepadState.buttons = fakepad.buttons.slice();
    return;
  }
  if (!('getGamepads' in navigator)) return;
  const gamepads = navigator.getGamepads();
  // 主動掃描：部分裝置不觸發 gamepadconnected 事件
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
  if (!gp) return;
  gamepadState.prevButtons = gamepadState.buttons;
  gamepadState.axes = Array.from(gp.axes).slice(0, 4);
  while (gamepadState.axes.length < 4) gamepadState.axes.push(0);
  gamepadState.buttons = gp.buttons.map((b) => b.pressed);
}

/** 單軸讀值：套校正 (raw - center) / range → clamp → 死區（對齊 legacy applyGamepadControls 的 ax()） */
function axis(i: number): number {
  const raw = gamepadState.axes[i] ?? 0;
  const c = gamepadConfig.center[i] ?? 0;
  const r = gamepadConfig.range[i] || 1;
  const norm = (raw - c) / r;
  const clamped = Math.max(-1, Math.min(1, norm));
  return Math.abs(clamped) < gamepadConfig.deadzone ? 0 : clamped;
}

/** 語意軸讀值（已套校正 + 死區；推上 = 負） */
export function gamepadAxes(): { throttle: number; yaw: number; pitch: number; roll: number } {
  if (!gamepadState.connected) return { throttle: 0, yaw: 0, pitch: 0, roll: 0 };
  let throttle = axis(gamepadConfig.axes.throttle);
  let pitch = axis(gamepadConfig.axes.pitch);
  if (gamepadConfig.invertThrottle) throttle = -throttle;
  if (gamepadConfig.invertPitch) pitch = -pitch;
  return {
    throttle,
    yaw: axis(gamepadConfig.axes.yaw),
    pitch,
    roll: axis(gamepadConfig.axes.roll),
  };
}

export function isButtonJustPressed(idx: number): boolean {
  return !!gamepadState.buttons[idx] && !gamepadState.prevButtons[idx];
}
