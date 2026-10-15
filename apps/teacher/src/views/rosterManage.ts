// 名冊卡頭「管理名單」：只有持久化班級的主房可以按（DB 名單掛在 teamId 上）。
// 預設房、訪客房、分房、其他沒有班級的房間仍要看得到按鈕，但停用。
// 停用原因用自訂 tooltip（hover / focus 立刻出現，不用瀏覽器 title 的延遲），
// 工具列下方另有常駐警告列，直接列出這間房做不到的功能。
// 「建立班級」沿用房間列既有的新增班級表單，不另做一套。
import type { RoomInfo } from '@creafly/shared';

/** 可按時的說明（自訂 tooltip，不走瀏覽器 title） */
export const ROSTER_MANAGE_ENABLED_TITLE = '管理班級學生名單：學生碼 / 邀請 / 新增 / 移除';

/** 預設房（伺服器開機即存在；無 DB 時的 MAIN） */
export const ROSTER_MANAGE_DEFAULT_TITLE = '預設房不能管理學生名單，請先建立班級';

/** 訪客房（班級模式下 teamId 為空；學生不帶房碼會進這間） */
export const ROSTER_MANAGE_GUEST_TITLE = '訪客房不能管理學生名單，請先建立班級';

/** 分房沒有自己的名單，名單在班級主房 */
export const ROSTER_MANAGE_SUB_TITLE = '分房沒有自己的學生名單，請到班級主房管理，或先建立班級';

/** 無 DB 時另開的記憶體房，同樣沒有班級名單 */
export const ROSTER_MANAGE_LOOSE_TITLE = '這個房間不能管理學生名單，請先建立班級';

/** 警告列列出的功能名稱（只列老師端真的做不到的） */
export const ROOM_LIMIT_ROSTER = '學生名單';
export const ROOM_LIMIT_INVITE = '寄邀請信';
export const ROOM_LIMIT_ARCHIVE = '封存班級';
export const ROOM_LIMIT_CATALOG = '本班關卡目錄';
export const ROOM_LIMIT_CLOSE = '關閉房間';

export type RoomLimitKind = 'default' | 'guest' | 'sub' | 'loose';

export interface RoomLimitBanner {
  kind: RoomLimitKind;
  /** 這間房實際不能用的功能，依序 */
  limits: readonly string[];
  /** 警告列完整文案 */
  text: string;
}

export interface RosterManageUi {
  /** 持久化班級主房才可按 */
  enabled: boolean;
  /** 自訂 tooltip 文案。停用與可按都放這裡，不寫進 title */
  title: string;
  /** 停用時在按鈕旁與警告列顯示「建立班級」 */
  showCreateClass: boolean;
  /** 沒有班級主房時的常駐警告；班級主房為 null */
  banner: RoomLimitBanner | null;
}

const NO_TEAM_LIMITS = [
  ROOM_LIMIT_ROSTER,
  ROOM_LIMIT_INVITE,
  ROOM_LIMIT_ARCHIVE,
  ROOM_LIMIT_CATALOG,
] as const;

/** 分房有 teamId：關卡目錄、關房、進度都還能用，只有名單掛在主房 */
const SUB_LIMITS = [ROOM_LIMIT_ROSTER, ROOM_LIMIT_INVITE, ROOM_LIMIT_ARCHIVE] as const;

function bannerFor(kind: RoomLimitKind, isDefaultRoom: boolean): RoomLimitBanner {
  const limits: string[] = [...(kind === 'sub' ? SUB_LIMITS : NO_TEAM_LIMITS)];
  // 關閉鈕只在「最早那間預設房」停用（dashboard 的 isDefault）；分房與另開的房關得掉
  if (isDefaultRoom) limits.push(ROOM_LIMIT_CLOSE);
  const list = limits.join('、');
  const text =
    kind === 'default'
      ? `預設房沒有班級，不能使用：${list}。`
      : kind === 'guest'
        ? `訪客房沒有班級，不能使用：${list}。`
        : kind === 'sub'
          ? `分房沒有自己的學生名單，這裡不能使用：${list}。請到班級主房操作。`
          : `這個房間沒有班級，不能使用：${list}。`;
  return { kind, limits, text };
}

/** 依目前房間決定「管理名單」可不可按、tooltip、警告列、要不要建立班級捷徑 */
export function rosterManageUi(
  room: Pick<RoomInfo, 'code' | 'teamId' | 'isMain'>,
  ctx: { teamMode: boolean; defaultCode: string | null },
): RosterManageUi {
  const isSub = room.isMain === false;
  const isDefaultRoom = ctx.defaultCode != null && room.code === ctx.defaultCode;
  // 與儀表板 isTeamRoom 相同：有班級清單且這間房掛著 teamId，才是持久化班級房
  const hasTeam = ctx.teamMode && room.teamId != null;
  if (hasTeam && !isSub) {
    return {
      enabled: true,
      title: ROSTER_MANAGE_ENABLED_TITLE,
      showCreateClass: false,
      banner: null,
    };
  }
  // 分房優先（即使同時是某種預設判定，分房的原因不一樣）；
  // 其次訪客房（班級模式下的空 teamId，含開機那間 MAIN）；
  // 再來才是無 DB 的預設房。
  let kind: RoomLimitKind = 'loose';
  let title = ROSTER_MANAGE_LOOSE_TITLE;
  if (isSub) {
    kind = 'sub';
    title = ROSTER_MANAGE_SUB_TITLE;
  } else if (ctx.teamMode && room.teamId == null) {
    kind = 'guest';
    title = ROSTER_MANAGE_GUEST_TITLE;
  } else if (isDefaultRoom) {
    kind = 'default';
    title = ROSTER_MANAGE_DEFAULT_TITLE;
  }
  return {
    enabled: false,
    title,
    showCreateClass: true,
    banner: bannerFor(kind, isDefaultRoom),
  };
}

/**
 * 自訂 tooltip：pointerenter / focusin 當下就打開，不經 setTimeout，也不用瀏覽器 title。
 * CSS 同時認 hover / focus-within，滑過與鍵盤聚焦都不必等。
 */
export function attachInstantTip(wrap: HTMLElement): void {
  const open = (): void => {
    wrap.dataset['tip'] = 'open';
  };
  const close = (): void => {
    delete wrap.dataset['tip'];
  };
  wrap.addEventListener('pointerenter', open);
  wrap.addEventListener('pointerleave', close);
  wrap.addEventListener('focusin', open);
  wrap.addEventListener('focusout', (ev) => {
    const next = ev.relatedTarget;
    if (next instanceof Node && wrap.contains(next)) return;
    close();
  });
}
