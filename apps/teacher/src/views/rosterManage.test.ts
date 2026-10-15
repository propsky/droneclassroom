import { describe, expect, it } from 'vitest';
import {
  ROOM_LIMIT_ARCHIVE,
  ROOM_LIMIT_CATALOG,
  ROOM_LIMIT_CLOSE,
  ROOM_LIMIT_INVITE,
  ROOM_LIMIT_ROSTER,
  ROSTER_MANAGE_DEFAULT_TITLE,
  ROSTER_MANAGE_ENABLED_TITLE,
  ROSTER_MANAGE_GUEST_TITLE,
  ROSTER_MANAGE_LOOSE_TITLE,
  ROSTER_MANAGE_SUB_TITLE,
  rosterManageUi,
} from './rosterManage';

const NO_TEAM = [ROOM_LIMIT_ROSTER, ROOM_LIMIT_INVITE, ROOM_LIMIT_ARCHIVE, ROOM_LIMIT_CATALOG];
const SUB_ONLY = [ROOM_LIMIT_ROSTER, ROOM_LIMIT_INVITE, ROOM_LIMIT_ARCHIVE];

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
    expect(ui.banner?.kind).toBe('default');
    expect(ui.banner?.limits).toEqual([...NO_TEAM, ROOM_LIMIT_CLOSE]);
    expect(ui.banner?.text).toBe(
      '預設房沒有班級，不能使用：學生名單、寄邀請信、封存班級、本班關卡目錄、關閉房間。',
    );
  });

  it('班級模式下的訪客房（含預設 MAIN）用訪客房文案', () => {
    const ui = rosterManageUi(
      { code: 'MAIN', teamId: null, isMain: true },
      { teamMode: true, defaultCode: 'MAIN' },
    );
    expect(ui.enabled).toBe(false);
    expect(ui.title).toBe(ROSTER_MANAGE_GUEST_TITLE);
    expect(ui.showCreateClass).toBe(true);
    expect(ui.banner?.kind).toBe('guest');
    expect(ui.banner?.limits).toEqual([...NO_TEAM, ROOM_LIMIT_CLOSE]);
    expect(ui.banner?.text).toBe(
      '訪客房沒有班級，不能使用：學生名單、寄邀請信、封存班級、本班關卡目錄、關閉房間。',
    );
  });

  it('不是預設房的訪客房關得掉，警告列不列關閉房間', () => {
    const ui = rosterManageUi(
      { code: 'ZZ99', teamId: null, isMain: true },
      { teamMode: true, defaultCode: 'MAIN' },
    );
    expect(ui.banner?.kind).toBe('guest');
    expect(ui.banner?.limits).toEqual(NO_TEAM);
    expect(ui.banner?.text).toBe('訪客房沒有班級，不能使用：學生名單、寄邀請信、封存班級、本班關卡目錄。');
    expect(ui.banner?.limits).not.toContain(ROOM_LIMIT_CLOSE);
    expect(ui.banner?.limits).not.toContain('進度保存');
  });

  it('分房即使有 teamId 也停用，文案指向主房或建立班級', () => {
    const ui = rosterManageUi(
      { code: 'K3M7', teamId: 4, isMain: false },
      { teamMode: true, defaultCode: 'MAIN' },
    );
    expect(ui.enabled).toBe(false);
    expect(ui.title).toBe(ROSTER_MANAGE_SUB_TITLE);
    expect(ui.showCreateClass).toBe(true);
    expect(ui.banner?.kind).toBe('sub');
    expect(ui.banner?.limits).toEqual(SUB_ONLY);
    expect(ui.banner?.text).toBe(
      '分房沒有自己的學生名單，這裡不能使用：學生名單、寄邀請信、封存班級。請到班級主房操作。',
    );
    expect(ui.banner?.limits).not.toContain(ROOM_LIMIT_CATALOG);
    expect(ui.banner?.limits).not.toContain(ROOM_LIMIT_CLOSE);
  });

  it('沒有 teamId 的其他房間停用', () => {
    const ui = rosterManageUi(
      { code: 'Q8WZ', teamId: null, isMain: true },
      { teamMode: false, defaultCode: 'MAIN' },
    );
    expect(ui.enabled).toBe(false);
    expect(ui.title).toBe(ROSTER_MANAGE_LOOSE_TITLE);
    expect(ui.showCreateClass).toBe(true);
    expect(ui.banner?.kind).toBe('loose');
    expect(ui.banner?.limits).toEqual(NO_TEAM);
    expect(ui.banner?.text).toBe('這個房間沒有班級，不能使用：學生名單、寄邀請信、封存班級、本班關卡目錄。');
  });

  it('持久化班級主房可按，不顯示建立班級捷徑', () => {
    const ui = rosterManageUi(
      { code: 'AB12', teamId: 4, isMain: true },
      { teamMode: true, defaultCode: 'MAIN' },
    );
    expect(ui.enabled).toBe(true);
    expect(ui.title).toBe(ROSTER_MANAGE_ENABLED_TITLE);
    expect(ui.showCreateClass).toBe(false);
    expect(ui.banner).toBeNull();
  });

  it('isMain 缺省的班級房仍視為主房', () => {
    const ui = rosterManageUi(
      { code: 'AB12', teamId: 4 },
      { teamMode: true, defaultCode: 'MAIN' },
    );
    expect(ui.enabled).toBe(true);
    expect(ui.showCreateClass).toBe(false);
    expect(ui.banner).toBeNull();
  });
});
