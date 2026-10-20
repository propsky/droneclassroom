/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TeacherBroadcastPayload } from '@creafly/shared';
import { renderDashboard, type DashboardView } from './dashboard';

describe('全班載入此關卡', () => {
  let view: DashboardView | null = null;

  afterEach(() => {
    view?.destroy();
    view = null;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  function mount(sent: TeacherBroadcastPayload[]): void {
    const root = document.createElement('div');
    document.body.appendChild(root);
    view = renderDashboard(root, {
      info: null,
      levels: {
        chapters: [{ chapter: 1, name: '新手村', levels: [{ id: '1-4', name: '鑽第一個圈' }] }],
      },
      me: null,
      resume: null,
      send: (payload) => {
        sent.push(payload);
        return true;
      },
      sendGame: () => true,
      onChangePassword: async () => {},
      onLogout: () => {},
    });
  }

  it('一般關卡與足球、大亂鬥都會送出 load_level', () => {
    const sent: TeacherBroadcastPayload[] = [];
    mount(sent);
    const select = document.querySelector<HTMLSelectElement>('#level-select')!;
    const button = document.querySelector<HTMLButtonElement>('#btn-load-level')!;
    expect([...select.options].map((o) => o.value)).toEqual(
      expect.arrayContaining([
        '1-4',
        'activity:soccer-practice',
        'activity:soccer-match',
        'activity:arena:balloon:grid',
        'activity:arena:tag:playground',
      ]),
    );

    select.value = '1-4';
    button.click();
    select.value = 'activity:soccer-match';
    button.click();
    select.value = 'activity:arena:tag:playground';
    button.click();

    expect(sent).toEqual([
      { type: 'load_level', levelId: '1-4' },
      { type: 'load_level', levelId: 'activity:soccer-match' },
      { type: 'load_level', levelId: 'activity:arena:tag:playground' },
    ]);
  });

  it('活動不能當章節計時賽開始', () => {
    const sent: TeacherBroadcastPayload[] = [];
    mount(sent);
    const select = document.querySelector<HTMLSelectElement>('#level-select')!;
    select.value = 'activity:soccer-practice';
    document.querySelector<HTMLButtonElement>('#btn-race-start')!.click();
    expect(sent).toEqual([]);
  });
});
