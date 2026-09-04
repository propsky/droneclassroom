// 授權能力包 — 伺服器 welcome / room_joined 下發、localStorage 快取。
import type { Entitlement, LevelDef } from '@creafly/shared';
import { bus } from '../core/events';

const LS_ENTITLEMENT = 'creafly_entitlement';
/** 斷線後允許玩完當前關的寬限（ms） */
const OFFLINE_GRACE_MS = 30 * 60 * 1000;

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

/** 是否可載入關卡；缺資料 / open 視為全開（舊伺服器相容） */
export function canLoadLevel(levelId: string): boolean {
  const ent = loadEntitlement();
  if (!ent || ent.mode === 'open') return true;
  if (ent.graceUntil && ent.graceUntil > Date.now()) {
    if (!ent.graceLevelId || ent.graceLevelId === levelId) return true;
  }
  return ent.levelIds.includes(levelId);
}

/** 斷線時：允許在寬限內玩完當前關（enforce / demo 模式） */
export function grantOfflineGrace(levelId: string): void {
  const ent = loadEntitlement();
  if (!ent || ent.mode === 'open') return;
  applyEntitlement({
    ...ent,
    graceUntil: Date.now() + OFFLINE_GRACE_MS,
    graceLevelId: levelId,
  });
}

/** 第一個可玩的關卡 id（URL / 預設關 fallback） */
export function firstAllowedLevelId(levels: LevelDef[]): string {
  const hit = levels.find((l) => canLoadLevel(l.id));
  return hit?.id ?? levels[0]?.id ?? '1-0';
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
