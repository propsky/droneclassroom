// 授權 / 能力包 — 伺服器下發、client 快取；與身份（訪客/帳號）分離。
// mode:
//   open     — 測試 / 無 DB / ENTITLEMENT_MODE=open（預設，行為與改版前相同）
//   demo     — 訪客試玩或 enforce 模式下尚未驗證帳號
//   licensed — 付費/班級帳號（完整關卡清單 + grace）

export type EntitlementMode = 'open' | 'demo' | 'licensed';

export interface Entitlement {
  mode: EntitlementMode;
  /** 目前可載入的關卡 id（如 '1-1'） */
  levelIds: string[];
  /** 是否允許持久化進度（帳號 + 伺服器入庫；訪客仍由 client 不帶 token 決定） */
  canSaveProgress: boolean;
  /** 是否允許離線完成後入佇列補傳 */
  canOfflineComplete: boolean;
  /** grace 截止（ms epoch）；未設定 = 無寬限 */
  graceUntil?: number;
  /** grace 僅針對單一關卡（斷網玩完當前關） */
  graceLevelId?: string;
  /** 伺服器簽發時間（ms epoch） */
  issuedAt: number;
}

/** enforce / demo 模式：須連網驗證（open 或無 entitlement 則否） */
export function isOnlineOnlyEntitlement(ent: Entitlement | null | undefined): boolean {
  return ent?.mode === 'demo' || ent?.mode === 'licensed';
}

/** 斷線寬限內且僅限指定關卡（關內容錯；換關仍須連網） */
export function isInLevelGrace(
  ent: Entitlement | null | undefined,
  levelId: string,
  nowMs = Date.now(),
): boolean {
  if (!ent || ent.mode === 'open') return false;
  return (
    ent.graceUntil != null &&
    ent.graceUntil > nowMs &&
    ent.graceLevelId != null &&
    ent.graceLevelId === levelId
  );
}

/** 是否可載入關卡；缺 entitlement / open 視為全開 */
export function canLoadLevelWithEntitlement(
  ent: Entitlement | null | undefined,
  levelId: string,
  nowMs = Date.now(),
): boolean {
  if (!ent || ent.mode === 'open') return true;
  if (isInLevelGrace(ent, levelId, nowMs)) return true;
  return ent.levelIds.includes(levelId);
}

/** 從清單挑第一個可玩的關卡 id */
export function firstAllowedLevelId(
  allLevelIds: readonly string[],
  ent: Entitlement | null | undefined,
  fallback = '1-0',
  nowMs = Date.now(),
): string {
  const hit = allLevelIds.find((id) => canLoadLevelWithEntitlement(ent, id, nowMs));
  return hit ?? allLevelIds[0] ?? fallback;
}

/** 斷線寬限：允許在期限內玩完指定關卡 */
export function withOfflineGrace(
  ent: Entitlement,
  levelId: string,
  graceMs: number,
  nowMs = Date.now(),
): Entitlement {
  return {
    ...ent,
    graceUntil: nowMs + graceMs,
    graceLevelId: levelId,
  };
}
