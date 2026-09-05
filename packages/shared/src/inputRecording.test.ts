import { describe, expect, it } from 'vitest';
import {
  INPUT_RECORDING_VERSION,
  isInputRecordingV1,
  validateRecording,
  type InputRecordingV1,
} from './inputRecording';

const sample: InputRecordingV1 = {
  v: INPUT_RECORDING_VERSION,
  levelId: '1-1',
  level: { id: '1-1', name: '測試' },
  rngSeed: 42,
  ticks: 1,
  frames: [{ lift: 0, forward: 1, right: 0, yawDelta: 0, wantsTakeoff: false }],
  replayHash: 'abc',
};

describe('inputRecording', () => {
  it('isInputRecordingV1 辨識有效錄製', () => {
    expect(isInputRecordingV1(sample)).toBe(true);
    expect(isInputRecordingV1({ v: 2 })).toBe(false);
  });

  it('validateRecording 檢查 tick 一致', () => {
    expect(validateRecording(sample)).toBeNull();
    expect(validateRecording({ ...sample, ticks: 2 })).toMatch(/不一致/);
  });
});
