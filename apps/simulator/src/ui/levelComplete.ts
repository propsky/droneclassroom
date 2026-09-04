// 過關結算卡：level-complete → 顯示用時 + 「下一關 / 再玩一次 / 留在本關」。
// - 老師鎖定關卡（level-lock）時不顯示「下一關」（節奏由老師廣播控制）；
// - 換關 / 清關（老師廣播、進大亂鬥 / 足球）時自動收起；
// - 1-0 熱身關走 duration 自動跳關（core/level.ts checkDuration），不發 level-complete、不經過這裡。
import { bus } from '../core/events';
import { levelState } from '../core/level';
import { loadLevel } from '../net/levelLoad';

const $ = (id: string): HTMLElement | null => document.getElementById(id);

/** toast / 音效先播完，結算卡再出現 */
const SHOW_DELAY_MS = 900;

export function initLevelComplete(): void {
  const modal = $('level-complete');
  const body = $('level-complete-body');
  const nextBtn = $('level-complete-next') as HTMLButtonElement | null;
  const replayBtn = $('level-complete-replay') as HTMLButtonElement | null;
  const stayBtn = $('level-complete-stay') as HTMLButtonElement | null;
  if (!modal || !body || !nextBtn || !replayBtn || !stayBtn) return;

  let locked = false;
  let completedId: string | null = null;
  let showTimer: number | null = null;

  const close = (): void => {
    modal.classList.remove('show');
    if (showTimer != null) {
      clearTimeout(showTimer);
      showTimer = null;
    }
  };

  const nextIdOf = (levelId: string): string | null => {
    const idx = levelState.levels.findIndex((l) => l.id === levelId);
    return (idx >= 0 && levelState.levels[idx + 1]?.id) || null;
  };

  bus.on('level-lock', ({ locked: v }) => {
    locked = v;
  });

  bus.on('level-complete', ({ levelId, timeMs }) => {
    completedId = levelId;
    if (showTimer != null) clearTimeout(showTimer);
    showTimer = window.setTimeout(() => {
      showTimer = null;
      if (levelState.current?.id !== levelId) return; // 等待期間已被換關（老師廣播等）
      body.textContent = `用時 ${(timeMs / 1000).toFixed(1)} 秒`;
      nextBtn.style.display = nextIdOf(levelId) != null && !locked ? '' : 'none';
      modal.classList.add('show');
    }, SHOW_DELAY_MS);
  });

  bus.on('level-loaded', close);
  bus.on('level-cleared', close);

  nextBtn.addEventListener('click', () => {
    close();
    const nextId = completedId ? nextIdOf(completedId) : null;
    if (nextId) void loadLevel(nextId);
  });
  replayBtn.addEventListener('click', () => {
    close();
    if (completedId) void loadLevel(completedId);
  });
  stayBtn.addEventListener('click', close);
}
