// 輸入錄製生命週期：接 event bus；主迴圈每 tick 呼叫 recordInputTick。
import type { InputRecordingV1, LevelDef } from '@creafly/shared';
import { bus } from './events';
import {
  startInputRecording,
  finishInputRecording,
  cancelInputRecording,
  attachProgramCode,
  recordInputTick,
} from './inputRecorder';

export function initRecordingSession(
  resolveLevel: () => LevelDef | null,
  shouldRecord: () => boolean = () => true,
): void {
  bus.on('level-timing-started', () => {
    if (!shouldRecord()) return;
    const level = resolveLevel();
    if (level) startInputRecording(level);
  });
  bus.on('level-cleared', () => cancelInputRecording());
  bus.on('level-loaded', () => cancelInputRecording());
}

export function captureProgramCode(code: string): void {
  attachProgramCode(code);
}

export function finalizeRecording(): InputRecordingV1 | undefined {
  return finishInputRecording() ?? undefined;
}

export { recordInputTick, isRecording } from './inputRecorder';
