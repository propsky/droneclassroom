/**
 * @vitest-environment happy-dom
 */
import type { RoomInfo, TeacherToServer } from '@creafly/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { renderDashboard, type DashboardView } from './dashboard';

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

describe('房間足球場地', () => {
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

  it('新增班級不選場地時不送 soccerClass', () => {
    mount();
    document.querySelector<HTMLButtonElement>('#btn-room-new')!.click();
    const form = document.querySelector<HTMLFormElement>('#room-form')!;
    (form.querySelector('#rf-name') as HTMLInputElement).value = '三年二班';
    form.requestSubmit();
    expect(sent).toEqual([{ type: 'room_create', settings: { name: '三年二班' } }]);
  });

  it('新增班級沒有賽制與場地選單，也不送這兩個欄位', () => {
    mount();
    document.querySelector<HTMLButtonElement>('#btn-room-new')!.click();
    const form = document.querySelector<HTMLFormElement>('#room-form')!;
    expect(form.querySelector('#rf-rules')).toBeNull();
    expect(form.querySelector('#rf-field')).toBeNull();
    expect(form.textContent).toContain('F9A-B');
    expect(form.textContent).toContain('不能改成大場');
    form.requestSubmit();
    expect(sent[0]).toEqual({ type: 'room_create', settings: {} });
  });

  it('舊房間寫著 f9a 與大場釘選，畫面仍是小場且不能改', () => {
    const dash = mount();
    dash.setRooms(
      [
        room({
          code: 'MAIN',
          createdAt: 1,
          soccerRuleset: 'f9a',
          soccerClass: 'F9A-A',
          soccerClassPinned: true,
        }),
      ],
      'MAIN',
    );
    expect(document.querySelector('#soccer-rules')).toBeNull();
    expect(document.querySelector('#soccer-field-hint')!.textContent).toContain('F9A-B');
    expect(document.querySelector('#soccer-field-hint')!.textContent).toContain('不能改成大場');
    expect(document.querySelector('#soccer-rules-hint')!.textContent).toContain('先進第 1 球');
    document.querySelector<HTMLButtonElement>('#btn-room-settings')!.click();
    expect(document.querySelector('#rs-field')).toBeNull();
    expect(document.querySelector('#rs-field-note')!.textContent).toContain('不能改成大場');
    document.querySelector<HTMLButtonElement>('#rs-save')!.click();
    expect(sent).toEqual([]);
  });
});
