// 真機執行後端 stub（M-01 REAL）：BLE 對接前，動作回報未連線。
// 未來在此呼叫 apps/simulator/src/input/ble.ts 送指令；現階段阻擋程式模式真機執行。
import type { MotionRuntime } from './runtime';
import { bus } from '../events';

const NOT_CONNECTED = '真機尚未連線，請先配對 BLE 搖桿';

function rejectMotion(): Promise<void> {
  bus.emit('toast', { text: NOT_CONNECTED, kind: 'warning' });
  return Promise.reject(new Error(NOT_CONNECTED));
}

export const realMotionRuntime: MotionRuntime = {
  isConnected: () => false,
  takeoff: () => rejectMotion(),
  land: () => rejectMotion(),
  hover: () => rejectMotion(),
  wait: () => rejectMotion(),
  forward: () => rejectMotion(),
  backward: () => rejectMotion(),
  left: () => rejectMotion(),
  right: () => rejectMotion(),
  up: () => rejectMotion(),
  down: () => rejectMotion(),
  rotateClockwise: () => rejectMotion(),
  rotateCounterClockwise: () => rejectMotion(),
};
