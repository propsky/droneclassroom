import { describe, expect, it } from 'vitest';
import { ArenaRanking, ArenaResultsCopy } from './arenaRanking';

describe('大亂鬥結算名次', () => {
  it('搶氣球依氣球數，同分依代號', () => {
    const ranked = ArenaRanking.rank([
      { id: 's2', name: '乙', score: 4, caughtCount: 0 },
      { id: 's1', name: '甲', score: 4, caughtCount: 0 },
      { id: 's3', name: '丙', score: 1, caughtCount: 0 },
    ]);
    expect(ranked.map((r) => r.id)).toEqual(['s1', 's2', 's3']);
  });

  it('鬼抓人先比抓捕數，再比被抓次數，最後比代號', () => {
    const ranked = ArenaRanking.rank([
      { id: 'r2', role: 'runner', score: 0, caughtCount: 5 },
      { id: 'g2', role: 'ghost', score: 1, caughtCount: 0 },
      { id: 'r0', role: 'runner', score: 0, caughtCount: 0 },
      { id: 'g1', role: 'ghost', score: 1, caughtCount: 0 },
      { id: 'r1', role: 'runner', score: 0, caughtCount: 2 },
    ]);
    expect(ranked.map((r) => r.id)).toEqual(['g1', 'g2', 'r0', 'r1', 'r2']);
  });

  it('空清單與缺分數都排得下去', () => {
    expect(ArenaRanking.rank([])).toEqual([]);
    expect(ArenaRanking.rank([{ id: 'b' }, { id: 'a', score: 0 }]).map((r) => r.id)).toEqual([
      'a',
      'b',
    ]);
  });
});

describe('結算文案', () => {
  it('搶氣球與鬼抓人用各自的既有分數', () => {
    expect(ArenaResultsCopy.title('balloon', 'time')).toBe('搶氣球結束');
    expect(ArenaResultsCopy.stat('balloon', { score: 3 })).toBe('3 顆');
    expect(ArenaResultsCopy.title('tag', 'ghosts')).toBe('鬼隊獲勝');
    expect(ArenaResultsCopy.title('tag', 'runners')).toBe('跑者隊獲勝');
    expect(ArenaResultsCopy.stat('tag', { role: 'ghost', score: 4 })).toBe('抓到 4');
    expect(ArenaResultsCopy.stat('tag', { role: 'runner', caughtCount: 1 })).toBe('被抓 1');
    expect(ArenaResultsCopy.detail('balloon')).toContain('代號');
    expect(ArenaResultsCopy.detail('tag')).toContain('被抓較少');
  });
});
