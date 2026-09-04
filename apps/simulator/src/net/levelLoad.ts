// 關卡載入伺服器授權 — enforce / demo 模式換關須 WS 在線並收到 level_load_ok。
import { isInLevelGrace, isOnlineOnlyEntitlement } from '@creafly/shared';
import {
  applyLoadLevel,
  checkLevelLoadGuard,
  levelState,
  type LoadLevelOptions,
} from '../core/level';
import { toast } from '../core/events';
import { fetchLevelDefinition } from './curriculum';
import { loadEntitlement } from './entitlement';
import { sendToServer, wsState } from './ws';

const LOAD_TIMEOUT_MS = 8000;
const pending = new Map<
  string,
  { resolve: (ok: boolean) => void; timer: ReturnType<typeof setTimeout> }
>();

/** ws.ts 分派 level_load_ok / level_load_denied */
export function handleLevelLoadResponse(levelId: string, ok: boolean): void {
  const p = pending.get(levelId);
  if (!p) return;
  clearTimeout(p.timer);
  pending.delete(levelId);
  p.resolve(ok);
  if (!ok) {
    toast('🔒 無法載入此關卡', 'warning');
  }
}

/** 是否可離線載入（僅關內 grace 且為當前關） */
export function canLoadLevelOfflineGrace(levelId: string): boolean {
  const ent = loadEntitlement();
  if (!ent || !isOnlineOnlyEntitlement(ent)) return false;
  if (wsState.connected) return false;
  return levelState.current?.id === levelId && isInLevelGrace(ent, levelId);
}

/** 向伺服器請求載入關卡 */
async function requestLevelLoad(levelId: string): Promise<boolean> {
  const ent = loadEntitlement();
  if (!ent || !isOnlineOnlyEntitlement(ent)) return true;

  if (canLoadLevelOfflineGrace(levelId)) return true;

  if (!wsState.connected) {
    toast('📡 請恢復連線以載入關卡', 'warning');
    return false;
  }

  return new Promise((resolve) => {
    const existing = pending.get(levelId);
    if (existing) {
      clearTimeout(existing.timer);
      existing.resolve(false);
    }
    const timer = setTimeout(() => {
      pending.delete(levelId);
      toast('📡 載入關卡逾時，請檢查連線', 'warning');
      resolve(false);
    }, LOAD_TIMEOUT_MS);
    pending.set(levelId, { resolve, timer });
    sendToServer({ type: 'level_load_req', levelId });
  });
}

/** 載入關卡（含授權 gate + 伺服器驗證） */
export async function loadLevel(levelId: string, opts?: LoadLevelOptions): Promise<void> {
  if (!opts?.bypassGuard) {
    if (!checkLevelLoadGuard(levelId)) return;
    const ok = await requestLevelLoad(levelId);
    if (!ok) return;
  }
  if (!levelState.levels.some((l) => l.id === levelId)) {
    const def = await fetchLevelDefinition(levelId);
    if (!def) {
      toast('找不到關卡資料', 'warning');
      return;
    }
  }
  applyLoadLevel(levelId);
}
