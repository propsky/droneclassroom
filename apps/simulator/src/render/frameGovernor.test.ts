import { describe, expect, it } from 'vitest';
import { DisplayPeriod, FrameGovernor, RENDER_SCALES } from './frameGovernor';

/** 依序餵 n 張間隔 dt 的畫面，回傳最後一次換級的結果與時間。 */
function feed(g: FrameGovernor, start: number, n: number, dt: number): { t: number; changed: (number | null)[] } {
  let t = start;
  const changed: (number | null)[] = [];
  for (let i = 0; i < n; i++) {
    t += dt;
    const r = g.onFrame(t);
    if (r !== null) changed.push(r);
  }
  return { t, changed };
}

describe('螢幕週期', () => {
  it('學到最短的間隔：偶爾掉幀不會把 60Hz 學成 30Hz', () => {
    const p = new DisplayPeriod();
    let t = 0;
    for (let i = 0; i < 200; i++) {
      const dt = i % 3 === 0 ? 33.4 : 16.7;
      t += dt;
      p.add(t, dt);
    }
    expect(p.ms).toBeCloseTo(16.7, 1);
  });

  it('30Hz 螢幕就是 33ms：不算慢', () => {
    const g = new FrameGovernor();
    const { changed } = feed(g, 0, 600, 33.3);
    expect(changed).toEqual([]);
    expect(g.renderScale).toBe(1);
  });
});

describe('畫質自動調整', () => {
  it('學會週期之前不判斷', () => {
    const g = new FrameGovernor();
    const { changed } = feed(g, 0, 40, 50);
    expect(changed).toEqual([]);
  });

  it('持續掉幀：每秒降一級，降到最低就停', () => {
    const g = new FrameGovernor();
    let { t } = feed(g, 0, 120, 16.7);
    const seen: number[] = [];
    for (let i = 0; i < 400; i++) {
      // 一半畫面掉幀
      t += i % 2 ? 33.4 : 16.7;
      const r = g.onFrame(t);
      if (r !== null) seen.push(r);
    }
    expect(seen).toEqual(RENDER_SCALES.slice(1));
    expect(g.renderScale).toBe(RENDER_SCALES[RENDER_SCALES.length - 1]);
  });

  it('順了 5 秒才升一級，不會一順就跳回最高', () => {
    const g = new FrameGovernor();
    let { t } = feed(g, 0, 120, 16.7);
    for (let i = 0; i < 200; i++) {
      t += i % 2 ? 33.4 : 16.7;
      g.onFrame(t);
    }
    const low = g.step;
    expect(low).toBeGreaterThan(0);
    const calm4s = feed(g, t, 240, 16.7);
    expect(g.step).toBe(low);
    const calm2s = feed(g, calm4s.t, 120, 16.7);
    expect(calm2s.changed.length).toBe(1);
    expect(g.step).toBe(low - 1);
  });

  it('切走分頁（超過 1 秒沒畫面）不算掉幀', () => {
    const g = new FrameGovernor();
    let { t } = feed(g, 0, 120, 16.7);
    for (let i = 0; i < 10; i++) {
      t += 5000;
      expect(g.onFrame(t)).toBeNull();
      t = feed(g, t, 30, 16.7).t;
    }
    expect(g.step).toBe(0);
  });

  it('關掉時只記錄、不換級', () => {
    const g = new FrameGovernor();
    g.enabled = false;
    let { t } = feed(g, 0, 120, 16.7);
    for (let i = 0; i < 400; i++) {
      t += i % 2 ? 33.4 : 16.7;
      expect(g.onFrame(t)).toBeNull();
    }
  });

  it('網址 ?governor=0 關掉，其他都開', () => {
    expect(FrameGovernor.enabledBy('?governor=0')).toBe(false);
    expect(FrameGovernor.enabledBy('?fps=1')).toBe(true);
    expect(FrameGovernor.enabledBy('')).toBe(true);
  });
});
