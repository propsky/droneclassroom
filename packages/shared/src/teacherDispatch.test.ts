import { describe, expect, it } from 'vitest';
import { TeacherDispatch } from './teacherDispatch';

describe('教師派送上限', () => {
  it('足球 6 人、大亂鬥 8 人', () => {
    expect(TeacherDispatch.soccerCap).toBe(6);
    expect(TeacherDispatch.arenaCap).toBe(8);
    expect(TeacherDispatch.cap('soccer')).toBe(6);
    expect(TeacherDispatch.cap('arena')).toBe(8);
    expect(TeacherDispatch.title('soccer')).toBe('足球對戰');
    expect(TeacherDispatch.title('arena')).toBe('大亂鬥');
  });

  it('倒數與進行中算比賽中，結束與閒置可以再派', () => {
    for (const status of ['countdown', 'running', 'break', 'golden', 'pk']) {
      expect(TeacherDispatch.matchIsLive('soccer', status)).toBe(true);
    }
    expect(TeacherDispatch.matchIsLive('soccer', 'idle')).toBe(false);
    expect(TeacherDispatch.matchIsLive('soccer', 'done')).toBe(false);
    expect(TeacherDispatch.matchIsLive('arena', 'countdown')).toBe(true);
    expect(TeacherDispatch.matchIsLive('arena', 'running')).toBe(true);
    expect(TeacherDispatch.matchIsLive('arena', 'ended')).toBe(false);
    expect(TeacherDispatch.matchIsLive('arena', 'idle')).toBe(false);
  });
});
