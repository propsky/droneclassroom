/**
 * @vitest-environment happy-dom
 */
import type { RoomInfo, TeacherToServer, TeamInfo } from '@creafly/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { renderDashboard, type DashboardView } from './dashboard';
import {
  ROSTER_MANAGE_DEFAULT_TITLE,
  ROSTER_MANAGE_ENABLED_TITLE,
  ROSTER_MANAGE_GUEST_TITLE,
  ROSTER_MANAGE_LOOSE_TITLE,
  ROSTER_MANAGE_SUB_TITLE,
} from './rosterManage';

function room(partial: Partial<RoomInfo> & Pick<RoomInfo, 'code' | 'createdAt'>): RoomInfo {
  return {
    name: partial.code,
    hasPassword: false,
    maxStudents: 30,
    locked: false,
    studentCount: 0,
    arenaStatus: 'idle',
    soccerStatus: 'idle',
    isMain: true,
    teamId: null,
    ...partial,
  };
}

const classTeam: TeamInfo = {
  id: 4,
  code: 'AB12',
  name: '三年二班',
  hasPassword: false,
  maxStudents: 40,
  locked: false,
  createdAt: 20,
  open: true,
};

describe('名冊卡頭管理名單', () => {
  let view: DashboardView | null = null;
  const sent: TeacherToServer[] = [];

  afterEach(() => {
    view?.destroy();
    view = null;
    sent.length = 0;
    document.body.innerHTML = '';
  });

  function mount(): DashboardView {
    const root = document.createElement('div');
    document.body.appendChild(root);
    view = renderDashboard(root, {
      info: null,
      levels: null,
      me: null,
      resume: null,
      send: () => false,
      sendGame: (msg) => {
        sent.push(msg);
        return true;
      },
      onChangePassword: async () => {},
      onLogout: () => {},
    });
    return view;
  }

  function manageBtn(): HTMLButtonElement {
    return document.querySelector<HTMLButtonElement>('#btn-manage-students')!;
  }

  function createBtn(): HTMLButtonElement {
    return document.querySelector<HTMLButtonElement>('#btn-create-class')!;
  }

  function manageWrap(): HTMLElement {
    return document.querySelector<HTMLElement>('#manage-students-wrap')!;
  }

  function manageTip(): HTMLElement {
    return document.querySelector<HTMLElement>('#manage-students-tip')!;
  }

  function limitBar(): HTMLElement {
    return document.querySelector<HTMLElement>('#room-limit')!;
  }

  it('預設房 MAIN：按鈕顯示但停用，提示先建立班級，捷徑沿用新增班級表單', () => {
    const dash = mount();
    dash.setRooms([room({ code: 'MAIN', createdAt: 1 })], 'MAIN');

    const btn = manageBtn();
    expect(btn.hidden).toBe(false);
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toContain('管理名單');
    expect(manageTip().textContent).toBe(ROSTER_MANAGE_DEFAULT_TITLE);
    expect(manageTip().getAttribute('role')).toBe('tooltip');
    expect(manageWrap().hasAttribute('title')).toBe(false);
    expect(btn.hasAttribute('title')).toBe(false);
    expect(manageWrap().tabIndex).toBe(0);
    expect(document.querySelector('#room-tools')!.hasAttribute('hidden')).toBe(false);

    const bar = limitBar();
    expect(bar.hidden).toBe(false);
    expect(bar.dataset['kind']).toBe('default');
    expect(bar.textContent).toContain(
      '預設房沒有班級，不能使用：學生名單、寄邀請信、封存班級、本班關卡目錄、關閉房間。',
    );
    const barCreate = document.querySelector<HTMLButtonElement>('#btn-room-limit-create')!;
    expect(barCreate.textContent).toContain('建立班級');

    const shortcut = createBtn();
    expect(shortcut.hidden).toBe(false);
    expect(shortcut.textContent).toContain('建立班級');
    expect(document.querySelector<HTMLFormElement>('#room-form')!.hidden).toBe(true);

    shortcut.click();
    const form = document.querySelector<HTMLFormElement>('#room-form')!;
    expect(form.hidden).toBe(false);
    document.querySelector<HTMLButtonElement>('#rf-cancel')!.click();
    expect(form.hidden).toBe(true);

    barCreate.click();
    expect(form.hidden).toBe(false);
    document.querySelector<HTMLInputElement>('#rf-name')!.value = '三年二班';
    form.requestSubmit();
    expect(sent).toEqual([{ type: 'room_create', settings: { name: '三年二班' } }]);
  });

  it('停用時滑過與聚焦都立刻打開 tooltip，沒有延遲', () => {
    const dash = mount();
    dash.setRooms([room({ code: 'MAIN', createdAt: 1 })], 'MAIN');
    const wrap = manageWrap();
    expect(wrap.dataset['tip']).toBeUndefined();

    wrap.dispatchEvent(new Event('pointerenter'));
    expect(wrap.dataset['tip']).toBe('open');
    wrap.dispatchEvent(new Event('pointerleave'));
    expect(wrap.dataset['tip']).toBeUndefined();

    wrap.focus();
    expect(document.activeElement).toBe(wrap);
    expect(wrap.dataset['tip']).toBe('open');
    wrap.blur();
    expect(wrap.dataset['tip']).toBeUndefined();
  });

  it('訪客房與分房停用並用對應文案；班級主房仍可按', () => {
    const dash = mount();
    const main = room({ code: 'MAIN', createdAt: 1, teamId: null });
    const sub = room({ code: 'K3M7', name: 'A 組', createdAt: 30, teamId: 4, isMain: false });
    const klass = room({ code: 'AB12', name: '三年二班', createdAt: 20, teamId: 4, isMain: true });

    dash.setRooms([main, sub, klass], 'MAIN', [classTeam]);
    expect(manageBtn().hidden).toBe(false);
    expect(manageBtn().disabled).toBe(true);
    expect(manageTip().textContent).toBe(ROSTER_MANAGE_GUEST_TITLE);
    expect(manageWrap().hasAttribute('title')).toBe(false);
    expect(createBtn().hidden).toBe(false);
    expect(limitBar().hidden).toBe(false);
    expect(limitBar().dataset['kind']).toBe('guest');
    expect(limitBar().textContent).toContain('訪客房沒有班級，不能使用：學生名單、寄邀請信、封存班級、本班關卡目錄、關閉房間。');

    dash.setRooms([main, sub, klass], 'K3M7', [classTeam]);
    expect(manageBtn().disabled).toBe(true);
    expect(manageBtn().hidden).toBe(false);
    expect(manageTip().textContent).toBe(ROSTER_MANAGE_SUB_TITLE);
    expect(createBtn().hidden).toBe(false);
    expect(limitBar().hidden).toBe(false);
    expect(limitBar().dataset['kind']).toBe('sub');
    expect(limitBar().textContent).toContain('分房沒有自己的學生名單，這裡不能使用：學生名單、寄邀請信、封存班級。請到班級主房操作。');
    expect(limitBar().textContent).not.toContain('本班關卡目錄');

    dash.setRooms([main, sub, klass], 'AB12', [classTeam]);
    expect(manageBtn().disabled).toBe(false);
    expect(manageBtn().hidden).toBe(false);
    expect(manageTip().textContent).toBe(ROSTER_MANAGE_ENABLED_TITLE);
    expect(manageBtn().hasAttribute('title')).toBe(false);
    expect(manageWrap().tabIndex).toBe(-1);
    expect(createBtn().hidden).toBe(true);
    expect(limitBar().hidden).toBe(true);
    expect(document.querySelector('#room-limit-text')!.textContent).toBe('');
  });

  it('沒有班級的其他房間用對應警告列', () => {
    const dash = mount();
    dash.setRooms(
      [room({ code: 'MAIN', createdAt: 1 }), room({ code: 'Q8WZ', name: '臨時房', createdAt: 5 })],
      'Q8WZ',
    );
    expect(manageBtn().disabled).toBe(true);
    expect(manageTip().textContent).toBe(ROSTER_MANAGE_LOOSE_TITLE);
    expect(limitBar().dataset['kind']).toBe('loose');
    expect(limitBar().textContent).toContain('這個房間沒有班級，不能使用：學生名單、寄邀請信、封存班級、本班關卡目錄。');
    expect(limitBar().textContent).not.toContain('關閉房間');
  });
});
