// 老師預覽 — 將關卡 definition 寫入 sessionStorage，以 iframe 開啟學生模擬器 ?preview=1。
import type { LevelDef } from '@creafly/shared';
import { PREVIEW_LEVEL_ID, PREVIEW_LEVEL_STORAGE_KEY } from '@creafly/shared';

/** 學生模擬器根路徑（dev 時 teacher :5174 → sim :5173） */
export function simulatorPreviewUrl(): string {
  const env = import.meta.env.VITE_SIMULATOR_URL as string | undefined;
  if (env) return env.replace(/\/+$/, '') + '/?preview=1';
  if (location.port === '5174') return 'http://localhost:5173/?preview=1';
  // all-in-one：API 根目錄服務 simulator
  const root = location.origin + '/';
  return root + '?preview=1';
}

export function stashPreviewLevel(def: LevelDef): void {
  const payload = { ...def, id: PREVIEW_LEVEL_ID, name: def.name || '預覽' };
  sessionStorage.setItem(PREVIEW_LEVEL_STORAGE_KEY, JSON.stringify(payload));
}

export function openPreviewModal(def: LevelDef): void {
  stashPreviewLevel(def);
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop lvl-preview-backdrop';
  backdrop.innerHTML = `
    <div class="modal modal-xl lvl-preview-modal" role="dialog" aria-modal="true">
      <div class="modal-head">
        <div class="modal-head-text">
          <h2 class="modal-title">關卡預覽</h2>
          <p class="modal-desc">與學生端相同模擬器；預覽模式不連線、不存進度。</p>
        </div>
        <button type="button" class="btn btn-ghost btn-sm" id="lvl-preview-close">關閉</button>
      </div>
      <iframe class="lvl-preview-frame" title="關卡預覽" src="${simulatorPreviewUrl()}"></iframe>
    </div>`;
  document.body.appendChild(backdrop);
  const close = (): void => backdrop.remove();
  backdrop.querySelector('#lvl-preview-close')?.addEventListener('click', close);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });
}
