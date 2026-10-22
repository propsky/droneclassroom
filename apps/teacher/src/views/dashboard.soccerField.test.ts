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

  it('新增班級選 F9A-B 會釘選', () => {
    mount();
    document.querySelector<HTMLButtonElement>('#btn-room-new')!.click();
    const form = document.querySelector<HTMLFormElement>('#room-form')!;
    (form.querySelector('#rf-field') as HTMLSelectElement).value = 'F9A-B';
    form.requestSubmit();
    expect(sent[0]).toEqual({ type: 'room_create', settings: { soccerClass: 'F9A-B' } });
  });

  it('設定改成 F9A-B，比賽中則不能改', () => {
    const dash = mount();
    dash.setRooms(
      [room({ code: 'MAIN', createdAt: 1, soccerClass: 'F9A-A', soccerClassPinned: false })],
      'MAIN',
    );
    expect(document.querySelector('#soccer-field-hint')!.textContent).toContain('F9A-A');
    document.querySelector<HTMLButtonElement>('#btn-room-settings')!.click();
    const select = document.querySelector<HTMLSelectElement>('#rs-field')!;
    expect(select.value).toBe('');
    expect(select.disabled).toBe(false);
    select.value = 'F9A-B';
    document.querySelector<HTMLButtonElement>('#rs-save')!.click();
    expect(sent).toEqual([
      { type: 'room_update', roomCode: 'MAIN', settings: { soccerClass: 'F9A-B' } },
    ]);

    sent.length = 0;
    dash.setRooms(
      [
        room({
          code: 'MAIN',
          createdAt: 1,
          soccerClass: 'F9A-B',
          soccerClassPinned: true,
          soccerStatus: 'running',
        }),
      ],
      'MAIN',
    );
    expect(document.querySelector('#room-flags')!.textContent).toContain('F9A-B');
    document.querySelector<HTMLButtonElement>('#btn-room-settings')!.click();
    const locked = document.querySelector<HTMLSelectElement>('#rs-field')!;
    expect(locked.value).toBe('F9A-B');
    expect(locked.disabled).toBe(true);
    expect(document.querySelector('#rs-field-note')!.textContent).toContain('比賽進行中');
    document.querySelector<HTMLButtonElement>('#rs-save')!.click();
    expect(sent).toEqual([]);
  });
});
