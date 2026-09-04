// 關卡管理分頁 — 作品庫（草稿/發布）＋本班目錄（分類、學生可見、可廣播、啟用）。
import type { LevelsResponse, TeacherLevelBrief, TeamCatalogEntry, LevelDef } from '@creafly/shared';
import { applyLevelGoalPreset, getLevelGoalPreset } from '@creafly/shared';
import {
  ApiError,
  assignToCatalog,
  createTeacherLevel,
  fetchTeacherLevel,
  fetchTeacherLevels,
  fetchTeamCatalog,
  patchCatalogEntry,
  patchTeacherLevel,
  publishTeacherLevel,
} from '../api';
import { ICONS } from '../icons';
import { openPreviewModal } from '../preview';
import { toast } from '../toast';
import { openLevelEditor } from './levelEditor';
import { openLevelGoalWizard } from './levelGoalWizard';

export interface LevelsManageOptions {
  /** 目前選定班的 teamId；null = 訪客房 / 無 DB */
  getTeamId(): number | null;
  getTeamName(): string;
  /** 官方三章（建立草稿時可選模板） */
  levels: LevelsResponse | null;
  /** 目錄變更後刷新廣播下拉 */
  onCatalogUpdated(): void;
}

export interface LevelsManagePanel {
  /** 換房 / 切分頁時重載 */
  refresh(): void;
  destroy(): void;
}

