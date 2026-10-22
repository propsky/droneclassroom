import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CalibrationWizard,
  GamepadConfigStore,
  type GamepadConfig,
  type PadSnapshot,
} from './calibration';

function pad(axes: number[], buttons: boolean[] = [false, false, false, false]): PadSnapshot {
  return { connected: true, axes, buttons };
}

function zeros(axisCount = 4, buttonCount = 4): PadSnapshot {
  return pad(Array(axisCount).fill(0), Array(buttonCount).fill(false));
}

/** 停在某個步驟，且（除了放開／攪拌）基線已鎖在靜止位置。 */
function at(id: string, axisCount = 4, buttonCount = 4): { w: CalibrationWizard; t: number } {
  const w = new CalibrationWizard();
  let t = 0;
  w.start(0);
  w.sample(zeros(axisCount, buttonCount), 0);
  if (id !== 'letGo') {
    t = 1;
    w.confirmHandsOff(t);
  }
  while (w.view().stepId !== id && w.view().stepId !== 'done') {
    t += 1;
    w.skip(t);
  }
  if (id !== 'letGo' && id !== 'stir' && id !== 'done') {
    t += 1;
    w.sample(zeros(axisCount, buttonCount), t);
  }
  return { w, t };
}

function fresh(): GamepadConfig {
  return GamepadConfigStore.fresh();
}

describe('CalibrationWizard 門檻與標籤', () => {
  it('門檻用這根軸自己的行程，不是 0.95', () => {
    expect(CalibrationWizard.changeThreshold(1)).toBeCloseTo(0.3);
    expect(CalibrationWizard.changeThreshold(0)).toBeCloseTo(CalibrationWizard.ABS_FLOOR);
    expect(CalibrationWizard.changeThreshold(2)).toBeCloseTo(0.6);
    expect(CalibrationWizard.changeThreshold(1)).toBeLessThan(0.95);
  });

  it('裝置軸與無線電 CH 分開標，Mode 2 不參與編號', () => {
    expect(CalibrationWizard.axisLabels(0)).toEqual({ device: '裝置軸 1', radio: 'CH1' });
    expect(CalibrationWizard.axisLabels(5)).toEqual({ device: '裝置軸 6', radio: 'CH6' });
    expect(CalibrationWizard.STICK_MODE).toBe(2);
    expect(CalibrationWizard.MODE_NOTE).toContain('不決定');
  });

  it('軸數不足時說明，不暗示後面還有補出來的 0', () => {
    expect(CalibrationWizard.missingAxesNote(2)).toContain('2 軸');
    expect(CalibrationWizard.missingAxesNote(2)).toContain('沒有把缺少的軸補成 0');
    expect(CalibrationWizard.missingAxesNote(4)).toContain('4 軸');
    expect(CalibrationWizard.missingAxesNote(8)).toBeNull();
  });
});

