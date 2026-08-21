// 班級學生名單管理 modal — 名冊卡頭「管理名單」進來（僅班級房，訪客房無入口）。
// DB 名單（REST /api/teams/{id}/students）與 WS 即時名冊是兩回事：這裡管「帳號」——
// 名單表（學生碼大字給老師唸 / 邀請狀態 / 重寄 / 移除）＋ 批次新增（每行「名字」或「名字,email」）＋ 複製登入小抄。
// 卡片鐵律照 docs/design-system.md §5.1：卡頭工具列（複製名單 / 關閉）、動作列右對齊 primary 最右、零 emoji。
import type { StudentEntry } from '@creafly/shared';
import { ApiError, createStudents, listStudents, reinviteStudent, removeStudent } from '../api';
import { copyText } from '../clipboard';
import { ICONS } from '../icons';
import { toast } from '../toast';

export interface StudentsPanelOptions {
  /** 持久化班級 id（RoomInfo.teamId） */
  teamId: number;
  /** 班級碼 — 登入小抄「班級碼 學生碼 名字」用 */
  teamCode: string;
  teamName: string;
}

export interface StudentsPanel {
  /** 換畫面 / 重開前收掉 modal 與全域監聽 */
  destroy(): void;
}

function esc(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** 24px avatar chip（同名冊；emoji 是身分資料，收進圓底 chip 不裸排） */
function avatarChip(emoji: string): string {
  return `<span class="avatar-chip" aria-hidden="true">${esc(emoji)}</span>`;
}

/** 邀請狀態 tag：未寄（灰）/ 已寄（黃）/ 已加入（綠） */
function inviteTag(status: StudentEntry['inviteStatus']): string {
  const text = status === 'accepted' ? '已加入' : status === 'sent' ? '已寄' : '未寄';
  return `<span class="invite-tag invite-${status}">${text}</span>`;
}

/** 寬鬆 email 檢查（有 @ 有 .、無空白；嚴格驗證交給伺服器） */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 解析新增區輸入：每行「名字」或「名字,email」（頓號/全形逗號也收）；
 *  有任何一行解析失敗 → 全部不送出，錯誤逐行列出讓老師改完再送 */
export function parseStudentLines(value: string): {
  students: { name: string; email?: string }[];
  errors: string[];
} {
  const students: { name: string; email?: string }[] = [];
  const errors: string[] = [];
  value.split('\n').forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return; // 空行略過
    const parts = line.split(/[,，、]/).map((p) => p.trim());
    const name = parts[0] ?? '';
    if (!name) {
      errors.push(`第 ${i + 1} 行：缺少名字（${line}）`);
    } else if (parts.length > 2) {
      errors.push(`第 ${i + 1} 行：欄位太多，每行只能「名字」或「名字,email」（${line}）`);
    } else if (parts.length === 2 && !EMAIL_RE.test(parts[1] ?? '')) {
      errors.push(`第 ${i + 1} 行：email 格式不正確（${parts[1]}）`);
    } else {
      const email = parts[1];
      students.push(email ? { name, email } : { name });
    }
  });
  return { students, errors };
}

/** REST 失敗轉老師看得懂的文案 */
function errText(err: unknown, doing: string): string {
  if (err instanceof ApiError) {
    if (err.isNetwork) return '無法連到伺服器，請確認後端已啟動';
    if (err.status === 401 || err.status === 403) return '登入已過期，請重新登入';
    return `${doing}失敗（HTTP ${err.status}）`;
  }
  return `${doing}失敗，請再試一次`;
}

