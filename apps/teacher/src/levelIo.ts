// 關卡 JSON 匯出 / 匯入（老師備份、分享、跨班複製）。
import type { LevelDef } from '@creafly/shared';

export function parseImportedLevel(
  raw: Record<string, unknown>,
  levelId: string,
  title: string,
): LevelDef {
  const partial = raw as Partial<LevelDef>;
  return {
    ...raw,
    id: levelId,
    name: String(partial.name || title || levelId),
    intro: String(partial.intro ?? ''),
    hud: String(partial.hud ?? partial.name ?? title),
    returnHome: partial.returnHome !== false,
    freeplay: !!partial.freeplay,
    draw: !!partial.draw,
    drawHeight: partial.drawHeight,
    guide: Array.isArray(partial.guide) ? [...partial.guide] : undefined,
    view: partial.view,
    orbit: partial.orbit,
    penColors: Array.isArray(partial.penColors) ? [...partial.penColors] : undefined,
    rings: Array.isArray(partial.rings) ? [...partial.rings] : [],
    obstacles: Array.isArray(partial.obstacles) ? [...partial.obstacles] : [],
    passZones: Array.isArray(partial.passZones) ? [...partial.passZones] : [],
    balloons: Array.isArray(partial.balloons) ? [...partial.balloons] : [],
  } as LevelDef;
}

export function downloadLevelJson(def: LevelDef, filename?: string): void {
  const safeId = (def.id || 'level').replace(/[^\w.-]+/g, '_');
  const blob = new Blob([JSON.stringify(def, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename ?? `${safeId}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/** 選擇本機 .json 並解析為 LevelDef（id 強制改為目前關卡） */
export function pickAndParseLevelJson(levelId: string, title: string): Promise<LevelDef | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.addEventListener(
      'change',
      () => {
        const file = input.files?.[0];
        if (!file) {
          resolve(null);
          return;
        }
        void file
          .text()
          .then((text) => {
            const raw = JSON.parse(text) as Record<string, unknown>;
            if (!raw || typeof raw !== 'object') {
              resolve(null);
              return;
            }
            resolve(parseImportedLevel(raw, levelId, title));
          })
          .catch(() => resolve(null));
      },
      { once: true },
    );
    input.click();
  });
}
