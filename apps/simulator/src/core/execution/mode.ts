// 執行模式切換（M-01）：SIM / REAL 與 MotionRuntime 選擇。
// 不依賴 input/ble（G-04 headless bundle 可載入 program.ts）。
// 真機「已連線」看 WebSocket 橋接的飛機連通狀態，不是 BLE 搖桿。
// 切到真機不會自動 connect()；預設永遠是模擬。
import type { ExecutionMode, ExecutionRuntimeStatus } from '@creafly/shared';
import { EXECUTION_MODE_LABELS } from '@creafly/shared';
import { flags } from '../droneState';
import { bus } from '../events';
import { realMotionRuntime } from './realRuntime';
import type { MotionRuntime } from './runtime';

let mode: ExecutionMode = 'sim';
let simRuntime: MotionRuntime | null = null;

export function registerSimMotionRuntime(rt: MotionRuntime): void {
  simRuntime = rt;
}

/**
 * 搖桿 BLE 與真機橋接是兩條路。執行狀態改看橋接，
 * 這個註冊點留著，讓 input 初始化不用改、也不會在載入時去連真機。
 */
export function registerBleConnectedChecker(_fn: () => boolean): void {
  // 刻意不影響 getExecutionStatus。
}

export function getExecutionMode(): ExecutionMode {
  return mode;
}

export function setExecutionMode(next: ExecutionMode): void {
  if (mode === next) return;
  if (flags.programRunning) {
    bus.emit('toast', { text: '⏳ 程式執行中，不能切換模式', kind: 'error' });
    return;
  }
  mode = next;
  bus.emit('execution-mode-changed', { mode: next, status: getExecutionStatus() });
}

/** 程式停止或離場時呼叫。模擬模式什麼都不做；真機模式送緊急停止。 */
export function notifyMotionStop(): void {
  if (mode !== 'real') return;
  void realMotionRuntime.stop();
}

bus.on('program-running', ({ running }) => {
  if (mode !== 'real') return;
  if (running) realMotionRuntime.onRunStart();
  else void realMotionRuntime.onRunEnd();
});

export function getMotionRuntime(): MotionRuntime {
  if (mode === 'real') return realMotionRuntime;
  if (!simRuntime) throw new Error('SIM runtime 尚未註冊');
  return simRuntime;
}

export function getExecutionStatus(): ExecutionRuntimeStatus {
  if (mode === 'sim') {
    return { mode: 'sim', connected: true, label: EXECUTION_MODE_LABELS.sim, lamp: 'green' };
  }
  const snap = realMotionRuntime.snapshot();
  const connected = snap.status === 'ready';
  return {
    mode: 'real',
    connected,
    label: connected ? '真機（已連線）' : EXECUTION_MODE_LABELS.real,
    lamp: snap.lamp,
    link: snap.status,
    ...(snap.heightCm !== undefined ? { heightCm: snap.heightCm } : {}),
    ...(snap.voltageV !== undefined ? { voltageV: snap.voltageV } : {}),
  };
}

export function buildCreaflyMotionApi(): MotionRuntime {
  return getMotionRuntime();
}
