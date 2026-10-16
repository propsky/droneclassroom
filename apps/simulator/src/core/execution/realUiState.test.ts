import { describe, expect, it } from 'vitest';
import { describeRealToolbar } from './realUiState';

const base = {
  switchVisible: true,
  mode: 'sim' as const,
  connecting: false,
  link: 'bridge-down' as const,
  pinnedError: null,
  programRunning: false,
};

describe('真機工具列狀態', () => {
  it('模擬器：只留切換，執行鈕維持原本文字', () => {
    const view = describeRealToolbar(base);
    expect(view.showSwitch).toBe(true);
    expect(view.simSelected).toBe(true);
    expect(view.showRealControls).toBe(false);
    expect(view.runLabel).toBe('執行程式');
    expect(view.runIsDanger).toBe(false);
  });

  it('切換關閉時，連真機模式也不畫控制列', () => {
    const view = describeRealToolbar({ ...base, switchVisible: false, mode: 'real' });
    expect(view.showSwitch).toBe(false);
    expect(view.showRealControls).toBe(false);
    expect(view.runLabel).toBe('執行程式');
  });

  it('真機未連線是紅燈，連線中是黃燈，已連線是綠燈', () => {
    const idle = describeRealToolbar({ ...base, mode: 'real' });
    expect(idle.lamp).toBe('red');
    expect(idle.lampLabel).toBe('未連線');
    expect(idle.statusText).toBe('未連線');
    expect(idle.connectLabel).toBe('連線');

    const pending = describeRealToolbar({ ...base, mode: 'real', connecting: true });
    expect(pending.lamp).toBe('yellow');
    expect(pending.lampLabel).toBe('連線中');
    expect(pending.connectLabel).toBe('連線中');
    expect(pending.connectDisabled).toBe(true);

    const ready = describeRealToolbar({
      ...base,
      mode: 'real',
      link: 'ready',
      heightCm: 0,
      voltageV: 4.15,
    });
    expect(ready.lamp).toBe('green');
    expect(ready.lampLabel).toBe('已連線');
    expect(ready.statusText).toContain('已連線');
    expect(ready.statusText).toContain('4.15');
    expect(ready.connectLabel).toBe('中斷');
    expect(ready.runLabel).toBe('執行（真機會飛）');
    expect(ready.runIsDanger).toBe(true);
  });

  it('橋接已連但飛機沒回應是黃燈，拒絕訊息留在狀態列', () => {
    const waiting = describeRealToolbar({ ...base, mode: 'real', link: 'no-aircraft' });
    expect(waiting.lamp).toBe('yellow');
    expect(waiting.statusText).toMatch(/飛機沒有回應/);
    expect(waiting.connectLabel).toBe('中斷');

    const rejected = describeRealToolbar({
      ...base,
      mode: 'real',
      link: 'ready',
      pinnedError: '真機目前不支援前後左右移動（光流尚未就緒）',
    });
    expect(rejected.lamp).toBe('green');
    expect(rejected.statusText).toContain('前後左右');
  });

  it('程式執行中，還沒連上就不能再按連線；已連上可以中斷', () => {
    const blocked = describeRealToolbar({ ...base, mode: 'real', programRunning: true });
    expect(blocked.connectDisabled).toBe(true);
    const linked = describeRealToolbar({
      ...base,
      mode: 'real',
      link: 'ready',
      programRunning: true,
    });
    expect(linked.connectLabel).toBe('中斷');
    expect(linked.connectDisabled).toBe(false);
  });
});