describe('CalibrationWizard 步驟', () => {
  it('時間可以推進放開，但不會把任何軸當成油門', () => {
    const w = new CalibrationWizard();
    const base = fresh();
    w.start(0);
    w.sample(zeros(), 0);
    expect(w.view().stepId).toBe('letGo');
    expect(w.view().axes).toHaveLength(4);
    w.sample(zeros(), CalibrationWizard.LET_GO_MS - 1);
    expect(w.view().stepId).toBe('letGo');
    w.sample(pad([1, 1, 1, 1]), CalibrationWizard.LET_GO_MS);
    expect(w.view().stepId).toBe('stir');
    expect(w.toConfig(base).axes).toEqual(base.axes);
  });

  it('行程夠了才離開攪拌；逾時只打開「就用目前看到的」', () => {
    const w = new CalibrationWizard();
    w.start(0);
    w.sample(zeros(), 0);
    w.confirmHandsOff(10);
    expect(w.view().stepId).toBe('stir');
    w.sample(zeros(), 10 + CalibrationWizard.RANGE_OFFER_MS);
    expect(w.view().stepId).toBe('stir');
    expect(w.view().showUsePartial).toBe(true);
    expect(w.toConfig(fresh()).axes).toEqual(fresh().axes);
    expect(w.acceptPartial(9000)).toBe(true);
    expect(w.view().stepId).toBe('throttle');

    const done = new CalibrationWizard();
    done.start(0);
    done.sample(zeros(), 0);
    done.confirmHandsOff(10);
    done.sample(zeros(), 20);
    done.sample(pad([0.6, 0.6, 0.6, 0.6]), 30);
    expect(done.view().stepId).toBe('throttle');
    expect(done.toConfig(fresh()).axes).toEqual(fresh().axes);
  });

  it('軸的變化用自己的行程當分母，看到就顯示值與差', () => {
    const w = new CalibrationWizard();
    w.start(0);
    w.sample(zeros(), 0);
    w.confirmHandsOff(10);
    w.sample(zeros(), 20);
    w.sample(pad([1, 0.2, 0, 0]), 30);
    w.sample(zeros(), 40);
    expect(w.view().stepId).toBe('stir');
    w.acceptPartial(50);
    w.sample(zeros(), 60);

    w.sample(pad([0.25, 0, 0, 0]), 70);
    expect(w.view().seenText).toBeNull();
    w.sample(pad([0.35, 0, 0, 0]), 80);
    const seen = w.view().seenText ?? '';
    expect(seen).toContain('看到');
    expect(seen).toContain('裝置軸 1');
    expect(seen).toContain('CH1');
    expect(seen).toContain('值');
    expect(seen).toContain('差');
    expect(w.view().showConfirm).toBe(true);
    expect(w.view().confirmLabel).toBe('就用這個');

    const small = new CalibrationWizard();
    small.start(0);
    small.sample(zeros(), 0);
    small.confirmHandsOff(10);
    small.sample(zeros(), 20);
    small.sample(pad([1, 0.2, 0, 0]), 30);
    small.acceptPartial(40);
    small.sample(zeros(), 50);
    small.sample(pad([0, 0.15, 0, 0]), 60);
    expect(small.view().seenText).toContain('裝置軸 2');
    expect(0.15).toBeLessThan(0.95);
  });

  it('同一拍同時聽到軸和按鈕', () => {
    const { w, t } = at('throttle');
    w.sample(pad([0, 0, 0.8, 0], [false, true, false, false]), t + 1);
    const view = w.view();
    expect(view.seenText).toContain('裝置軸 3');
    expect(view.seenText).toContain('CH3');
    expect(view.alsoSeenText).toContain('按鈕 1');
    expect(view.buttons[1]?.changed).toBe(true);
  });

  it('只按按鈕也會顯示，而且不會把它寫成油門', () => {
    const { w, t } = at('throttle');
    w.sample(pad([0, 0, 0, 0], [true, false, false, false]), t + 1);
    expect(w.view().seenText).toContain('看到 按鈕 0');
    expect(w.view().seenText).toContain('差');
    expect(w.confirm(t + 2)).toBe(false);
    expect(w.view().mismatchHint).toContain('按鈕');
    expect(w.view().stepId).toBe('throttle');
    expect(w.toConfig(fresh()).axes.throttle).toBe(fresh().axes.throttle);
  });

  it('手動點了軸之後仍然聽按鈕', () => {
    const { w, t } = at('throttle');
    w.pickAxis(0, t + 1);
    expect(w.view().seenText).toContain('裝置軸 1');
    expect(w.view().focus).toEqual({ kind: 'axis', index: 0 });
    w.sample(pad([0, 0, 0, 0], [false, true, false, false]), t + 2);
    expect(w.view().seenText).toContain('按鈕 1');
    expect(w.view().buttons[1]?.changed).toBe(true);
    expect(w.confirm(t + 3)).toBe(false);
    w.sample(pad([0, 0, 0, 0], [false, false, true, false]), t + 4);
    expect(w.view().seenText).toContain('按鈕 2');
    w.pickAxis(3, t + 5);
    expect(w.confirm(t + 6)).toBe(true);
    expect(w.toConfig(fresh()).axes.throttle).toBe(3);
  });

  it('手動點選超出連線軸數時不理會，也不補一根軸', () => {
    const w = new CalibrationWizard();
    w.start(0);
    w.sample(pad([0.1, -0.2], [false]), 5);
    const view = w.view();
    expect(view.axes.map((a) => a.raw)).toEqual([0.1, -0.2]);
    expect(view.missingAxesNote).toContain('2 軸');
    w.pickAxis(3, 6);
    expect(w.view().seenText).toBeNull();
    expect(w.view().axes).toHaveLength(2);
  });

  it('跳過不寫入對應', () => {
    const { w, t } = at('throttle');
    w.skip(t + 1);
    expect(w.view().stepId).toBe('yaw');
    expect(w.toConfig(fresh()).axes).toEqual(fresh().axes);
  });

  it('2 秒沒有變化就提示在聽什麼、如何手動點、如何跳過', () => {
    const { w, t } = at('throttle');
    w.sample(zeros(), t + CalibrationWizard.HINT_MS - 1);
    expect(w.view().idleHint).toBeNull();
    w.sample(zeros(), t + CalibrationWizard.HINT_MS);
    const hint = w.view().idleHint ?? '';
    expect(hint).toContain('2 秒');
    expect(hint).toContain('裝置軸');
    expect(hint).toContain('按鈕');
    expect(hint).toContain('手動');
    expect(hint).toContain('跳過');
    expect(hint).toContain('就用這個');
  });

  it('對應步驟再久也不會自己採納', () => {
    const { w, t } = at('throttle');
    w.sample(zeros(), t + 10_000);
    expect(w.view().stepId).toBe('throttle');
    expect(w.toConfig(fresh()).axes.throttle).toBe(fresh().axes.throttle);
    expect(w.view().showConfirm).toBe(false);
  });

  it('慢慢移動只是提醒，確認後仍可指定，也不擋住下一根', () => {
    const { w, t } = at('throttle');
    let time = t;
    for (let i = 1; i <= 8; i++) {
      time += 1;
      w.sample(pad([i * 0.1, 0, 0, 0]), time);
    }
    expect(w.view().seenText).toContain('裝置軸 1');
    expect(w.view().motionHint).toContain('不會把這根軸排除');
    expect(w.confirm(time + 1)).toBe(true);
    expect(w.toConfig(fresh()).axes.throttle).toBe(0);

    w.sample(zeros(), time + 2);
    w.sample(pad([0.9, 0, 0, 0]), time + 3);
    expect(w.view().occupiedHint).toContain('油門');
    expect(w.view().seenText).toBeNull();
    w.sample(pad([0.9, 0.9, 0, 0]), time + 4);
    expect(w.view().seenText).toContain('裝置軸 2');
    expect(w.confirm(time + 5)).toBe(true);
    expect(w.toConfig(fresh()).axes.yaw).toBe(1);
  });

  it('第 6 軸一樣聽得到，不會寫死 CH5', () => {
    const { w, t } = at('throttle', 8, 2);
    const axes = Array(8).fill(0);
    axes[5] = 0.5;
    w.sample(pad(axes, [false, false]), t + 1);
    const seen = w.view().seenText ?? '';
    expect(seen).toContain('裝置軸 6');
    expect(seen).toContain('CH6');
    expect(seen).not.toContain('CH5');
    expect(w.confirm(t + 2)).toBe(true);
    const cfg = w.toConfig(fresh());
    expect(cfg.axes.throttle).toBe(5);
    expect(cfg.center[5]).toBeTypeOf('number');
    expect(cfg.range[5]).toBeGreaterThan(0);
  });

  it('解鎖可以跳過，也可以記下，但不會改起飛按鍵', () => {
    const skipped = at('arm');
    skipped.w.skip(skipped.t + 1);
    expect(skipped.w.view().done).toBe(true);
    expect(skipped.w.view().skipProminent).toBe(false);
    const skippedCfg = skipped.w.toConfig(fresh());
    expect(skippedCfg.arm).toBeNull();
    expect(skippedCfg.axes).toEqual(fresh().axes);
    expect(skippedCfg.buttonMap).toEqual(fresh().buttonMap);
    expect(skipped.w.view(fresh()).summaryLines.join('\n')).toContain('未設定');

    const found = at('arm');
    expect(found.w.view().skipProminent).toBe(true);
    found.w.sample(pad([0, 0, 0, 0], [true, false, false, false]), found.t + 1);
    expect(found.w.view().seenText).toContain('按鈕 0');
    expect(found.w.confirm(found.t + 2)).toBe(true);
    const foundCfg = found.w.toConfig(fresh());
    expect(foundCfg.arm).toEqual({ kind: 'button', index: 0 });
    expect(foundCfg.buttonMap).toEqual(fresh().buttonMap);
    expect(foundCfg.axes).toEqual(fresh().axes);
  });

  it('即時監視器從第一步就有原始值與相對差', () => {
    const w = new CalibrationWizard();
    w.start(0);
    w.sample(pad([0.2, -0.4, 0, 0], [true]), 0);
    const view = w.view();
    expect(view.stepId).toBe('letGo');
    expect(view.axes[0]?.raw).toBeCloseTo(0.2);
    expect(view.axes[1]?.raw).toBeCloseTo(-0.4);
    expect(view.axes[0]?.deviceLabel).toBe('裝置軸 1');
    expect(view.axes[0]?.radioLabel).toBe('CH1');
    expect(view.buttons[0]?.pressed).toBe(true);
    expect(view.hatNote).toContain('按鈕');
  });
});

