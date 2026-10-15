// 名冊卡頭「管理名單」：只有持久化班級的主房可以按（DB 名單掛在 teamId 上）。
// 預設房、訪客房、分房、其他沒有班級的房間仍要看得到按鈕，但停用並說明原因，
// 旁邊給「建立班級」捷徑（沿用房間列既有的新增班級表單，不另做一套）。
import type { RoomInfo } from '@creafly/shared';

/** 可按時的滑過說明 */
export const ROSTER_MANAGE_ENABLED_TITLE = '管理班級學生名單：學生碼 / 邀請 / 新增 / 移除';

/** 預設房（伺服器開機即存在；無 DB 時的 MAIN） */
export const ROSTER_MANAGE_DEFAULT_TITLE = '預設房不能管理學生名單，請先建立班級';

/** 訪客房（班級模式下 teamId 為空；學生不帶房碼會進這間） */
export const ROSTER_MANAGE_GUEST_TITLE = '訪客房不能管理學生名單，請先建立班級';

/** 分房沒有自己的名單，名單在班級主房 */
export const ROSTER_MANAGE_SUB_TITLE = '分房沒有自己的學生名單，請到班級主房管理，或先建立班級';

/** 無 DB 時另開的記憶體房，同樣沒有班級名單 */
export const ROSTER_MANAGE_LOOSE_TITLE = '這個房間不能管理學生名單，請先建立班級';

export interface RosterManageUi {
  /** 持久化班級主房才可按 */
  enabled: boolean;
  /** 滑過提示。停用時放在外層，disabled 按鈕常常不顯示 title */
  title: string;
  /** 停用時在按鈕旁顯示「建立班級」 */
  showCreateClass: boolean;
}

/** 依目前房間決定「管理名單」可不可按、提示文案、要不要建立班級捷徑 */
export function rosterManageUi(
  room: Pick<RoomInfo, 'code' | 'teamId' | 'isMain'>,
  ctx: { teamMode: boolean; defaultCode: string | null },
): RosterManageUi {
  const isSub = room.isMain === false;
  // 與儀表板 isTeamRoom 相同：有班級清單且這間房掛著 teamId，才是持久化班級房
  const hasTeam = ctx.teamMode && room.teamId != null;
  if (hasTeam && !isSub) {
    return { enabled: true, title: ROSTER_MANAGE_ENABLED_TITLE, showCreateClass: false };
  }
  // 分房優先（即使同時是某種預設判定，分房的原因不一樣）；
  // 其次訪客房（班級模式下的空 teamId，含開機那間 MAIN）；
  // 再來才是無 DB 的預設房。
  let title = ROSTER_MANAGE_LOOSE_TITLE;
  if (isSub) title = ROSTER_MANAGE_SUB_TITLE;
  else if (ctx.teamMode && room.teamId == null) title = ROSTER_MANAGE_GUEST_TITLE;
  else if (ctx.defaultCode != null && room.code === ctx.defaultCode) title = ROSTER_MANAGE_DEFAULT_TITLE;
  return { enabled: false, title, showCreateClass: true };
}
