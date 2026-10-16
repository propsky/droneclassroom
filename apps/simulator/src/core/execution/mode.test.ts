import { afterEach, describe, expect, it } from 'vitest';
import { flags } from '../droneState';
import { bus } from '../events';
import '../program';
import {
  getExecutionMode,
  getExecutionStatus,
  getMotionRuntime,
  setExecutionMode,
} from './mode';
import { realMotionRuntime } from './realRuntime';

describe('execution mode', () => {
  afterEach(() => {
    flags.programRunning = false;
    setExecutionMode('sim');
  });

  it('預設是模擬，不會用真機後端', () => {
    expect(getExecutionMode()).toBe('sim');
    expect(getExecutionStatus()).toMatchObject({ mode: 'sim', connected: true, lamp: 'green' });
    expect(getMotionRuntime()).not.toBe(realMotionRuntime);
  });

  it('切到真機不會自動連線，未連通是紅燈', () => {
    setExecutionMode('real');
    expect(getExecutionMode()).toBe('real');
    expect(getExecutionStatus()).toMatchObject({
      mode: 'real',
      connected: false,
      lamp: 'red',
      link: 'bridge-down',
    });
    expect(realMotionRuntime.linkStatus()).toBe('bridge-down');
  });

  it('程式執行中不能切換模式', () => {
    const notes: string[] = [];
    const off = bus.on('toast', ({ text }) => notes.push(text));
    flags.programRunning = true;
    setExecutionMode('real');
    expect(getExecutionMode()).toBe('sim');
    expect(notes[0]).toContain('不能切換模式');
    off();
  });
});
