// 老師 iframe 預覽：?preview=1 從 sessionStorage 載入關卡，不連線、不存進度。
import type { LevelDef } from '@creafly/shared';
import { PREVIEW_LEVEL_ID, PREVIEW_LEVEL_STORAGE_KEY } from '@creafly/shared';

export function isPreviewMode(): boolean {
  return new URLSearchParams(location.search).get('preview') === '1';
}

export function readPreviewLevel(): LevelDef | null {
  if (!isPreviewMode()) return null;
  try {
    const raw = sessionStorage.getItem(PREVIEW_LEVEL_STORAGE_KEY);
    if (!raw) return null;
    const def = JSON.parse(raw) as LevelDef;
    return { ...def, id: PREVIEW_LEVEL_ID };
  } catch {
    return null;
  }
}
