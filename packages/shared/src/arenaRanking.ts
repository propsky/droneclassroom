// 大亂鬥時間到的名次。搶氣球與鬼抓人都沿用既有的 score，不另設分數。
//
// 排序（全端同一套，與加入順序無關）：
// 1. score 高者在前。
//    搶氣球：score = 戳破的氣球數。
//    鬼抓人：score = 鬼的抓捕數。跑者的 score 維持 0，所以有抓到人的鬼排在跑者前面。
// 2. score 相同時，caughtCount 少者在前。
//    搶氣球這欄是 0，不改變順序。
//    鬼抓人用來把被抓較少的跑者排在同樣 0 分的跑者前面。鬼的 caughtCount 是 0，不拆開鬼與鬼。
// 3. 仍相同則依玩家 id 字串升冪。id 由伺服器發給，重連不會改排名。

export interface ArenaRankable {
  id: string;
  score?: number;
  caughtCount?: number;
}

export type ArenaResultMode = 'balloon' | 'tag';
export type ArenaResultWinner = 'time' | 'ghosts' | 'runners';

/** 時間到結算的名次。靜態方法，不碰對戰狀態。 */
export class ArenaRanking {
  static compare(a: ArenaRankable, b: ArenaRankable): number {
    const byScore = (b.score ?? 0) - (a.score ?? 0);
    if (byScore !== 0) return byScore;
    const byCaught = (a.caughtCount ?? 0) - (b.caughtCount ?? 0);
    if (byCaught !== 0) return byCaught;
    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    return 0;
  }

  static rank<T extends ArenaRankable>(entries: readonly T[]): T[] {
    return [...entries].sort((a, b) => ArenaRanking.compare(a, b));
  }
}

/** 結算畫面的文案。學生端與老師端共用，避免兩邊各寫一套。 */
export class ArenaResultsCopy {
  static kicker(): string {
    return '時間到';
  }

  static title(mode: ArenaResultMode, winner: ArenaResultWinner): string {
    if (mode === 'tag') return winner === 'ghosts' ? '鬼隊獲勝' : '跑者隊獲勝';
    return '搶氣球結束';
  }

  static detail(mode: ArenaResultMode): string {
    if (mode === 'tag') {
      return '依抓捕數排名。抓捕數相同時，被抓較少的人在前；還相同就依固定代號，每次都一樣。';
    }
    return '依戳破的氣球數排名。分數相同時依固定代號，每次都一樣。';
  }

  static stat(
    mode: ArenaResultMode,
    entry: { score?: number; role?: string | null; caughtCount?: number },
  ): string {
    if (mode === 'tag') {
      if (entry.role === 'ghost') return `抓到 ${entry.score ?? 0}`;
      return `被抓 ${entry.caughtCount ?? 0}`;
    }
    return `${entry.score ?? 0} 顆`;
  }

  static roleLabel(role?: string | null): string {
    if (role === 'ghost') return '鬼';
    if (role === 'runner') return '跑者';
    return '';
  }

  static waitHint(): string {
    return '無人機已停住。等待老師再來一輪，或帶到下一關。';
  }
}
