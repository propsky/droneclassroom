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

  function manageTitle(): string {
    return document.querySelector<HTMLElement>('#manage-students-wrap')!.title;
  }

  it('預設房 MAIN：按鈕顯示但停用，提示先建立班級，捷徑沿用新增班級表單', () => {
    const dash = mount();
    dash.setRooms([room({ code: 'MAIN', createdAt: 1 })], 'MAIN');

    const btn = manageBtn();
    expect(btn.hidden).toBe(false);
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toContain('管理名單');
    expect(manageTitle()).toBe(ROSTER_MANAGE_DEFAULT_TITLE);
    expect(document.querySelector('#room-tools')!.hasAttribute('hidden')).toBe(false);

    const shortcut = createBtn();
    expect(shortcut.hidden).toBe(false);
    expect(shortcut.textContent).toContain('建立班級');
    expect(document.querySelector<HTMLFormElement>('#room-form')!.hidden).toBe(true);

    shortcut.click();
    const form = document.querySelector<HTMLFormElement>('#room-form')!;
    expect(form.hidden).toBe(false);
    document.querySelector<HTMLInputElement>('#rf-name')!.value = '三年二班';
    form.requestSubmit();
    expect(sent).toEqual([{ type: 'room_create', settings: { name: '三年二班' } }]);
  });

  it('訪客房與分房停用並用對應文案；班級主房仍可按', () => {
    const dash = mount();
    const main = room({ code: 'MAIN', createdAt: 1, teamId: null });
    const sub = room({ code: 'K3M7', name: 'A 組', createdAt: 30, teamId: 4, isMain: false });
    const klass = room({ code: 'AB12', name: '三年二班', createdAt: 20, teamId: 4, isMain: true });

    dash.setRooms([main, sub, klass], 'MAIN', [classTeam]);
    expect(manageBtn().hidden).toBe(false);
    expect(manageBtn().disabled).toBe(true);
    expect(manageTitle()).toBe(ROSTER_MANAGE_GUEST_TITLE);
    expect(createBtn().hidden).toBe(false);

    dash.setRooms([main, sub, klass], 'K3M7', [classTeam]);
    expect(manageBtn().disabled).toBe(true);
    expect(manageBtn().hidden).toBe(false);
    expect(manageTitle()).toBe(ROSTER_MANAGE_SUB_TITLE);
    expect(createBtn().hidden).toBe(false);

    dash.setRooms([main, sub, klass], 'AB12', [classTeam]);
    expect(manageBtn().disabled).toBe(false);
    expect(manageBtn().hidden).toBe(false);
    expect(manageTitle()).toBe(ROSTER_MANAGE_ENABLED_TITLE);
    expect(createBtn().hidden).toBe(true);
  });
});
