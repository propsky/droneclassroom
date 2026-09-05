/** 學生關卡進度合併（純函數 — client / server 共用邏輯） */

export interface LevelProgress {
  bestTimeMs: number | null;
  attempts: number;
}

/** 收到 complete_ack 或本地標記完成時，合併 best / attempts */
export function mergeLevelProgress(
  cur: LevelProgress | undefined,
  timeMs: number,
): LevelProgress {
  return {
    bestTimeMs: cur?.bestTimeMs == null ? timeMs : Math.min(cur.bestTimeMs, timeMs),
    attempts: (cur?.attempts ?? 0) + 1,
  };
}

/** progress_sync 下行：整份覆蓋（伺服器為準） */
export function replaceProgressMap(
  progress: Record<string, LevelProgress>,
): Record<string, LevelProgress> {
  return { ...progress };
}
