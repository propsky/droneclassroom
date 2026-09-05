// 執行模式切換（M-01）：SIM / REAL 與 MotionRuntime 選擇。
// 不依賴 input/ble（G-04 headless bundle 可載入 program.ts）。
import type { ExecutionMode, ExecutionRuntimeStatus } from '@creafly/shared';
import { EXECUTION_MODE_LABELS } from '@creafly/shared';
import type { MotionRuntime } from './runtime';
import { realMotionRuntime } from './realRuntime';
import { bus } from '../events';

let mode: ExecutionMode = 'sim';
let simRuntime: MotionRuntime | null = null;
let bleConnectedChecker: () => boolean = () => false;

export function registerSimMotionRuntime(rt: MotionRuntime): void {
  simRuntime = rt;
}

/** main / ble 模組初始化後註冊（避免 core 依賴 DOM） */
export function registerBleConnectedChecker(fn: () => boolean): void {
  bleConnectedChecker = fn;
}

export function getExecutionMode(): ExecutionMode {
  return mode;
}

export function setExecutionMode(next: ExecutionMode): void {
  if (mode === next) return;
  mode = next;
  bus.emit('execution-mode-changed', { mode: next, status: getExecutionStatus() });
}

export function getMotionRuntime(): MotionRuntime {
  if (mode === 'real') return realMotionRuntime;
  if (!simRuntime) throw new Error('SIM runtime 尚未註冊');
  return simRuntime;
}

export function getExecutionStatus(): ExecutionRuntimeStatus {
  if (mode === 'sim') {
    return { mode: 'sim', connected: true, label: EXECUTION_MODE_LABELS.sim };
  }
  const connected = bleConnectedChecker();
  return {
    mode: 'real',
    connected,
    label: connected ? '真機（已連線）' : EXECUTION_MODE_LABELS.real,
  };
}

export function buildCreaflyMotionApi(): MotionRuntime {
  return getMotionRuntime();
}
