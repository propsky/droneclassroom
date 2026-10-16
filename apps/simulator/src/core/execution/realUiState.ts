// 真機工具列要畫什麼。純函式，方便測試；DOM 在 ui/realToolbar.ts。
import type { ExecutionMode, LinkLamp, RealLinkStatus } from '@creafly/shared';
import { STATUS_TEXT } from './realRuntime';

export interface RealToolbarInput {
  switchVisible: boolean;
  mode: ExecutionMode;
  connecting: boolean;
  link: RealLinkStatus;
  heightCm?: number;
  voltageV?: number;
  /** 最近一次要留給學生看的錯誤（例如前後左右被拒絕） */
  pinnedError: string | null;
  programRunning: boolean;
}

export interface RealToolbarView {
  showSwitch: boolean;
  simSelected: boolean;
  realSelected: boolean;
  showRealControls: boolean;
  lamp: LinkLamp;
  /** 給螢幕報讀：未連線／連線中／已連線 */
  lampLabel: string;
  statusText: string;
  connectLabel: '連線' | '連線中' | '中斷';
  connectDisabled: boolean;
  runLabel: string;
  runIsDanger: boolean;
}

function lampLabel(lamp: LinkLamp): string {
  if (lamp === 'green') return '已連線';
  if (lamp === 'yellow') return '連線中';
  return '未連線';
}

/** 紅＝未連線，黃＝連線中（或橋接已連但飛機還沒就緒），綠＝已連線。 */
export function describeRealToolbar(input: RealToolbarInput): RealToolbarView {
  const real = input.mode === 'real' && input.switchVisible;
  let lamp: LinkLamp = 'red';
  let statusText = '未連線';
  if (real && input.connecting) {
    lamp = 'yellow';
    statusText = '連線中';
  } else if (real && input.link === 'ready') {
    lamp = 'green';
    const height = input.heightCm === undefined ? '—' : String(input.heightCm);
    const voltage = input.voltageV === undefined ? '—' : input.voltageV.toFixed(2);
    statusText = `已連線　高度 ${height} cm　電壓 ${voltage} V`;
  } else if (real && input.link !== 'bridge-down') {
    lamp = 'yellow';
    statusText = STATUS_TEXT[input.link];
  }
  if (real && input.pinnedError) statusText = input.pinnedError;

  const linked = real && !input.connecting && input.link !== 'bridge-down';
  return {
    showSwitch: input.switchVisible,
    simSelected: !real,
    realSelected: real,
    showRealControls: real,
    lamp,
    lampLabel: lampLabel(lamp),
    statusText,
    connectLabel: input.connecting ? '連線中' : linked ? '中斷' : '連線',
    connectDisabled: input.connecting || (input.programRunning && !linked),
    runLabel: real ? '執行（真機會飛）' : '執行程式',
    runIsDanger: real,
  };
}
