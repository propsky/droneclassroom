// 帳號學生進度本機快取 — 重載後 WS 連上前先顯示勾勾（雲端仍以 progress_sync 為準）。
import type { LevelProgress } from '@creafly/shared';
import { replaceProgressMap } from '@creafly/shared';

const LS_KEY = 'creafly_progress_cache';

interface ProgressCachePayload {
  sid: number;
  /** personal，或 class:<teamId>。不同班的進度不共用同一份快取。 */
  scope: string;
  progress: Record<string, LevelProgress>;
  savedAt: number;
}

export function progressCacheScope(
  mode: string | undefined,
  teamId: number | null | undefined,
): string {
  return mode === 'class' && teamId != null ? `class:${teamId}` : 'personal';
}

export function loadProgressCache(
  sid: number,
  scope = 'personal',
): Record<string, LevelProgress> | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw) as ProgressCachePayload;
    if (!obj || obj.sid !== sid || obj.scope !== scope || !obj.progress || typeof obj.progress !== 'object') {
      return null;
    }
    return replaceProgressMap(obj.progress);
  } catch {
    return null;
  }
}

export function saveProgressCache(
  sid: number,
  progress: Record<string, LevelProgress>,
  scope = 'personal',
): void {
  try {
    const payload: ProgressCachePayload = {
      sid,
      scope,
      progress: replaceProgressMap(progress),
      savedAt: Date.now(),
    };
    localStorage.setItem(LS_KEY, JSON.stringify(payload));
  } catch {
    /* 隱私模式等 */
  }
}

export function clearProgressCache(): void {
  try {
    localStorage.removeItem(LS_KEY);
  } catch {
    /* ignore */
  }
}
