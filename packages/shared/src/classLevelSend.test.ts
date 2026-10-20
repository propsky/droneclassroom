import { describe, expect, it } from 'vitest';
import { ClassLevelSend } from './classLevelSend';

describe('ClassLevelSend', () => {
  it('活動清單含足球練習、足球對戰與大亂鬥各場地', () => {
    const ids = ClassLevelSend.activities().map((a) => a.id);
    expect(ids).toEqual([
      'activity:soccer-practice',
      'activity:soccer-match',
      'activity:arena:balloon:grid',
      'activity:arena:balloon:playground',
      'activity:arena:tag:grid',
      'activity:arena:tag:playground',
    ]);
    expect(ClassLevelSend.activities().every((a) => a.group === '活動')).toBe(true);
  });

  it('一般關卡與自訂關卡不是活動，傳送時兩邊賽局都結束', () => {
    for (const id of ['1-4', '2-3', '3-1', 'cl-12']) {
      expect(ClassLevelSend.isActivity(id)).toBe(false);
      expect(ClassLevelSend.stopsArena(id)).toBe(true);
      expect(ClassLevelSend.stopsSoccer(id)).toBe(true);
    }
  });

  it('足球練習會結束對戰與大亂鬥', () => {
    expect(ClassLevelSend.isActivity('activity:soccer-practice')).toBe(true);
    expect(ClassLevelSend.stopsArena('activity:soccer-practice')).toBe(true);
    expect(ClassLevelSend.stopsSoccer('activity:soccer-practice')).toBe(true);
  });

  it('足球對戰不結束進行中的足球，但會結束大亂鬥', () => {
    expect(ClassLevelSend.stopsArena('activity:soccer-match')).toBe(true);
    expect(ClassLevelSend.stopsSoccer('activity:soccer-match')).toBe(false);
    expect(ClassLevelSend.find('activity:soccer-match')?.session).toBe('soccer-match');
  });

  it('大亂鬥各模式不結束大亂鬥，但會結束足球', () => {
    for (const id of [
      'activity:arena:balloon:grid',
      'activity:arena:balloon:playground',
      'activity:arena:tag:grid',
      'activity:arena:tag:playground',
    ]) {
      expect(ClassLevelSend.stopsArena(id)).toBe(false);
      expect(ClassLevelSend.stopsSoccer(id)).toBe(true);
      const found = ClassLevelSend.find(id);
      expect(found?.session).toBe('arena');
      expect(found?.arenaMode).toBeTruthy();
      expect(found?.arenaField).toBeTruthy();
    }
    expect(ClassLevelSend.find('activity:arena:tag:playground')).toMatchObject({
      arenaMode: 'tag',
      arenaField: 'playground',
    });
  });

  it('無前綴別名與前後空白收成同一份 id', () => {
    expect(ClassLevelSend.canonicalId(' soccer-match ')).toBe('activity:soccer-match');
    expect(ClassLevelSend.find('arena:tag:grid')?.id).toBe('activity:arena:tag:grid');
    expect(ClassLevelSend.isActivity('soccer-practice')).toBe(true);
    expect(ClassLevelSend.stopsSoccer(' soccer-match ')).toBe(false);
    expect(ClassLevelSend.canonicalId(' 1-4 ')).toBe('1-4');
  });
});
