import { describe, expect, it } from 'vitest';
import {
  INPUT_RECORDING_VERSION,
  isInputRecordingV2,
  validateRecording,
  type InputRecordingV2,
} from './inputRecording';

const sample: InputRecordingV2 = {
  v: INPUT_RECORDING_VERSION,
  levelId: '1-1',
  level: { id: '1-1', name: '測試' },
  simVersion: 'dev',
  rngSeed: 42,
  startTick: 100,
  mode: 'manual',
  initial: {
    position: { x: 0, y: 0.4, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    yaw: 0,
    isFlying: false,
    isGrounded: true,
    frozen: false,
  },
  ticks: 2,
  frames: [
    [0, 1, 0, 0, 2],
    [0, 1, 0, 0, 2],
  ],
  actions: [{ t: 1, a: 'takeoff', inTick: true }],
  multiTickFrames: [[0, 2]],
  replayHash: 'abc',
};

describe('inputRecording', () => {
  it('isInputRecordingV2 辨識有效錄製、拒絕 v1', () => {
    expect(isInputRecordingV2(sample)).toBe(true);
    expect(isInputRecordingV2({ ...sample, v: 1 })).toBe(false);
  });

  it('validateRecording 檢查 tick 一致與範圍', () => {
    expect(validateRecording(sample)).toBeNull();
    expect(validateRecording({ ...sample, ticks: 3 })).toMatch(/不一致/);
    expect(validateRecording({ ...sample, actions: [{ t: 9, a: 'reset', inTick: false }] })).toMatch(
      /超出範圍/,
    );
    expect(validateRecording({ ...sample, multiTickFrames: [[1, 2]] })).toMatch(/超出範圍/);
    expect(validateRecording({ ...sample, actions: [{ t: 0, a: 'run', inTick: false }] })).toMatch(
      /code/,
    );
  });
});
