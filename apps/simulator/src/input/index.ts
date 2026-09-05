// 輸入彙整：鍵盤 + 虛擬搖桿/BLE + 實體搖桿 疊加成一個 ControlFrame（語意軸），
// 每個物理 tick 由主迴圈取用。搖桿優先序：實體 Gamepad > BLE > 虛擬搖桿（互斥，不疊加）。
// 鍵盤可與搖桿並用（教室常見：鍵盤微調 + 手把主控）。
import type { ControlFrame } from '../core/physics';
import { autoLand } from '../core/physics';
import { droneState, YAW_KEY_RATE, YAW_STICK_RATE } from '../core/droneState';
import { resetMission } from '../core/level';
import { toast } from '../core/events';
import { keys, initKeyboard } from './keyboard';
import { virtualStick, initVirtualJoystick, isTouchDevice } from './joystick';
import {
  initGamepad,
  pollGamepad,
  gamepadAxes,
  gamepadState,
  isButtonJustPressed,
} from './gamepad';
import { gamepadConfig, initCalibration, tickCalibration, calibration } from './calibration';
import { initBle, bleAxes, bleState, bleButtonEdges, syncBleButtonSample } from './ble';

export { isTouchDevice };

type StickAxes = { throttle: number; yaw: number; pitch: number; roll: number };

export function initInputs(opts: { toggleView: () => void }): void {
  initKeyboard(opts);
  initVirtualJoystick();
  initGamepad();
  initCalibration(() => ({
    connected: gamepadState.connected,
    axes: gamepadState.axes,
    buttons: gamepadState.buttons,
  }));
  initBle();
}

function handlePadButtons(
  takeoff: boolean,
  land: boolean,
  reset: boolean,
  source: string,
): void {
  if (takeoff && droneState.isGrounded) {
    droneState.isGrounded = false;
    droneState.isFlying = true;
    toast(`🛫 起飛（${source}）`, 'success');
  }
  if (land && droneState.isFlying) {
    autoLand();
    toast(`🛬 降落（${source}）`, 'success');
  }
  if (reset) {
    resetMission();
    toast(`已重置（${source}）`);
  }
}

/** 每 tick：輪詢實體搖桿 + 校正精靈取樣 + 處理搖桿按鈕（起飛/降落/重置） */
export function tickInputDevices(manualLocked: boolean): void {
  pollGamepad();
  tickCalibration();
  if (manualLocked || calibration.active) return;

  if (gamepadState.connected) {
    handlePadButtons(
      isButtonJustPressed(gamepadConfig.buttonMap.takeoff),
      isButtonJustPressed(gamepadConfig.buttonMap.land),
      isButtonJustPressed(gamepadConfig.buttonMap.reset),
      '搖桿',
    );
    return;
  }

  if (bleState.connected) {
    const edges = bleButtonEdges();
    handlePadButtons(edges.takeoff, edges.land, edges.reset, 'BLE');
    syncBleButtonSample();
  }
}

function activeStickAxes(): StickAxes {
  if (!calibration.active && gamepadState.connected) return gamepadAxes();
  const ble = bleAxes();
  if (ble) return ble;
  return virtualStick;
}

function stickHasInput(s: StickAxes): boolean {
  return s.throttle !== 0 || s.yaw !== 0 || s.pitch !== 0 || s.roll !== 0;
}

/** 彙整本 tick 的手動控制輸入 */
export function collectControlFrame(): ControlFrame {
  if (keys[' ']) {
    return { lift: 0, forward: 0, right: 0, yawDelta: 0, wantsTakeoff: false, anyInput: false };
  }

  const stick = calibration.active
    ? { throttle: 0, yaw: 0, pitch: 0, roll: 0 }
    : activeStickAxes();

  const frame: ControlFrame = {
    lift: 0,
    forward: 0,
    right: 0,
    yawDelta: 0,
    wantsTakeoff: false,
    anyInput: false,
  };

  if (keys['arrowup']) {
    frame.lift += 1;
    frame.wantsTakeoff = true;
  }
  if (keys['arrowdown']) frame.lift -= 1;
  if (keys['w']) frame.forward += 1;
  if (keys['s']) frame.forward -= 1;
  if (keys['a']) frame.right -= 1;
  if (keys['d']) frame.right += 1;
  if (keys['arrowleft']) frame.yawDelta += YAW_KEY_RATE;
  if (keys['arrowright']) frame.yawDelta -= YAW_KEY_RATE;

  if (stick.throttle !== 0) {
    frame.lift += -stick.throttle;
    if (stick.throttle < -0.3) frame.wantsTakeoff = true;
  }
  if (stick.pitch !== 0) frame.forward += -stick.pitch;
  if (stick.roll !== 0) frame.right += stick.roll;
  if (stick.yaw !== 0) frame.yawDelta += -stick.yaw * YAW_STICK_RATE;

  frame.anyInput =
    !!(
      keys['w'] ||
      keys['a'] ||
      keys['s'] ||
      keys['d'] ||
      keys['arrowup'] ||
      keys['arrowdown'] ||
      keys['arrowleft'] ||
      keys['arrowright']
    ) ||
    (!calibration.active && stickHasInput(stick));

  return frame;
}

export function isPhysicalPadActive(): boolean {
  return gamepadState.connected || bleState.connected;
}