function esc(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function errText(err: unknown, doing: string): string {
  if (err instanceof ApiError) {
    if (err.isNetwork) return '無法連到伺服器，請確認後端已啟動';
    if (err.status === 401 || err.status === 403) return '登入已過期，請重新登入';
    if (err.status === 409) return '此關卡已在班級目錄中';
    return `${doing}失敗（HTTP ${err.status}）`;
  }
  return `${doing}失敗，請再試一次`;
}

function statusTag(status: TeacherLevelBrief['status']): string {
  const label = status === 'published' ? '已發布' : status === 'draft' ? '草稿' : '已封存';
  return `<span class="lvl-tag lvl-tag-${status}">${label}</span>`;
}

function templateOptions(levels: LevelsResponse | null): string {
  if (!levels?.chapters.length) return '<option value="">（空白模板）</option>';
  return (
    '<option value="">（空白模板）</option>' +
    levels.chapters
      .map(
        (ch) =>
          `<optgroup label="第 ${ch.chapter} 章 ${esc(ch.name)}">` +
          ch.levels.map((l) => `<option value="${esc(l.id)}">${esc(l.id)} ${esc(l.name)}</option>`).join('') +
          `</optgroup>`,
      )
      .join('')
  );
}

export function mountLevelsManage(host: HTMLElement, opts: LevelsManageOptions): LevelsManagePanel {
  host.innerHTML = `
    <div class="card">
      <div class="card-head"><h2 class="card-title">我的作品庫</h2></div>
      <div class="card-body">
        <p class="note">建立自訂關卡草稿 → 編輯圈點與障礙 → 發布後加入本班目錄。學生端經 curriculum API 載入。</p>
        <div class="lvl-create-grid">
          <div class="field">
            <label class="field-label" for="lvl-new-title">新關卡名稱</label>
            <input id="lvl-new-title" type="text" maxlength="200" placeholder="例：期中考練習">
          </div>
          <div class="field">
            <label class="field-label" for="lvl-new-template">複製模板（選填）</label>
            <select id="lvl-new-template">${templateOptions(opts.levels)}</select>
          </div>
        </div>
      </div>
      <div class="card-actions lvl-create-actions">
        <button type="button" class="btn btn-primary" id="lvl-create">${ICONS.plus}建立草稿</button>
        <button type="button" class="btn btn-ghost" id="lvl-wizard">${ICONS.pencil}快速起稿</button>
      </div>
      <div class="lvl-scroll">
        <table class="lvl-table">
          <thead><tr><th>關卡</th><th>狀態</th><th class="right">操作</th></tr></thead>
          <tbody id="lvl-lib-tbody"><tr><td colspan="3" class="empty">載入中…</td></tr></tbody>
        </table>
      </div>
    </div>

    <div class="card">
      <div class="card-head">
        <h2 class="card-title">本班目錄</h2>
        <span class="card-sub mono" id="lvl-team-label"></span>
      </div>
      <div class="card-body">
        <p class="note" id="lvl-catalog-hint">選擇班級房間後可管理學生選單與廣播清單。</p>
      </div>
      <div class="lvl-scroll" id="lvl-catalog-wrap" hidden>
        <table class="lvl-table lvl-table-catalog">
          <thead>
            <tr>
              <th>關卡</th>
              <th>分類</th>
              <th class="center">排序</th>
              <th class="center" title="學生關卡選單是否顯示">選單</th>
              <th class="center" title="老師廣播下拉是否出現">廣播</th>
              <th class="center">啟用</th>
            </tr>
          </thead>
          <tbody id="lvl-catalog-tbody"></tbody>
        </table>
      </div>
    </div>`;

  const q = <T extends HTMLElement>(sel: string): T => host.querySelector<T>(sel)!;
  const libTbody = q<HTMLElement>('#lvl-lib-tbody');
  const catalogTbody = q<HTMLElement>('#lvl-catalog-tbody');
  const catalogWrap = q<HTMLElement>('#lvl-catalog-wrap');
  const catalogHint = q<HTMLElement>('#lvl-catalog-hint');
  const teamLabel = q<HTMLElement>('#lvl-team-label');
  const titleInput = q<HTMLInputElement>('#lvl-new-title');
  const templateSelect = q<HTMLSelectElement>('#lvl-new-template');

  let library: TeacherLevelBrief[] = [];
  let catalog: TeamCatalogEntry[] = [];
  const patchTimers = new Map<string, ReturnType<typeof setTimeout>>();

  const drawLibrary = (): void => {
    if (library.length === 0) {
      libTbody.innerHTML = '<tr><td colspan="3" class="empty">還沒有自訂關卡。在上方建立草稿開始。</td></tr>';
      return;
    }
    const teamId = opts.getTeamId();
    libTbody.innerHTML = library
      .map((l) => {
        const publishBtn =
          l.status === 'draft'
            ? `<button type="button" class="btn btn-ghost btn-sm" data-act="publish" data-id="${l.id}">${ICONS.check}發布</button>`
            : '';
        const editBtn = `<button type="button" class="btn btn-ghost btn-sm" data-act="edit" data-id="${l.id}">編輯</button>`;
        const previewBtn = `<button type="button" class="btn btn-ghost btn-sm" data-act="preview" data-id="${l.id}">${ICONS.play}預覽</button>`;
        const inCatalog = catalog.some((c) => c.levelId === l.levelId);
        const addBtn =
          l.status === 'published' && teamId && !inCatalog
            ? `<button type="button" class="btn btn-ghost btn-sm" data-act="add" data-lid="${esc(l.levelId)}">${ICONS.plus}加入本班</button>`
            : '';
        return `<tr>
          <td><span class="mono">${esc(l.levelId)}</span> ${esc(l.title)}</td>
          <td>${statusTag(l.status)}</td>
          <td class="right lvl-actions">${editBtn}${previewBtn}${publishBtn}${addBtn}</td>
        </tr>`;
      })
      .join('');
  };

  const schedulePatch = (levelId: string, body: Parameters<typeof patchCatalogEntry>[2]): void => {
    const teamId = opts.getTeamId();
    if (!teamId) return;
    const prev = patchTimers.get(levelId);
    if (prev) clearTimeout(prev);
    patchTimers.set(
      levelId,
      setTimeout(() => {
        patchTimers.delete(levelId);
        void patchCatalogEntry(teamId, levelId, body)
          .then(() => {
            opts.onCatalogUpdated();
          })
          .catch((e) => toast(errText(e, '更新目錄'), 'error'));
      }, 400),
    );
  };

  const drawCatalog = (): void => {
    const teamId = opts.getTeamId();
    if (!teamId) {
      catalogWrap.hidden = true;
      catalogHint.hidden = false;
      catalogHint.textContent = '請先開啟班級房間，才能管理本班關卡目錄。';
      teamLabel.textContent = '';
      return;
    }
    teamLabel.textContent = opts.getTeamName();
    catalogWrap.hidden = false;
    catalogHint.hidden = true;
    if (catalog.length === 0) {
      catalogTbody.innerHTML =
        '<tr><td colspan="6" class="empty">目錄是空的。發布自訂關卡後點「加入本班」。官方關卡會在開班時自動建立。</td></tr>';
      return;
    }
    catalogTbody.innerHTML = catalog
      .map(
        (e) => `<tr data-lid="${esc(e.levelId)}">
          <td><span class="mono">${esc(e.levelId)}</span> ${esc(e.title)}${e.kind === 'teacher' ? ' <span class="lvl-kind">自訂</span>' : ''}</td>
          <td><input class="lvl-inp-group" type="text" value="${esc(e.groupLabel)}" maxlength="200"></td>
          <td class="center"><input class="lvl-inp-sort mono" type="number" value="${e.sortOrder}" min="0" max="9999"></td>
          <td class="center"><input type="checkbox" class="lvl-chk-menu" ${e.visibleInMenu ? 'checked' : ''}></td>
          <td class="center"><input type="checkbox" class="lvl-chk-broadcast" ${e.teacherBroadcastable ? 'checked' : ''}></td>
          <td class="center"><input type="checkbox" class="lvl-chk-enabled" ${e.enabled ? 'checked' : ''}></td>
        </tr>`,
      )
      .join('');

    catalogTbody.querySelectorAll<HTMLTableRowElement>('tr[data-lid]').forEach((row) => {
      const levelId = row.dataset['lid']!;
      const groupInp = row.querySelector<HTMLInputElement>('.lvl-inp-group')!;
      const sortInp = row.querySelector<HTMLInputElement>('.lvl-inp-sort')!;
      const menuChk = row.querySelector<HTMLInputElement>('.lvl-chk-menu')!;
      const broadcastChk = row.querySelector<HTMLInputElement>('.lvl-chk-broadcast')!;
      const enabledChk = row.querySelector<HTMLInputElement>('.lvl-chk-enabled')!;

      groupInp.addEventListener('change', () =>
        schedulePatch(levelId, { groupLabel: groupInp.value.trim() || '本班' }),
      );
      sortInp.addEventListener('change', () =>
        schedulePatch(levelId, { sortOrder: Number(sortInp.value) || 0 }),
      );
      menuChk.addEventListener('change', () =>
        schedulePatch(levelId, { visibleInMenu: menuChk.checked }),
      );
      broadcastChk.addEventListener('change', () =>
        schedulePatch(levelId, { teacherBroadcastable: broadcastChk.checked }),
      );
      enabledChk.addEventListener('change', () =>
        schedulePatch(levelId, { enabled: enabledChk.checked }),
      );
    });
  };

  const loadLibrary = async (): Promise<void> => {
    try {
      const res = await fetchTeacherLevels();
      library = res.levels;
      drawLibrary();
    } catch (e) {
      libTbody.innerHTML = `<tr><td colspan="3" class="empty">${esc(errText(e, '載入作品庫'))}</td></tr>`;
    }
  };

  const loadCatalog = async (): Promise<void> => {
    const teamId = opts.getTeamId();
    if (!teamId) {
      catalog = [];
      drawCatalog();
      drawLibrary();
      return;
    }
    try {
      const res = await fetchTeamCatalog(teamId);
      catalog = res.entries;
      drawCatalog();
      drawLibrary();
    } catch (e) {
      catalog = [];
      catalogTbody.innerHTML = `<tr><td colspan="6" class="empty">${esc(errText(e, '載入目錄'))}</td></tr>`;
      catalogWrap.hidden = false;
    }
  };

  const refresh = (): void => {
    void loadLibrary();
    void loadCatalog();
  };

  q<HTMLButtonElement>('#lvl-create').addEventListener('click', () => {
    const title = titleInput.value.trim();
    if (!title) {
      toast('請輸入關卡名稱', 'error');
      return;
    }
    const templateLevelId = templateSelect.value || undefined;
    void createTeacherLevel({ title, templateLevelId })
      .then((l) => {
        toast(`已建立草稿 ${l.levelId}`, 'success');
        titleInput.value = '';
        templateSelect.value = '';
        void loadLibrary();
        if (!templateLevelId) {
          openLevelEditor(l.id, () => void loadLibrary(), { showWizard: true });
        }
      })
      .catch((e) => toast(errText(e, '建立草稿'), 'error'));
  });

  q<HTMLButtonElement>('#lvl-wizard').addEventListener('click', () => {
    openLevelGoalWizard({
      title: '快速建立關卡',
      subtitle: '選教學目標，自動建立草稿並開啟編輯器',
      onSelect: (presetId) => {
        const preset = getLevelGoalPreset(presetId);
        const title = titleInput.value.trim() || preset?.titleHint || '新關卡';
        void createTeacherLevel({ title })
          .then(async (l) => {
            const detail = await fetchTeacherLevel(l.id);
            const base = detail.definition as unknown as LevelDef;
            const applied = applyLevelGoalPreset(
              { ...base, id: detail.levelId, name: title },
              presetId,
              'replace',
            );
            if (applied) {
              await patchTeacherLevel(l.id, {
                title: applied.name,
                definition: applied as unknown as Record<string, unknown>,
              });
            }
            titleInput.value = '';
            toast(`已建立 ${l.levelId}：${preset?.name ?? ''}`, 'success');
            void loadLibrary();
            openLevelEditor(l.id, () => void loadLibrary());
          })
          .catch((e) => toast(errText(e, '建立'), 'error'));
      },
    });
  });

  libTbody.addEventListener('click', (ev) => {
    const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>('button[data-act]');
    if (!btn) return;
    const act = btn.dataset['act'];
    const teamId = opts.getTeamId();
    if (act === 'publish') {
      const id = Number(btn.dataset['id']);
      void publishTeacherLevel(id)
        .then(() => {
          toast('已發布，可加入本班目錄', 'success');
          void loadLibrary();
        })
        .catch((e) => toast(errText(e, '發布'), 'error'));
    } else if (act === 'edit') {
      const id = Number(btn.dataset['id']);
      openLevelEditor(id, () => void loadLibrary());
    } else if (act === 'preview') {
      const id = Number(btn.dataset['id']);
      void fetchTeacherLevel(id)
        .then((detail) => {
          const def = detail.definition as unknown as LevelDef;
          openPreviewModal({ ...def, id: detail.levelId, name: detail.title });
        })
        .catch((e) => toast(errText(e, '載入預覽'), 'error'));
    } else if (act === 'add' && teamId) {
      const levelId = btn.dataset['lid']!;
      void assignToCatalog(teamId, {
        levelId,
        groupLabel: '本班 · 自訂關卡',
        visibleInMenu: true,
        teacherBroadcastable: true,
      })
        .then(() => {
          toast('已加入本班目錄', 'success');
          void loadCatalog();
          opts.onCatalogUpdated();
        })
        .catch((e) => toast(errText(e, '加入目錄'), 'error'));
    }
  });

  refresh();

  return {
    refresh,
    destroy(): void {
      for (const t of patchTimers.values()) clearTimeout(t);
      patchTimers.clear();
      host.innerHTML = '';
    },
  };
}
