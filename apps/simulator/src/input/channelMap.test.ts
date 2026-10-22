import { describe, expect, it } from 'vitest';
import { GamepadConfigStore, CalibrationWizard } from './calibration';
import { ChannelPanel } from './channelMap';
import type { PadSnapshot } from './calibration';

function pad(axes: number[], buttons: boolean[] = [false, false, false, false]): PadSnapshot {
  return { connected: true, axes, buttons };
}

function open(): ChannelPanel {
  const panel = new ChannelPanel();
  panel.load(GamepadConfigStore.fresh());
  panel.start();
  panel.sample(pad([0, 0, 0, 0]));
  return panel;
}

describe('ChannelPanel 指定', () => {
  it('指定後推一下軸就寫入，門檻與校正精靈相同', () => {
    expect(ChannelPanel.changeThreshold(1)).toBe(CalibrationWizard.changeThreshold(1));
    expect(ChannelPanel.changeThreshold(0)).toBeCloseTo(0.12);
    const panel = open();
    panel.listen('throttle');
    panel.sample(pad([0.05, 0, 0, 0]));
    expect(panel.toConfig(GamepadConfigStore.fresh()).axes.throttle).toBe(1);
    panel.sample(pad([0.8, 0, 0, 0]));
    const config = panel.toConfig(GamepadConfigStore.fresh());
    expect(config.axes.throttle).toBe(0);
    expect(config.invertThrottle).toBe(true);
    expect(panel.view(0).rows.find((row) => row.id === 'throttle')?.deviceLabel).toBe('裝置軸 1');
    expect(panel.view(0).rows.find((row) => row.id === 'throttle')?.radioLabel).toBe('CH1');
  });

  it('同一拍同時聽到軸和按鈕；搖桿列採納軸並註記按鈕', () => {
    const panel = open();
    panel.listen('yaw');
    panel.sample(pad([0.7, 0, 0, 0], [true, false, false, false]));
    const config = panel.toConfig(GamepadConfigStore.fresh());
    expect(config.axes.yaw).toBe(0);
    expect(panel.view(0).status).toContain('按鈕 0');
  });

  it('只按按鈕不會把油門寫成按鈕', () => {
    const panel = open();
    panel.listen('throttle');
    panel.sample(pad([0, 0, 0, 0], [false, true, false, false]));
    expect(panel.toConfig(GamepadConfigStore.fresh()).axes.throttle).toBe(1);
    expect(panel.view(0).status).toContain('按鈕 1');
    expect(panel.view(0).listening).toBe('throttle');
  });

  it('解鎖可指定也可清除，不改四軸與起飛鍵', () => {
    const panel = open();
    const before = GamepadConfigStore.fresh();
    panel.listen('arm');
    panel.sample(pad([0, 0, 0, 0], [true, false, false, false]));
    expect(panel.toConfig(before).arm).toEqual({ kind: 'button', index: 0, invert: false });
    expect(panel.toConfig(before).axes).toEqual(before.axes);
    expect(panel.toConfig(before).buttonMap).toEqual(before.buttonMap);
    panel.clearArm();
    expect(panel.toConfig(before).arm).toBeNull();
  });

  it('缺少的軸不補 0', () => {
    const panel = open();
    panel.setDetail('pro');
    panel.sample(pad([0.2, -0.4], [false]));
    const view = panel.view(0);
    expect(view.rawAxes.map((axis) => axis.raw)).toEqual([0.2, -0.4]);
    expect(view.missingAxesNote).toContain('2 軸');
    expect(view.missingAxesNote).toContain('沒有把缺少的軸補成 0');
    expect(view.rows.map((row) => row.id)).toContain('takeoff');
  });

  it('精簡模式不列出其他開關', () => {
    const panel = open();
    expect(panel.view(0).detail).toBe('simple');
    expect(panel.view(0).rows.map((row) => row.id)).toEqual(['throttle', 'yaw', 'pitch', 'roll', 'arm']);
  });
});

describe('ChannelPanel 反向與預設', () => {
  it('反向切換既有的反轉旗標，不改軸編號', () => {
    const panel = open();
    const base = GamepadConfigStore.fresh();
    expect(panel.toConfig(base).invertThrottle).toBe(false);
    panel.toggleReverse('throttle');
    expect(panel.toConfig(base).invertThrottle).toBe(true);
    expect(panel.toConfig(base).axes).toEqual(base.axes);
    panel.toggleReverse('throttle');
    expect(panel.toConfig(base).invertThrottle).toBe(false);
    panel.toggleReverse('yaw');
    panel.toggleReverse('pitch');
    panel.toggleReverse('roll');
    const config = panel.toConfig(base);
    expect(config.invertYaw).toBe(true);
    expect(config.invertPitch).toBe(true);
    expect(config.invertRoll).toBe(true);
  });

  it('Mode 2 套用只寫入猜測，死區維持預設', () => {
    const panel = open();
    panel.setDeadzone(0.2);
    panel.applyMode2();
    const config = panel.toConfig(GamepadConfigStore.fresh());
    expect(config.axes).toEqual({ throttle: 1, pitch: 3, yaw: 0, roll: 2 });
    expect(config.buttonMap).toEqual({ takeoff: 0, land: 1, reset: 2 });
    expect(config.arm).toBeNull();
    expect(config.deadzone).toBe(0.2);
    expect(config.invertThrottle).toBe(false);
  });

  it('逐步指定依序前進，時間不會自己採納', () => {
    const panel = open();
    panel.startGuide();
    expect(panel.view(0).listening).toBe('throttle');
    panel.sample(pad([0, 0, 0, 0]));
    expect(panel.view(0).listening).toBe('throttle');
    panel.sample(pad([0, 0, 0.8, 0]));
    expect(panel.toConfig(GamepadConfigStore.fresh()).axes.throttle).toBe(2);
    expect(panel.view(0).listening).toBe('yaw');
  });
});
