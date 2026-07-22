// 輸入彙整：鍵盤 + 虛擬搖桿/BLE + 實體搖桿 疊加成一個 ControlFrame（語意軸），
// 每個物理 tick 由主迴圈取用。優先級對齊 legacy applyManualControls：
// 實體搖桿 > BLE（連線時覆寫虛擬搖桿四軸）> 鍵盤/虛擬搖桿（可疊加）。
import type { ControlFrame } from '../core/physics';
import { autoLand } from '../core/physics';
import { droneState, YAW_KEY_RATE, YAW_STICK_RATE } from '../core/droneState';
import { resetMission } from '../core/level';
import { toast } from '../core/events';
import { keys, initKeyboard } from './keyboard';
import { virtualStick, initVirtualJoystick, isTouchDevice } from './joystick';
import { initGamepad, pollGamepad, gamepadAxes, gamepadState, isButtonJustPressed } from './gamepad';
import { gamepadConfig, initCalibration, tickCalibration, calibration } from './calibration';
import { initBle, bleAxes, bleState } from './ble';

export { isTouchDevice };

export function initInputs(opts: { toggleView: () => void }): void {
  initKeyboard(opts);
  initVirtualJoystick();
  initGamepad();
  // 校正精靈：注入 gamepad 讀值來源（避免 calibration ↔ gamepad 循環依賴）+ 載入上次校正
  initCalibration(() => ({
    connected: gamepadState.connected,
    axes: gamepadState.axes,
    buttons: gamepadState.buttons,
  }));
  initBle(); // pyController 藍牙搖桿（不支援的瀏覽器按鈕自動隱藏）
}

/** 每 tick：輪詢實體搖桿 + 校正精靈取樣 + 處理搖桿按鈕（起飛/降落/重置） */
export function tickInputDevices(manualLocked: boolean): void {
  pollGamepad();
  tickCalibration(); // 校正中：收集軸資料 / 偵測按鍵邊緣
  if (!gamepadState.connected || manualLocked || calibration.active) return;
  if (isButtonJustPressed(gamepadConfig.buttonMap.takeoff) && droneState.isGrounded) {
    droneState.isGrounded = false;
    droneState.isFlying = true;
    toast('🛫 起飛（搖桿）', 'success');
  }
  if (isButtonJustPressed(gamepadConfig.buttonMap.land) && droneState.isFlying) {
    autoLand();
    toast('🛬 降落（搖桿）', 'success');
  }
  if (isButtonJustPressed(gamepadConfig.buttonMap.reset)) {
    resetMission();
    toast('已重置（搖桿）');
  }
}

/** 彙整本 tick 的手動控制輸入 */
export function collectControlFrame(): ControlFrame {
  // 校正中：不吃搖桿輸入（overlay 蓋住畫面時亂推桿不該讓機子亂飛）
  const gp = calibration.active
    ? { throttle: 0, yaw: 0, pitch: 0, roll: 0 }
    : gamepadAxes();
  // BLE 連線中：覆寫虛擬搖桿四軸（對齊 legacy applyBleControls 直接覆寫 joystick）
  const ble = bleAxes();
  const vs = ble ?? virtualStick;
  const frame: ControlFrame = {
    lift: 0,
    forward: 0,
    right: 0,
    yawDelta: 0,
    wantsTakeoff: false,
    anyInput: false,
  };

  // --- 鍵盤 ---
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

  // --- 虛擬搖桿 / BLE（推上 = 負 = 上升/前進） ---
  if (vs.throttle !== 0) {
    frame.lift += -vs.throttle;
    if (vs.throttle < -0.3) frame.wantsTakeoff = true;
  }
  if (vs.pitch !== 0) frame.forward += -vs.pitch;
  if (vs.roll !== 0) frame.right += vs.roll;
  if (vs.yaw !== 0) frame.yawDelta += -vs.yaw * YAW_STICK_RATE;

  // --- 實體搖桿（校正 center/range + 死區） ---
  if (gp.throttle !== 0) {
    frame.lift += -gp.throttle;
    if (gp.throttle < -0.5) frame.wantsTakeoff = true;
  }
  if (gp.pitch !== 0) frame.forward += -gp.pitch;
  if (gp.roll !== 0) frame.right += gp.roll;
  if (gp.yaw !== 0) frame.yawDelta += -gp.yaw * YAW_STICK_RATE;

  // --- 有任何輸入？（解除緊急停止用；對齊 legacy isControlInputActive） ---
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
    vs.throttle !== 0 ||
    vs.yaw !== 0 ||
    vs.pitch !== 0 ||
    vs.roll !== 0 ||
    (!calibration.active &&
      gamepadState.connected &&
      gamepadState.axes.some((v) => Math.abs(v) > 0.3)) ||
    (bleState.connected && !!ble && (ble.throttle !== 0 || ble.yaw !== 0 || ble.pitch !== 0 || ble.roll !== 0));

  return frame;
}