describe('GamepadConfigStore', () => {
  it('舊版 1.5.1 的軸與按鍵沿用，補上缺的反轉欄位', () => {
    const old = JSON.stringify({
      deadzone: 0.2,
      invertThrottle: true,
      invertPitch: false,
      axes: { throttle: 1, pitch: 3, yaw: 0, roll: 2 },
      buttonMap: { takeoff: 4, land: 5, reset: 6 },
      center: [0.1, 0, 0, 0],
      range: [0.9, 1, 1, 1],
    });
    const migrated = GamepadConfigStore.migrate(old, '1.5.1');
    expect(migrated.rewrite).toBe(true);
    expect(migrated.persistConfig).toBe(true);
    expect(migrated.config.deadzone).toBe(0.2);
    expect(migrated.config.invertThrottle).toBe(true);
    expect(migrated.config.invertYaw).toBe(false);
    expect(migrated.config.invertRoll).toBe(false);
    expect(migrated.config.center[0]).toBeCloseTo(0.1);
    expect(migrated.config.range[0]).toBeCloseTo(0.9);
    expect(migrated.config.buttonMap.takeoff).toBe(4);
    expect(migrated.config.axes).toEqual(fresh().axes);
  });

  it('版本已是現版就不重寫；1.6.0 沿用軸；壞掉的 JSON 退回預設', () => {
    const current = JSON.stringify(fresh());
    const from16 = GamepadConfigStore.migrate(current, '1.6.0');
    expect(from16.rewrite).toBe(true);
    expect(from16.config.axes).toEqual(fresh().axes);
    expect(from16.config.deadzone).toBe(0.1);
    const same = GamepadConfigStore.migrate(current, '1.7.0');
    expect(same.rewrite).toBe(false);
    expect(same.persistConfig).toBe(false);
    expect(same.config.axes).toEqual(fresh().axes);

    const broken = GamepadConfigStore.migrate('{', '1.5.1');
    expect(broken.config.axes).toEqual(fresh().axes);
    expect(broken.persistConfig).toBe(true);

    const empty = GamepadConfigStore.migrate(null, null);
    expect(empty.persistConfig).toBe(false);
    expect(empty.rewrite).toBe(true);
  });
});

describe('飛行契約', () => {
  it('解鎖欄位不進飛行迴圈，重播格式也不認識它', () => {
    const index = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
    const gamepad = readFileSync(new URL('./gamepad.ts', import.meta.url), 'utf8');
    const recording = readFileSync(
      new URL('../../../../packages/shared/src/inputRecording.ts', import.meta.url),
      'utf8',
    );
    expect(index).not.toContain('gamepadConfig.arm');
    expect(index).not.toContain('buttonReverse');
    expect(gamepad).not.toContain('gamepadConfig.arm');
    expect(gamepad).not.toContain('buttonReverse');
    expect(recording).not.toContain('arm');
  });
});
