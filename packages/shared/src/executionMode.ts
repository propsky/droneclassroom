// 程式執行後端：模擬器（SIM）與真機（REAL）共用 cf_* 契約（M-01）。
// shared 只定義模式與狀態型別；實作在 apps/simulator/src/core/execution/。

/** 模擬器內建物理 vs 真機 BLE（v2.0 對接） */
export type ExecutionMode = 'sim' | 'real';

export interface ExecutionRuntimeStatus {
  mode: ExecutionMode;
  /** 真機已連線（SIM 模式恆 true） */
  connected: boolean;
  /** UI 顯示用短標籤 */
  label: string;
}

export const EXECUTION_MODE_LABELS: Record<ExecutionMode, string> = {
  sim: '模擬',
  real: '真機',
};
