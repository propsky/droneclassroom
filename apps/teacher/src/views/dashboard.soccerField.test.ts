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

  it('臺北預設鎖小場不釘選；改進階 F9A 後選 F9A-B 才釘選', () => {
    mount();
    document.querySelector<HTMLButtonElement>('#btn-room-new')!.click();
    const form = document.querySelector<HTMLFormElement>('#room-form')!;
    const field = form.querySelector('#rf-field') as HTMLSelectElement;
    expect(field.disabled).toBe(true);
    expect(field.value).toBe('F9A-B');
    field.value = 'F9A-B';
    form.requestSubmit();
    expect(sent[0]).toEqual({ type: 'room_create', settings: {} });

    sent.length = 0;
    document.querySelector<HTMLButtonElement>('#btn-room-new')!.click();
    const again = document.querySelector<HTMLFormElement>('#room-form')!;
    (again.querySelector('#rf-rules') as HTMLSelectElement).value = 'f9a';
    again.querySelector('#rf-rules')!.dispatchEvent(new Event('change'));
    const unlocked = again.querySelector('#rf-field') as HTMLSelectElement;
    expect(unlocked.disabled).toBe(false);
    unlocked.value = 'F9A-B';
    again.requestSubmit();
    expect(sent[0]).toEqual({
      type: 'room_create',
      settings: { soccerRuleset: 'f9a', soccerClass: 'F9A-B' },
    });
  });

  it('臺北賽制鎖住小場；進階 F9A 才能改大場', () => {
    const dash = mount();
    dash.setRooms(
      [room({ code: 'MAIN', createdAt: 1, soccerClass: 'F9A-A', soccerClassPinned: true })],
      'MAIN',
    );
    expect(document.querySelector('#soccer-field-hint')!.textContent).toContain('F9A-B');
    expect(document.querySelector('#soccer-field-hint')!.textContent).toContain('不能改成大場');
    document.querySelector<HTMLButtonElement>('#btn-room-settings')!.click();
    const locked = document.querySelector<HTMLSelectElement>('#rs-field')!;
    expect(locked.value).toBe('F9A-B');
    expect(locked.disabled).toBe(true);
    document.querySelector<HTMLButtonElement>('#rs-save')!.click();
    expect(sent).toEqual([]);

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
    document.querySelector<HTMLButtonElement>('#btn-room-settings')!.click();
    const select = document.querySelector<HTMLSelectElement>('#rs-field')!;
    expect(select.disabled).toBe(false);
    expect(select.value).toBe('F9A-A');
    select.value = 'F9A-B';
    document.querySelector<HTMLButtonElement>('#rs-save')!.click();
    expect(sent).toEqual([
      { type: 'room_update', roomCode: 'MAIN', settings: { soccerClass: 'F9A-B' } },
    ]);
  });
});
