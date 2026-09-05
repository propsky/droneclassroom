// 自訂關卡發布與班級目錄 — 縮短「發布 → 加入本班 → 可廣播」流程（E-03 / H-04）。
import type { TeacherLevelBrief } from '@creafly/shared';
import {
  assignToCatalog,
  fetchTeamCatalog,
  patchCatalogEntry,
  publishTeacherLevel,
} from './api';

const DEFAULT_GROUP = '本班 · 自訂關卡';

/** 發布草稿並加入本班目錄（選單 + 廣播皆開） */
export async function publishAndAddToCatalog(
  teamId: number,
  levelPk: number,
): Promise<TeacherLevelBrief> {
  const published = await publishTeacherLevel(levelPk);
  await assignToCatalog(teamId, {
    levelId: published.levelId,
    groupLabel: DEFAULT_GROUP,
    visibleInMenu: true,
    teacherBroadcastable: true,
  });
  return published;
}

/** 確保已發布關卡在本班目錄且可廣播（廣播前呼叫） */
export async function ensureCatalogForBroadcast(teamId: number, levelId: string): Promise<void> {
  const { entries } = await fetchTeamCatalog(teamId);
  const entry = entries.find((e) => e.levelId === levelId);
  if (!entry) {
    await assignToCatalog(teamId, {
      levelId,
      groupLabel: DEFAULT_GROUP,
      visibleInMenu: true,
      teacherBroadcastable: true,
    });
    return;
  }
  if (!entry.teacherBroadcastable || !entry.enabled || !entry.visibleInMenu) {
    await patchCatalogEntry(teamId, levelId, {
      teacherBroadcastable: true,
      enabled: true,
      visibleInMenu: true,
    });
  }
}
