// 教學目標精靈 — 選擇情境後一鍵生成關卡骨架。
import { LEVEL_GOAL_PRESETS } from '@creafly/shared';

export interface LevelGoalWizardOptions {
  title?: string;
  subtitle?: string;
  onSelect: (presetId: string) => void;
  onCancel?: () => void;
}

function esc(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function openLevelGoalWizard(opts: LevelGoalWizardOptions): void {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal modal-lg lvl-wizard-modal" role="dialog" aria-modal="true">
      <div class="modal-head">
        <div class="modal-head-text">
          <h2 class="modal-title">${esc(opts.title ?? '快速起稿')}</h2>
          <p class="modal-desc">${esc(opts.subtitle ?? '選擇教學目標，自動插入圈點、障礙與任務步驟')}</p>
        </div>
        <button type="button" class="btn btn-ghost btn-sm" id="lw-close" aria-label="關閉">✕</button>
      </div>
      <div class="lvl-wizard-grid" id="lw-grid">
        ${LEVEL_GOAL_PRESETS
          .map(
            (p) =>
              `<button type="button" class="lvl-wizard-card" data-preset="${p.id}">
                <span class="lvl-wizard-tag">${esc(p.tag)}</span>
                <span class="lvl-wizard-name">${esc(p.name)}</span>
                <span class="lvl-wizard-desc">${esc(p.desc)}</span>
              </button>`,
          )
          .join('')}
      </div>
      <p class="note lvl-wizard-foot">套用後仍可在編輯器微調位置；若關卡已有內容會先清空再套用。</p>
    </div>`;
  document.body.appendChild(backdrop);

  const close = (): void => {
    backdrop.remove();
    opts.onCancel?.();
  };

  backdrop.querySelector('#lw-close')?.addEventListener('click', close);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });

  let picked = false;
  backdrop.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (picked) return;
      picked = true;
      const id = btn.dataset['preset']!;
      backdrop.remove();
      opts.onSelect(id);
    });
  });

  (backdrop.querySelector('.lvl-wizard-modal') as HTMLElement)?.focus();
}
