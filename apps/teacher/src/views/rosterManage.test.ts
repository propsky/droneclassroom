import { describe, expect, it } from 'vitest';
import {
  ROSTER_MANAGE_DEFAULT_TITLE,
  ROSTER_MANAGE_ENABLED_TITLE,
  ROSTER_MANAGE_GUEST_TITLE,
  ROSTER_MANAGE_LOOSE_TITLE,
  ROSTER_MANAGE_SUB_TITLE,
  rosterManageUi,
} from './rosterManage';

describe('rosterManageUi', () => {
  it('無 DB 的預設房 MAIN 停用，並提示先建立班級', () => {
    const ui = rosterManageUi(
      { code: 'MAIN', teamId: null, isMain: true },
      { teamMode: false, defaultCode: 'MAIN' },
    );
    expect(ui.enabled).toBe(false);
    expect(ui.title).toBe(ROSTER_MANAGE_DEFAULT_TITLE);
    expect(ui.title).toBe('預設房不能管理學生名單，請先建立班級');
    expect(ui.showCreateClass).toBe(true);
  });

  it('班級模式下的訪客房（含預設 MAIN）用訪客房文案', () => {
    const ui = rosterManageUi(
      { code: 'MAIN', teamId: null, isMain: true },
      { teamMode: true, defaultCode: 'MAIN' },
    );
    expect(ui.enabled).toBe(false);
    expect(ui.title).toBe(ROSTER_MANAGE_GUEST_TITLE);
    expect(ui.showCreateClass).toBe(true);
  });

  it('分房即使有 teamId 也停用，文案指向主房或建立班級', () => {
    const ui = rosterManageUi(
      { code: 'K3M7', teamId: 4, isMain: false },
      { teamMode: true, defaultCode: 'MAIN' },
    );
    expect(ui.enabled).toBe(false);
    expect(ui.title).toBe(ROSTER_MANAGE_SUB_TITLE);
    expect(ui.showCreateClass).toBe(true);
  });

  it('沒有 teamId 的其他房間停用', () => {
    const ui = rosterManageUi(
      { code: 'Q8WZ', teamId: null, isMain: true },
      { teamMode: false, defaultCode: 'MAIN' },
    );
    expect(ui.enabled).toBe(false);
    expect(ui.title).toBe(ROSTER_MANAGE_LOOSE_TITLE);
    expect(ui.showCreateClass).toBe(true);
  });

  it('持久化班級主房可按，不顯示建立班級捷徑', () => {
    const ui = rosterManageUi(
      { code: 'AB12', teamId: 4, isMain: true },
      { teamMode: true, defaultCode: 'MAIN' },
    );
    expect(ui.enabled).toBe(true);
    expect(ui.title).toBe(ROSTER_MANAGE_ENABLED_TITLE);
    expect(ui.showCreateClass).toBe(false);
  });

  it('isMain 缺省的班級房仍視為主房', () => {
    const ui = rosterManageUi(
      { code: 'AB12', teamId: 4 },
      { teamMode: true, defaultCode: 'MAIN' },
    );
    expect(ui.enabled).toBe(true);
    expect(ui.showCreateClass).toBe(false);
  });
});