export function openStudentsPanel(opts: StudentsPanelOptions): StudentsPanel {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal modal-lg" role="dialog" aria-modal="true" aria-labelledby="stu-title">
      <div class="modal-head">
        <div class="modal-head-text">
          <h2 class="modal-title" id="stu-title">學生名單管理</h2>
          <p class="modal-desc">班級「${esc(opts.teamName)}」（<span class="mono">${esc(opts.teamCode)}</span>）—
            學生用「班級碼＋學生碼」免密碼登入；有 email 的可寄邀請信自設密碼。</p>
        </div>
        <button type="button" class="btn btn-ghost btn-sm" id="stu-close">${ICONS.x}關閉</button>
      </div>

      <section class="stu-section">
        <div class="stu-section-head">
          <h3 class="stu-section-title">名單<span class="stu-count mono" id="stu-count"></span></h3>
          <button type="button" class="btn btn-ghost btn-sm" id="stu-copy" title="逐行複製「班級碼 學生碼 名字」，貼到任何地方列印發給學生">${ICONS.copy}複製名單</button>
        </div>
        <div class="stu-scroll">
          <table class="stu-table">
            <thead>
              <tr><th>學生碼</th><th>學生</th><th>Email</th><th>邀請</th><th class="right"></th></tr>
            </thead>
            <tbody id="stu-tbody"><tr><td colspan="5" class="empty">載入名單中…</td></tr></tbody>
          </table>
        </div>
      </section>

      <section class="stu-section">
        <div class="stu-section-head"><h3 class="stu-section-title">新增學生</h3></div>
        <div class="field">
          <label class="field-label" for="stu-input">每行一位：名字 或 名字,email（例：王小明 或 林小華,hua@example.com）</label>
          <textarea id="stu-input" rows="4" placeholder="王小明&#10;林小華,hua@example.com"></textarea>
        </div>
        <label class="check-row"><input type="checkbox" id="stu-send-invites" checked>建立後寄邀請信給有 email 的學生</label>
        <div class="stu-errors" id="stu-errors" role="alert" hidden></div>
        <div class="modal-actions">
          <button type="button" class="btn btn-primary" id="stu-add">${ICONS.plus}新增學生</button>
        </div>
      </section>
    </div>`;
  document.body.appendChild(backdrop);

  const q = <T extends HTMLElement>(sel: string): T => backdrop.querySelector<T>(sel)!;
  const tbody = q<HTMLElement>('#stu-tbody');
  const countEl = q<HTMLElement>('#stu-count');
  const input = q<HTMLTextAreaElement>('#stu-input');
  const sendInvitesCk = q<HTMLInputElement>('#stu-send-invites');
  const errorsEl = q<HTMLElement>('#stu-errors');
  const addBtn = q<HTMLButtonElement>('#stu-add');

  /** 目前名單（active；removed 不列） */
  let students: StudentEntry[] = [];

  const drawList = (): void => {
    countEl.textContent = students.length > 0 ? String(students.length) : '';
    if (students.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty">還沒有學生。在下方逐行輸入名字即可建立。</td></tr>';
      return;
    }
    tbody.innerHTML = students
      .map((s) => {
        const reinvite =
          s.email && s.inviteStatus !== 'accepted'
            ? `<button type="button" class="btn btn-ghost btn-sm" data-act="reinvite" data-id="${s.id}">${ICONS.send}重寄邀請</button>`
            : '';
        return `<tr>
          <td class="stu-code mono">${esc(s.studentCode)}</td>
          <td><span class="student-cell">${avatarChip(s.emoji)}<span class="student-name">${esc(s.name)}</span></span></td>
          <td class="stu-email">${s.email ? esc(s.email) : '—'}</td>
          <td>${inviteTag(s.inviteStatus)}</td>
          <td class="right stu-act">${reinvite}<button type="button" class="btn btn-danger btn-sm" data-act="remove" data-id="${s.id}" data-name="${esc(s.name)}" data-code="${esc(s.studentCode)}">移除</button></td>
        </tr>`;
      })
      .join('');
  };

  const load = async (): Promise<void> => {
    try {
      const res = await listStudents(opts.teamId);
      students = res.students.filter((s) => s.status === 'active');
      drawList();
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="5" class="empty">${esc(errText(err, '載入名單'))}</td></tr>`;
    }
  };
  void load();

  // ---- 名單表操作（事件代理：重寄邀請 / 移除）----
  tbody.addEventListener('click', (ev) => {
    const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>('[data-act]');
    if (!btn) return;
    const id = Number(btn.dataset['id']);
    if (!Number.isFinite(id)) return;
    if (btn.dataset['act'] === 'reinvite') {
      btn.disabled = true;
      const email = students.find((s) => s.id === id)?.email ?? '';
      void reinviteStudent(id)
        .then((res) => {
          if (res.sent) {
            toast(`已重寄邀請信給 ${email}`, 'success');
            return load();
          }
          toast('邀請信寄送失敗，請稍後再試', 'error');
          btn.disabled = false;
          return undefined;
        })
        .catch((err: unknown) => {
          toast(errText(err, '重寄邀請'), 'error');
          btn.disabled = false;
        });
    } else if (btn.dataset['act'] === 'remove') {
      const name = btn.dataset['name'] || '?';
      const code = btn.dataset['code'] || '';
      if (!confirm(`確定移除「${name}」（學生碼 ${code}）？\n移除後無法再登入；學習紀錄保留。`)) return;
      btn.disabled = true;
      void removeStudent(id)
        .then(() => {
          toast(`已移除 ${name}`, 'success');
          return load();
        })
        .catch((err: unknown) => {
          toast(errText(err, '移除'), 'error');
          btn.disabled = false;
        });
    }
  });

  // ---- 複製登入小抄：逐行「班級碼 學生碼 名字」（老師貼到任何地方印，不做 PDF）----
  q<HTMLButtonElement>('#stu-copy').addEventListener('click', () => {
    if (students.length === 0) {
      toast('名單是空的，先新增學生', 'error');
      return;
    }
    const lines = students.map((s) => `${opts.teamCode} ${s.studentCode} ${s.name}`).join('\n');
    copyText(lines, `已複製 ${students.length} 位學生的登入名單`);
  });

  // ---- 新增區：解析 → 全對才送 createStudents；錯誤逐行列出 ----
  const showErrors = (list: string[]): void => {
    errorsEl.hidden = list.length === 0;
    errorsEl.innerHTML = list.map((e) => `<div>${esc(e)}</div>`).join('');
  };
  addBtn.addEventListener('click', () => {
    const { students: parsed, errors } = parseStudentLines(input.value);
    if (errors.length > 0) {
      showErrors(errors);
      return;
    }
    if (parsed.length === 0) {
      showErrors(['請至少輸入一位學生（每行一位）']);
      return;
    }
    showErrors([]);
    addBtn.disabled = true;
    addBtn.textContent = '建立中…';
    void createStudents(opts.teamId, parsed, sendInvitesCk.checked)
      .then((res) => {
        const results = Object.values(res.invitesSent);
        const sent = results.filter(Boolean).length;
        const failed = results.length - sent;
        let text = `已建立 ${res.created.length} 位學生`;
        if (sendInvitesCk.checked && results.length > 0) {
          text += `，邀請信寄出 ${sent} 封${failed > 0 ? `、失敗 ${failed} 封` : ''}`;
        }
        toast(text, 'success');
        input.value = '';
        return load();
      })
      .catch((err: unknown) => {
        toast(errText(err, '建立學生'), 'error');
      })
      .finally(() => {
        addBtn.disabled = false;
        addBtn.innerHTML = `${ICONS.plus}新增學生`;
      });
  });

  // ---- 關閉（X / Esc / 點遮罩）----
  const destroy = (): void => {
    document.removeEventListener('keydown', onKey);
    backdrop.remove();
  };
  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key === 'Escape') destroy();
  };
  document.addEventListener('keydown', onKey);
  q<HTMLButtonElement>('#stu-close').addEventListener('click', destroy);
  backdrop.addEventListener('mousedown', (ev) => {
    if (ev.target === backdrop) destroy();
  });

  return { destroy };
}
