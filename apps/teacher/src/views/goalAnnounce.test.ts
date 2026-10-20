/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GoalAnnounce } from '@creafly/shared';
import { GoalAnnounceOverlay } from './goalAnnounce';

afterEach(() => {
  vi.useRealTimers();
  document.getElementById('goal-announce')?.remove();
  // 清掉靜態快取，下一則測例重新掛上
  (GoalAnnounceOverlay as unknown as { root: HTMLElement | null }).root = null;
});

describe('進球公告疊層', () => {
  it('寫出隊伍、得分者與比分，烏龍寫明不算', () => {
    GoalAnnounceOverlay.show({
      team: 'red',
      byName: '小明',
      scores: { red: 2, blue: 1 },
    });
    const el = document.getElementById('goal-announce')!;
    expect(el.textContent).toContain('紅隊進球');
    expect(el.textContent).toContain('小明');
    expect(el.textContent).toContain('紅 2 : 1 藍');
    expect(el.classList.contains('is-live')).toBe(true);

    GoalAnnounceOverlay.show({
      team: 'blue',
      byName: '小華',
      scores: { red: 2, blue: 1 },
      own: true,
    });
    expect(el.textContent).toContain('這球不算');
    expect(el.textContent).toContain('小華');
    expect(el.textContent).toContain('不得分');
    expect(el.textContent).toContain('紅 2 : 1 藍');
    expect(el.classList.contains('is-own')).toBe(true);
  });

  it('停約 3 秒後淡出，再收起', () => {
    vi.useFakeTimers();
    GoalAnnounceOverlay.show({
      team: 'blue',
      byName: '',
      scores: { red: 0, blue: 1 },
    });
    const el = document.getElementById('goal-announce')!;
    vi.advanceTimersByTime(GoalAnnounce.HOLD_MS - 1);
    expect(el.classList.contains('is-on') || el.classList.contains('is-live')).toBe(true);
    vi.advanceTimersByTime(1);
    expect(el.classList.contains('is-on')).toBe(false);
    expect(el.classList.contains('is-live')).toBe(true);
    vi.advanceTimersByTime(GoalAnnounce.FADE_MS);
    expect(el.classList.contains('is-live')).toBe(false);
  });
});
