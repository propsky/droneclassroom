/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { TeacherToServer } from '@creafly/shared';
import { renderDashboard, type DashboardView } from './dashboard';

describe('大亂鬥結算蓋板', () => {
  let view: DashboardView | null = null;

  afterEach(() => {
    view?.destroy();
    view = null;
    document.body.innerHTML = '';
  });

  function mount(sent: TeacherToServer[]): DashboardView {
    const root = document.createElement('div');
    document.body.appendChild(root);
    view = renderDashboard(root, {
      info: null,
      levels: { chapters: [{ chapter: 1, name: '新手村', levels: [{ id: '1-2', name: '第二關' }] }] },
      me: null,
      resume: null,
      send: () => true,
      sendGame: (msg) => {
        sent.push(msg);
        return true;
      },
      onChangePassword: async () => {},
      onLogout: () => {},
    });
    return view;
  }

  it('時間到顯示名次，再來一輪會開賽並收起', () => {
    const sent: TeacherToServer[] = [];
    const board = mount(sent);
    board.onArenaMsg({
      type: 'arena_end',
      mode: 'tag',
      winner: 'runners',
      reason: 'time_up',
      ranking: [
        { id: 's2', name: '乙', emoji: '🐶', score: 0, role: 'runner', caughtCount: 1 },
        { id: 's1', name: '甲', emoji: '🐱', score: 2, role: 'ghost', caughtCount: 0 },
      ],
      players: [],
    });

    const overlay = document.querySelector<HTMLElement>('#arena-results')!;
    expect(overlay.hidden).toBe(false);
    expect(document.querySelector('#arena-results-title')!.textContent).toBe('跑者隊獲勝');
    const names = [...document.querySelectorAll('#arena-results-list .student-name')].map(
      (el) => el.textContent,
    );
    expect(names[0]).toContain('乙');
    expect(names[0]).toContain('跑者');
    expect(names[1]).toContain('甲');
    expect(names[1]).toContain('鬼');
    expect(document.querySelector('.arena-start')!.textContent).toContain('再來一輪');

    document.querySelector<HTMLButtonElement>('#arena-results-again')!.click();
    expect(sent).toEqual([
      { type: 'arena_start', durationSec: 180, mode: 'balloon', ghostCount: 2, field: 'grid' },
    ]);
    expect(overlay.hidden).toBe(true);
    expect(document.querySelector('.arena-start')!.textContent).toContain('開始大亂鬥');
  });

  it('前往關卡會切到關卡分頁，手動停止不蓋結算', () => {
    const board = mount([]);
    board.onArenaMsg({
      type: 'arena_end',
      mode: 'balloon',
      winner: 'time',
      reason: 'time_up',
      ranking: [{ id: 's1', name: '甲', emoji: '🐱', score: 1 }],
      players: [],
    });
    document.querySelector<HTMLButtonElement>('#arena-results-levels')!.click();
    expect(document.querySelector<HTMLElement>('#arena-results')!.hidden).toBe(true);
    expect(document.querySelector('#panel-levels')!.classList.contains('active')).toBe(true);

    board.onArenaMsg({
      type: 'arena_end',
      mode: 'balloon',
      winner: 'time',
      reason: 'teacher_stop',
      ranking: [],
      players: [],
    });
    expect(document.querySelector<HTMLElement>('#arena-results')!.hidden).toBe(true);
  });

  it('重連快照帶結算會再蓋上，倒數開始就收起', () => {
    const board = mount([]);
    board.onArenaMsg({
      type: 'arena_state',
      status: 'ended',
      mode: 'balloon',
      field: 'playground',
      endTime: 0,
      durationSec: 180,
      balloons: [],
      players: [],
      spawns: [],
      result: {
        reason: 'time_up',
        winner: 'time',
        ranking: [{ id: 's1', name: '甲', emoji: '🐱', score: 5 }],
      },
    });
    expect(document.querySelector<HTMLElement>('#arena-results')!.hidden).toBe(false);
    expect(document.querySelector('#arena-results-title')!.textContent).toBe('搶氣球結束');
    expect(document.querySelector('#arena-results-list')!.textContent).toContain('5 顆');

    board.onArenaMsg({
      type: 'arena_scores',
      scores: [],
      status: 'countdown',
      endTime: 0,
      mode: 'balloon',
      field: 'playground',
    });
    expect(document.querySelector<HTMLElement>('#arena-results')!.hidden).toBe(true);
  });
});
