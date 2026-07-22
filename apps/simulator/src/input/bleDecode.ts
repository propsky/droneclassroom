// pyController BLE 封包解析 — 純函式（零依賴，可用 node 直跑單元測試）。
// 協定 / UUID / 解析邏輯照 legacy/controllertestweb/drone-controller.js：
// 控制器（ESP32 / MicroPython, ble_sim_peripheral.py）廣播 Nordic UART Service，
// 每 50ms 用 TX 特徵 notify 一個 7-byte frame。

export const NUS_SERVICE = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
export const NUS_TX = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'; // 裝置 → 網頁（notify）
export const NUS_RX = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'; // 網頁 → 裝置（預留）

/** 把 0..255（中點 127）正規化到 -1..1 */
export const norm = (v: number): number => Math.max(-1, Math.min(1, (v - 127) / 127));

export interface BleControllerState {
  throttle: number;
  yaw: number;
  pitch: number;
  roll: number;
  raw: { lx: number; ly: number; rx: number; ry: number };
  dpad: { up: boolean; down: boolean; left: boolean; right: boolean };
  buttons: {
    Y: boolean;
    B: boolean;
    A: boolean;
    X: boolean;
    Back: boolean;
    Start: boolean;
    RStick: boolean;
    LStick: boolean;
  };
}

/**
 * 7-byte frame → 控制狀態（Mode 2 美國手：左桿 = 油門(Y) + 偏航(X)、右桿 = 俯仰(Y) + 翻滾(X)）。
 * byte[1..4] = 左X / 左Y / 右X / 右Y（0..255，中點 127）
 * byte[5] = D-pad + 面板鍵、byte[6] = 系統 / 搖桿按下鍵
 */
export function decodeFrame(dv: DataView): BleControllerState | null {
  if (dv.byteLength < 7) return null;
  const lx = dv.getUint8(1);
  const ly = dv.getUint8(2);
  const rx = dv.getUint8(3);
  const ry = dv.getUint8(4);
  const bFace = dv.getUint8(5);
  const bSys = dv.getUint8(6);

  const dpad = bFace & 0x0f; // 0=上 4=下 6=左 2=右 8=無
  return {
    throttle: norm(ly),
    yaw: norm(lx),
    pitch: norm(ry),
    roll: norm(rx),
    raw: { lx, ly, rx, ry },
    dpad: { up: dpad === 0, down: dpad === 4, left: dpad === 6, right: dpad === 2 },
    buttons: {
      Y: !!(bFace & (1 << 4)),
      B: !!(bFace & (1 << 5)),
      A: !!(bFace & (1 << 6)),
      X: !!(bFace & (1 << 7)),
      Back: !!(bSys & (1 << 4)),
      Start: !!(bSys & (1 << 5)),
      RStick: !!(bSys & (1 << 6)),
      LStick: !!(bSys & (1 << 7)),
    },
  };
}
