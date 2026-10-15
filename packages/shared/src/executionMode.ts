// 程式執行後端：模擬器（SIM）與真機（REAL）共用 cf_* 契約（M-01）。
// shared 只定義模式與狀態型別；實作在 apps/simulator/src/core/execution/。
// 真機走本機 WebSocket JSON 橋接（預設 ws://localhost:8765/ws），不是 BLE 搖桿。

/** 模擬器內建物理 vs 本機橋接真機 */
export type ExecutionMode = 'sim' | 'real';

/** 真機橋接細狀態：紅 bridge-down、黃 viewer / no-aircraft、綠 ready */
export type RealLinkStatus = 'bridge-down' | 'viewer' | 'no-aircraft' | 'ready';

/** 紅／黃／綠燈 */
export type LinkLamp = 'red' | 'yellow' | 'green';

export interface ExecutionRuntimeStatus {
  mode: ExecutionMode;
  /**
   * 現在能不能執行程式。
   * 模擬模式恆 true；真機模式要橋接與飛機都連通（link === 'ready'）。
   */
  connected: boolean;
  /** UI 顯示用短標籤 */
  label: string;
  /** 燈號。模擬模式為 green。 */
  lamp?: LinkLamp;
  /** 真機連線細狀態；模擬模式不帶。 */
  link?: RealLinkStatus;
  /** 最近一筆遙測高度（公分） */
  heightCm?: number;
  /** 最近一筆遙測電壓（伏特） */
  voltageV?: number;
}

export const EXECUTION_MODE_LABELS: Record<ExecutionMode, string> = {
  sim: '模擬',
  real: '真機',
};
