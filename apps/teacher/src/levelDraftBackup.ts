// 關卡編輯器本機草稿備份 — 伺服器 autosave 失敗或離線時不丟資料。
import type { LevelDef } from '@creafly/shared';

const PREFIX = 'creafly_level_draft_';

interface DraftBackup {
  level: LevelDef;
  savedAt: number;
  serverUpdatedAt: number;
}

function key(pk: number): string {
  return `${PREFIX}${pk}`;
}

export function saveDraftBackup(pk: number, level: LevelDef, serverUpdatedAt: number): void {
  try {
    const payload: DraftBackup = { level, savedAt: Date.now(), serverUpdatedAt };
    localStorage.setItem(key(pk), JSON.stringify(payload));
  } catch {
    /* 無痕模式等 */
  }
}

export function loadDraftBackup(pk: number): DraftBackup | null {
  try {
    const raw = localStorage.getItem(key(pk));
    if (!raw) return null;
    const obj = JSON.parse(raw) as DraftBackup;
    if (!obj?.level || typeof obj.savedAt !== 'number') return null;
    return obj;
  } catch {
    return null;
  }
}

export function clearDraftBackup(pk: number): void {
  try {
    localStorage.removeItem(key(pk));
  } catch {
    /* ignore */
  }
}

/** 本機備份比伺服器新（容許 2 秒時鐘誤差） */
export function backupIsNewerThanServer(backup: DraftBackup, serverUpdatedAt: number): boolean {
  return backup.savedAt > serverUpdatedAt + 2000;
}
