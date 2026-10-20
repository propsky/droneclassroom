// 老師「全班載入此關卡」的目的地。
// 一般關卡沿用 chapter / cl-* id。足球、大亂鬥不是 chapter JSON，
// 以前不會出現在可傳送清單，學生端也只認得已載入的關卡 id。

export type ActivitySession = 'soccer-practice' | 'soccer-match' | 'arena';
export type ArenaPlayMode = 'balloon' | 'tag';
export type ArenaFieldId = 'grid' | 'playground';

export interface ActivityDestination {
  /** 廣播 load_level 用的穩定 id */
  id: string;
  title: string;
  group: string;
  session: ActivitySession;
  arenaMode?: ArenaPlayMode;
  arenaField?: ArenaFieldId;
}

const GROUP = '活動';

const ACTIVITIES: readonly ActivityDestination[] = [
  {
    id: 'activity:soccer-practice',
    title: '足球練習',
    group: GROUP,
    session: 'soccer-practice',
  },
  {
    id: 'activity:soccer-match',
    title: '足球對戰',
    group: GROUP,
    session: 'soccer-match',
  },
  {
    id: 'activity:arena:balloon:grid',
    title: '大亂鬥・搶氣球（格線）',
    group: GROUP,
    session: 'arena',
    arenaMode: 'balloon',
    arenaField: 'grid',
  },
  {
    id: 'activity:arena:balloon:playground',
    title: '大亂鬥・搶氣球（遊樂場）',
    group: GROUP,
    session: 'arena',
    arenaMode: 'balloon',
    arenaField: 'playground',
  },
  {
    id: 'activity:arena:tag:grid',
    title: '大亂鬥・鬼抓人（格線）',
    group: GROUP,
    session: 'arena',
    arenaMode: 'tag',
    arenaField: 'grid',
  },
  {
    id: 'activity:arena:tag:playground',
    title: '大亂鬥・鬼抓人（遊樂場）',
    group: GROUP,
    session: 'arena',
    arenaMode: 'tag',
    arenaField: 'playground',
  },
];

/** 沒有 activity: 前綴的舊寫法，正規化成同一份 id。 */
const ALIASES: Readonly<Record<string, string>> = {
  'soccer-practice': 'activity:soccer-practice',
  'soccer-match': 'activity:soccer-match',
  'arena:balloon:grid': 'activity:arena:balloon:grid',
  'arena:balloon:playground': 'activity:arena:balloon:playground',
  'arena:tag:grid': 'activity:arena:tag:grid',
  'arena:tag:playground': 'activity:arena:tag:playground',
};

/**
 * 全班傳送到哪一關。靜態方法、不碰網路。
 * 一般關卡 id 原樣保留；活動 id（含無前綴別名）解析成場次。
 */
export class ClassLevelSend {
  static readonly groupLabel = GROUP;

  static activities(): readonly ActivityDestination[] {
    return ACTIVITIES;
  }

  /** 去掉空白，並把無前綴別名收成 activity:*。一般關卡 id 不動。 */
  static canonicalId(levelId: string): string {
    const trimmed = levelId.trim();
    return ALIASES[trimmed] ?? trimmed;
  }

  static find(levelId: string): ActivityDestination | null {
    const id = this.canonicalId(levelId);
    return ACTIVITIES.find((a) => a.id === id) ?? null;
  }

  static isActivity(levelId: string): boolean {
    return this.find(levelId) !== null;
  }

  /**
   * 傳送到這個目的地時，要不要先結束大亂鬥。
   * 送進大亂鬥本身不結束進行中的那一場（還沒進場的人要加入）。
   * 一般關卡與其他活動要結束。
   */
  static stopsArena(levelId: string): boolean {
    const activity = this.find(levelId);
    if (!activity) return true;
    return activity.session !== 'arena';
  }

  /**
   * 傳送到這個目的地時，要不要先結束足球對戰。
   * 送進足球對戰不結束進行中的比賽；練習與一般關卡要結束。
   */
  static stopsSoccer(levelId: string): boolean {
    const activity = this.find(levelId);
    if (!activity) return true;
    return activity.session !== 'soccer-match';
  }
}
