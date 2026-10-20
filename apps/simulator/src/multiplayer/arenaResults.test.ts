import { describe, expect, it } from 'vitest';
import type { ArenaRoundResult } from '@creafly/shared';
import { ArenaResults } from './arenaResults';

const result: ArenaRoundResult = {
  reason: 'time_up',
  winner: 'time',
  ranking: [],
};

describe('大亂鬥結算凍結與老師恢復', () => {
  it('時間到才進入結算，手動停止與切關不進', () => {
    expect(ArenaResults.isTimeUp('time_up')).toBe(true);
    expect(ArenaResults.isTimeUp(undefined)).toBe(true);
    expect(ArenaResults.isTimeUp('teacher_stop')).toBe(false);
    expect(ArenaResults.isTimeUp('level_switch')).toBe(false);
  });

  it('凍結時鎖輸入並把速度歸零', () => {
    const drone = { velocity: { x: 2, y: -1, z: 0.4 }, returning: true };
    const flags = { multiplayerLock: false };
    ArenaResults.freeze(drone, flags);
    expect(flags.multiplayerLock).toBe(true);
    expect(drone.returning).toBe(false);
    expect(drone.velocity).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('遲到者看到 ended 與結算就顯示，並維持到老師動作', () => {
    expect(ArenaResults.transition(false, 'ended', result)).toBe('show');
    expect(ArenaResults.transition(true, 'ended', null)).toBe('keep');
    expect(ArenaResults.transition(true, 'ended', undefined)).toBe('keep');
  });

  it('老師再來一輪或切關會收起結算', () => {
    expect(ArenaResults.transition(true, 'countdown', null)).toBe('hide');
    expect(ArenaResults.transition(true, 'running', null)).toBe('hide');
    expect(ArenaResults.transition(true, 'idle', null)).toBe('hide');
    expect(ArenaResults.transition(false, 'idle', null)).toBe('hide');
  });
});
