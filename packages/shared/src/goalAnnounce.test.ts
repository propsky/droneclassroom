import { describe, expect, it } from 'vitest';
import { GoalAnnounce } from './goalAnnounce';

describe('進球公告', () => {
  it('比分寫成紅在前、藍在後', () => {
    expect(GoalAnnounce.scoreLine({ red: 2, blue: 1 })).toBe('紅 2 : 1 藍');
  });

  it('正規進球寫出隊伍、得分者與比分', () => {
    const copy = GoalAnnounce.copy({
      team: 'red',
      byName: '小明',
      scores: { red: 2, blue: 1 },
    });
    expect(copy.title).toBe('紅隊進球');
    expect(copy.who).toBe('小明');
    expect(copy.score).toBe('紅 2 : 1 藍');
    expect(copy.own).toBe(false);
  });

  it('不知道是誰進的就不寫名字', () => {
    const copy = GoalAnnounce.copy({
      team: 'blue',
      byName: '  ',
      scores: { red: 0, blue: 1 },
    });
    expect(copy.title).toBe('藍隊進球');
    expect(copy.who).toBe('');
  });

  it('烏龍球寫明不算，比分原樣', () => {
    const copy = GoalAnnounce.copy({
      team: 'blue',
      byName: '小華',
      scores: { red: 1, blue: 1 },
      own: true,
    });
    expect(copy.title).toBe('這球不算');
    expect(copy.who).toContain('小華');
    expect(copy.who).toContain('不得分');
    expect(copy.score).toBe('紅 1 : 1 藍');
    expect(copy.own).toBe(true);
  });

  it('停約 3 秒再淡出', () => {
    expect(GoalAnnounce.HOLD_MS).toBe(3000);
    expect(GoalAnnounce.FADE_MS).toBeGreaterThan(0);
  });
});
