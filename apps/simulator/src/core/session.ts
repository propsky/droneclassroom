// 遊戲場次生命週期。一般關卡、大亂鬥、足球練習、足球對戰都是一種場次。
// 進入下一場之前一定先退出目前這場（含切回同一關），避免場景、計時器、
// 監聽器與物理碰撞殘留。各模式在模組載入時用 onExit 登記自己的退出實作。

export type SessionKind = 'idle' | 'level' | 'arena' | 'soccer-practice' | 'soccer-match';

export type ActiveSessionKind = Exclude<SessionKind, 'idle'>;

type ExitHook = () => void;

interface TrackedTimer {
  kind: SessionKind;
  id: ReturnType<typeof setTimeout>;
  interval: boolean;
}

/**
 * 全場唯一的場次切換點。靜態方法、不碰 DOM / Babylon。
 * 計時器經 trackTimeout / trackInterval 登記後，所屬場次退出時若還沒清掉會被清掉。
 */
export class GameSession {
  private static current: SessionKind = 'idle';
  /** >0 表示正在 enter/exit，鉤子裡再呼叫不會重入 */
  private static depth = 0;
  private static exits = new Map<ActiveSessionKind, ExitHook[]>();
  private static timers: TrackedTimer[] = [];

  static get active(): SessionKind {
    return this.current;
  }

  /** 登記某場次的退出實作（可多個，依登記順序執行）。回傳解除登記。 */
  static onExit(kind: ActiveSessionKind, hook: ExitHook): () => void {
    const list = this.exits.get(kind) ?? [];
    list.push(hook);
    this.exits.set(kind, list);
    return () => {
      const i = list.indexOf(hook);
      if (i >= 0) list.splice(i, 1);
    };
  }

  /**
   * 進入場次。目前若是別的場次，或要重進關卡（含切回同一關），先跑該場次的退出鉤子。
   * 呼叫端接著做自己的進入邏輯（此時 active 已是 next）。
   */
  static enter(next: ActiveSessionKind): void {
    if (this.depth > 0) return;
    const prev = this.current;
    const reenterLevel = next === 'level' && prev === 'level';
    if (prev !== 'idle' && (prev !== next || reenterLevel)) {
      this.depth++;
      try {
        this.runExits(prev as ActiveSessionKind);
        this.dropTracked(prev);
      } finally {
        this.depth--;
      }
    }
    this.current = next;
  }

  /** 退出指定場次。結束後若它就是目前場次，回到 idle。 */
  static exit(kind: ActiveSessionKind): void {
    if (this.depth > 0) return;
    this.depth++;
    try {
      this.runExits(kind);
      this.dropTracked(kind);
      if (this.current === kind) this.current = 'idle';
    } finally {
      this.depth--;
    }
  }

  /**
   * 退出接管型場次（大亂鬥／足球）。一般關卡保留。
   * 換房、被踢、老師重置但當下沒有關卡可重載時用。
   */
  static exitTransient(): void {
    const c = this.current;
    if (c === 'arena' || c === 'soccer-practice' || c === 'soccer-match') this.exit(c);
  }

  /** 屬於目前場次的 setTimeout。回呼開始前會自行移出帳本。 */
  static trackTimeout(fn: () => void, ms: number): ReturnType<typeof setTimeout> {
    const kind = this.current;
    let id: ReturnType<typeof setTimeout>;
    id = setTimeout(() => {
      this.forgetTimer(id);
      fn();
    }, ms);
    this.timers.push({ kind, id, interval: false });
    return id;
  }

  /** 屬於目前場次的 setInterval。 */
  static trackInterval(fn: () => void, ms: number): ReturnType<typeof setInterval> {
    const id = setInterval(fn, ms);
    this.timers.push({ kind: this.current, id, interval: true });
    return id;
  }

  /** 清掉已登記的計時器（timeout / interval 都可）。 */
  static clearTracked(id: ReturnType<typeof setTimeout> | ReturnType<typeof setInterval> | null): void {
    if (id == null) return;
    const row = this.timers.find((t) => t.id === id);
    if (row?.interval) clearInterval(id);
    else clearTimeout(id);
    this.forgetTimer(id);
  }

  /** 目前還沒清掉的計時器數（kind 省略 = 全部）。測試用來確認退出後沒有殘留。 */
  static liveTimerCount(kind?: SessionKind): number {
    if (!kind) return this.timers.length;
    return this.timers.filter((t) => t.kind === kind).length;
  }

  private static runExits(kind: ActiveSessionKind): void {
    const list = this.exits.get(kind);
    if (!list) return;
    // 拷貝：鉤子裡若解除登記，不影響這次迴圈
    for (const hook of [...list]) {
      try {
        hook();
      } catch (e) {
        console.error(`[session] exit "${kind}" threw:`, e);
      }
    }
  }

  /** 場次退出時清掉仍掛在帳本上的計時器（鉤子忘了清的保底） */
  private static dropTracked(kind: SessionKind): void {
    for (const t of this.timers) {
      if (t.kind !== kind) continue;
      if (t.interval) clearInterval(t.id);
      else clearTimeout(t.id);
    }
    this.timers = this.timers.filter((t) => t.kind !== kind);
  }

  private static forgetTimer(id: ReturnType<typeof setTimeout> | ReturnType<typeof setInterval>): void {
    this.timers = this.timers.filter((t) => t.id !== id);
  }
}
