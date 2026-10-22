/**
 * @vitest-environment happy-dom
 */
import type { RoomInfo, SoccerStateMsg, TeacherToServer } from '@creafly/shared';
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

describe('臺北賽制老師操作', () => {
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

  it('改成臺北賽制會記住，3 分鐘改成 2 分鐘', () => {
    const dash = mount();
    dash.setRooms([room({ code: 'MAIN', createdAt: 1, soccerRuleset: 'f9a' })], 'MAIN');
    const sel = document.querySelector<HTMLSelectElement>('#soccer-rules')!;
    const dur = document.querySelector<HTMLSelectElement>('#soccer-dur')!;
    expect(sel.value).toBe('f9a');
    expect(dur.value).toBe('180');
    sel.value = 'taipei';
    sel.dispatchEvent(new Event('change'));
    expect(dur.value).toBe('120');
    expect(document.querySelector('#soccer-rules-hint')!.textContent).toContain('先進第 1 球');
    expect(sent[0]).toEqual({
      type: 'room_update',
      roomCode: 'MAIN',
      settings: { soccerRuleset: 'taipei' },
    });
  });

  it('警告／扣分按鈕送 soccer_warn，結算寫出扣分與先進球', () => {
    const dash = mount();
    dash.setRooms([room({ code: 'MAIN', createdAt: 1, soccerRuleset: 'taipei' })], 'MAIN');
    const state: SoccerStateMsg = {
      type: 'soccer_state',
      status: 'running',
      mode: 'striker',
      endTime: 0,
      durationSec: 120,
      scores: { blue: 1, red: 1 },
      armed: { blue: true, red: true },
      players: [
        { id: 's1', name: '小明', emoji: '🐱', team: 'blue', striker: true },
        { id: 's2', name: '小華', emoji: '🐶', team: 'red', striker: true },
      ],
      match: {
        phase: 'period',
        period: 1,
        sets: { blue: 0, red: 0 },
        pkScores: { blue: 0, red: 0 },
        pkTurn: null,
        pkRound: 0,
        ruleset: 'taipei',
        deductions: { blue: 0, red: 0 },
        firstGoal: 'blue',
      },
    };
    dash.onSoccerMsg(state);
    document.querySelector<HTMLElement>('[data-act="warn"][data-id="s1"]')!.click();
    document.querySelector<HTMLElement>('[data-act="warn-team"][data-team="red"]')!.click();
    expect(sent).toEqual([
      { type: 'soccer_warn', studentId: 's1', reason: 'manual', deduct: true },
      { type: 'soccer_warn', team: 'red', reason: 'manual', deduct: true },
    ]);
    dash.onSoccerMsg({
      type: 'soccer_end',
      reason: 'taipei',
      winner: 'blue',
      scores: { blue: 1, red: 1 },
      players: state.players,
      match: {
        ...state.match!,
        deductions: { blue: 0, red: 0 },
        netScores: { blue: 1, red: 1 },
        firstGoal: 'blue',
      },
    });
    expect(document.querySelector<HTMLElement>('#soccer-results')!.hidden).toBe(false);
    expect(document.querySelector('#soccer-results-title')!.textContent).toBe('藍隊勝');
    const lines = document.querySelector('#soccer-results-list')!.textContent ?? '';
    expect(lines).toContain('扣分');
    expect(lines).toContain('先進球');
    expect(lines).toContain('同分');
  });
});
