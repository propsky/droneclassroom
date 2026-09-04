// 學生班級關卡目錄 — GET /api/student/curriculum + 動態 definition。
import type { CurriculumResponse, LevelDef, LevelDefinitionResponse } from '@creafly/shared';
import { API_BASE } from './backend';
import { levelState } from '../core/level';
import { bus } from '../core/events';
import { getStudentToken } from './studentAuth';

const definitionCache = new Map<string, LevelDef>();

/** 向伺服器拉單關 definition（官方可從靜態 JSON 已有；自訂 cl-* 必走 API） */
export async function fetchLevelDefinition(levelId: string): Promise<LevelDef | null> {
  const cached = definitionCache.get(levelId);
  if (cached) return cached;
  const inMemory = levelState.levels.find((l) => l.id === levelId);
  if (inMemory) return inMemory;
  try {
    const r = await fetch(`${API_BASE}/api/levels/${encodeURIComponent(levelId)}`);
    if (!r.ok) return null;
    const body = (await r.json()) as LevelDefinitionResponse;
    const def = body.definition as unknown as LevelDef;
    if (!def?.id) return null;
    definitionCache.set(levelId, def);
    if (!levelState.levels.some((l) => l.id === def.id)) {
      levelState.levels.push(def);
    }
    return def;
  } catch {
    return null;
  }
}

/** 帳號學生：合併伺服器班級目錄到選單（官方關仍用已載入的 definition） */
export async function mergeStudentCurriculum(): Promise<void> {
  const token = getStudentToken();
  if (!token) return;
  try {
    const r = await fetch(`${API_BASE}/api/student/curriculum`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) return;
    const data = (await r.json()) as CurriculumResponse;
    if (!data.groups?.length) return;

    const byId = new Map(levelState.levels.map((l) => [l.id, l]));
    const chapters: { chapter: number; name: string; groupLabel: string; levels: LevelDef[] }[] =
      [];

    for (let i = 0; i < data.groups.length; i++) {
      const g = data.groups[i]!;
      const levels: LevelDef[] = [];
      for (const brief of g.levels) {
        let def: LevelDef | null | undefined = byId.get(brief.levelId);
        if (!def) {
          def = await fetchLevelDefinition(brief.levelId);
        }
        if (def) levels.push(def);
      }
      if (levels.length === 0) continue;
      chapters.push({
        chapter: i + 1,
        name: g.label,
        groupLabel: g.label,
        levels,
      });
    }

    if (chapters.length === 0) return;
    levelState.chapters = chapters;
    levelState.levels = chapters.flatMap((c) => c.levels);
    bus.emit('levels-ready', { levels: levelState.levels });
  } catch {
    /* 離線或無 DB：保留靜態三章 */
  }
}
