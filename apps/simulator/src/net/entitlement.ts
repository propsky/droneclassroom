// 授權能力包 — 伺服器 welcome / room_joined 下發、localStorage 快取。
import type { Entitlement, LevelDef } from '@creafly/shared';
import {
  canLoadLevelWithEntitlement,
  firstAllowedLevelId as pickFirstAllowed,
  isOnlineOnlyEntitlement,
  withOfflineGrace,
} from '@creafly/shared';
import { bus } from '../core/events';

const LS_ENTITLEMENT = 'creafly_entitlement';
/** 斷線後允許玩完當前關的寬限（ms） */
export const OFFLINE_GRACE_MS = 30 * 60 * 1000;

let cached: Entitlement | null = null;

export function applyEntitlement(entitlement: Entitlement): void {
  cached = entitlement;
  try {
    localStorage.setItem(LS_ENTITLEMENT, JSON.stringify(entitlement));
  } catch {
    /* 隱私模式等：本場仍可用記憶體內快取 */
  }
  bus.emit('entitlement-updated', {});
}

export function loadEntitlement(): Entitlement | null {
  if (cached) return cached;
  try {
    const raw = localStorage.getItem(LS_ENTITLEMENT);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Entitlement;
    if (!parsed || typeof parsed.mode !== 'string' || !Array.isArray(parsed.levelIds)) {
      return null;
    }
    cached = parsed;
    return parsed;
  } catch {
    return null;
  }
}

export function canLoadLevel(levelId: string): boolean {
  return canLoadLevelWithEntitlement(loadEntitlement(), levelId);
}

export function isOnlineOnlyMode(): boolean {
  return isOnlineOnlyEntitlement(loadEntitlement());
}

export function grantOfflineGrace(levelId: string): void {
  const ent = loadEntitlement();
  if (!ent || ent.mode === 'open') return;
  applyEntitlement(withOfflineGrace(ent, levelId, OFFLINE_GRACE_MS));
}

export function firstAllowedLevelId(levels: LevelDef[]): string {
  return pickFirstAllowed(levels.map((l) => l.id), loadEntitlement());
}

export function clearEntitlement(): void {
  cached = null;
  try {
    localStorage.removeItem(LS_ENTITLEMENT);
  } catch {
    /* ignore */
  }
  bus.emit('entitlement-updated', {});
}
