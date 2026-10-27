/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { TeacherToServer } from '@creafly/shared';
import { DispatchCard } from './dispatchCard';
import { renderDashboard, type DashboardView } from './dashboard';

describe('教師派送卡', () => {
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
      levels: null,
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
    view.setStudents([
      { id: 's1', name: '小明', emoji: '🐱', connected: true },
      { id: 's2', name: '小華', emoji: '🐶', connected: true },
      { id: 's3', name: '小美', emoji: '🐰', connected: false },
    ]);
    return view;
  }

  it('單人派送、勾選批次與取消都送出對應訊息', () => {
    const sent: TeacherToServer[] = [];
    mount(sent);
    document.querySelector<HTMLButtonElement>('#soccer-dispatch-list button')!.click();
    expect(sent.at(-1)).toEqual(DispatchCard.addMessage('soccer', ['s1']));

    const boxes = [
      ...document.querySelectorAll<HTMLInputElement>('#arena-dispatch-list input'),
    ];
    boxes[0]!.click();
    boxes[1]!.click();
    document.querySelector<HTMLButtonElement>('#arena-dispatch-selected')!.click();
    expect(sent.at(-1)).toEqual(DispatchCard.addMessage('arena', ['s1', 's2']));

    view!.onDispatch({
      type: 'dispatch_state',
      activity: 'soccer',
      phase: 'waiting',
      cap: 6,
      waiting: [{ id: 's1', name: '小明', emoji: '🐱' }],
    });
    const cancel = [...document.querySelectorAll<HTMLButtonElement>('#soccer-dispatch-list button')].find(
      (btn) => btn.textContent === '取消',
    );
    cancel!.click();
    expect(sent.at(-1)).toEqual(DispatchCard.cancelMessage('soccer', ['s1']));
    expect(document.querySelector('#soccer-dispatch-status')!.textContent).toContain('1／6');
  });

  it('比賽中不能再派送', () => {
    const sent: TeacherToServer[] = [];
    const board = mount(sent);
    board.onDispatch({
      type: 'dispatch_state',
      activity: 'arena',
      phase: 'live',
      cap: 8,
      waiting: [],
    });
    const add = document.querySelector<HTMLButtonElement>('#arena-dispatch-list button')!;
    expect(add.disabled).toBe(true);
    expect(document.querySelector<HTMLButtonElement>('#arena-dispatch-selected')!.disabled).toBe(true);
    expect(document.querySelector('#arena-dispatch-status')!.textContent).toContain('比賽進行中');
  });

  it('切換房間時清掉舊房的學生與等待名單', () => {
    const sent: TeacherToServer[] = [];
    mount(sent);
    view!.onDispatch({
      type: 'dispatch_state',
      activity: 'soccer',
      phase: 'waiting',
      cap: 6,
      waiting: [{ id: 's1', name: '小明', emoji: '🐱' }],
    });
    expect(document.querySelector('#soccer-dispatch-status')!.textContent).toContain('1／6');
    // 名冊列點「切房」：派送卡要清空，等新房的名單
    view!.setRooms(
      [
        { code: 'MAIN', name: '預設', count: 0, max: 30, locked: false, hasPassword: false, createdAt: 1 },
        { code: 'B2C3', name: '乙班', count: 0, max: 30, locked: false, hasPassword: false, createdAt: 2 },
      ] as never,
      'MAIN',
    );
    const chip = document.querySelector<HTMLElement>('.room-chip[data-code="B2C3"]');
    expect(chip).not.toBeNull();
    chip!.click();
    expect(document.querySelector('#soccer-dispatch-status')!.textContent).not.toContain('1／6');
    expect(document.querySelectorAll('#soccer-dispatch-list button').length).toBe(0);
  });

  it('上限常數：足球 6、大亂鬥 8', () => {
    mount([]);
    expect(DispatchCard.addMessage('soccer', ['s1']).activity).toBe('soccer');
    expect(document.body.textContent).toContain('上限 6 人');
    expect(document.body.textContent).toContain('上限 8 人');
    expect(document.body.textContent).toContain('3v3');
  });
});
