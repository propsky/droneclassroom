// 輸入錄製生命週期：接 event bus；主迴圈每 tick 呼叫 begin/endRecordedTick（見 simTick.ts）。
import type { InputRecordingV2, LevelDef } from '@creafly/shared';
import { bus } from './events';
import { startInputRecording, finishInputRecording, cancelInputRecording } from './inputRecorder';

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

export function finalizeRecording(): InputRecordingV2 | undefined {
  return finishInputRecording() ?? undefined;
}

export {
  recordAction,
  beginRecordedTick,
  endRecordedTick,
  beginFrame,
  endFrame,
  setInFixedTick,
  isRecording,
} from './inputRecorder';
