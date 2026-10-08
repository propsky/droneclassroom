import './style.css';

const TOKEN = 'creafly_admin_token';
/** 留空 = 同網域（本機 Vite 代理）。Pages 建置時由 VITE_API_URL 帶入後端。 */
const API_BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '');

interface Teacher {
  id: number;
  name: string;
  email: string;
  status: string;
  licenseState: string;
  licensedUntil: number | null;
  emailVerified: boolean;
  teamCount: number;
  lastLoginAt: number | null;
}
interface Student {
  id: number;
  name: string;
  emoji: string;
  email: string | null;
  status: string;
  licenseState: string;
  licensedUntil: number | null;
  emailVerified: boolean;
  progressMode: string;
  memberships: string[];
  studentCode: string | null;
}

const $ = (html: string): HTMLElement => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as HTMLElement;
};

function token(): string | null {
  return sessionStorage.getItem(TOKEN);
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json');
  const tok = token();
  if (tok) headers.set('authorization', `Bearer ${tok}`);
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (res.status === 401 && path !== '/auth/admin/login') {
    sessionStorage.removeItem(TOKEN);
    location.reload();
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { detail?: string };
    throw new Error(typeof body.detail === 'string' ? body.detail : `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

function dateInput(ms: number | null): string {
  if (!ms) return '';
  return new Date(ms).toISOString().slice(0, 10);
}

function pill(state: string, label: string): string {
  const cls = state === 'active' || state === 'ok' ? 'ok' : state === 'expired' || state === 'disabled' || state === 'removed' ? 'bad' : 'warn';
  return `<span class="pill ${cls}">${label}</span>`;
}

const app = document.getElementById('app')!;

if (!token()) {
  renderLogin();
} else {
  void renderShell();
}

function renderLogin(): void {
  const node = $(`
    <div class="gate">
      <form class="card" id="login">
        <p class="brand-kicker">CREAFLY</p>
        <h1>管理</h1>
        <p class="lede">平台管理員。老師與學生帳號不在這裡登入。</p>
        <label class="field">
          <span>帳號</span>
          <input id="user" name="username" type="text" autocomplete="username" value="admin" required>
        </label>
        <label class="field">
          <span>密碼</span>
          <input id="pw" name="password" type="password" autocomplete="current-password" placeholder="輸入密碼" required>
        </label>
        <div class="err" id="err"></div>
        <button class="btn primary block" type="submit">進入</button>
      </form>
    </div>`);
  app.replaceChildren(node);
  const form = node.querySelector('form')!;
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const fd = new FormData(form);
    void api<{ token: string }>('/auth/admin/login', {
      method: 'POST',
      body: JSON.stringify({ username: fd.get('username'), password: fd.get('password') }),
    })
      .then((res) => {
        sessionStorage.setItem(TOKEN, res.token);
        void renderShell();
      })
      .catch((e: Error) => {
        const err = node.querySelector('#err');
        if (err) err.textContent = e.message;
      });
  });
}

type Tab = 'home' | 'teachers' | 'students';
let tab: Tab = 'home';
let query = '';
let licenseFilter = '';
let statusFilter = '';
let verifiedFilter = '';

async function renderShell(): Promise<void> {
  const root = $(`
    <div class="shell">
      <aside class="rail">
        <div class="mark"><b>CREAFLY</b><span>平台管理</span></div>
        <nav class="nav">
          <button type="button" data-tab="home">總覽</button>
          <button type="button" data-tab="teachers">老師</button>
          <button type="button" data-tab="students">學生</button>
        </nav>
        <button class="btn out" id="logout" type="button">登出</button>
      </aside>
      <section class="main" id="stage"></section>
    </div>`);
  app.replaceChildren(root);
  root.querySelector('#logout')?.addEventListener('click', () => {
    void api('/auth/admin/logout', { method: 'POST' }).finally(() => {
      sessionStorage.removeItem(TOKEN);
      renderLogin();
    });
  });
  root.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      tab = btn.dataset.tab as Tab;
      void paint();
    });
  });
  await paint();

  async function paint(): Promise<void> {
    root.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((btn) => {
      btn.classList.toggle('on', btn.dataset.tab === tab);
    });
    const stage = root.querySelector('#stage')!;
    if (tab === 'home') stage.replaceChildren(await homeView());
    if (tab === 'teachers') stage.replaceChildren(await peopleView('teachers'));
    if (tab === 'students') stage.replaceChildren(await peopleView('students'));
  }

  function filters(kind: 'teachers' | 'students'): HTMLElement {
    const box = document.createElement('div');
    box.className = 'filters';
    const chips: [string, string, string][] = [
      ['status', '', '全部狀態'],
      ['status', 'active', '使用中'],
      ['status', 'disabled', '已停用'],
      ['license', '', '期限不拘'],
      ['license', 'none', '不限期'],
      ['license', 'active', '期限內'],
      ['license', 'expired', '已到期'],
      ['verified', '', '驗證不拘'],
      ['verified', 'yes', '已驗證'],
      ['verified', 'no', '未驗證'],
    ];
    if (kind === 'students') chips.splice(3, 0, ['status', 'removed', '已移除']);
    for (const [key, value, label] of chips) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.textContent = label;
      if (key === 'status') b.classList.toggle('on', statusFilter === value);
      if (key === 'license') b.classList.toggle('on', licenseFilter === value);
      if (key === 'verified') b.classList.toggle('on', verifiedFilter === value);
      b.addEventListener('click', () => {
        if (key === 'status') statusFilter = value;
        if (key === 'license') licenseFilter = value;
        if (key === 'verified') verifiedFilter = value;
        void paint();
      });
      box.append(b);
    }
    return box;
  }

  async function homeView(): Promise<HTMLElement> {
    const data = await api<{
      teachers: number;
      students: number;
      teams: number;
      disabledTeachers: number;
      expiredStudents: number;
    }>('/api/admin/summary');
    const node = $(`
      <div>
        <div class="top"><div><h1>總覽</h1><p>帳號、授權與班級現況</p></div></div>
        <div class="stats">
          <div class="stat"><em>老師</em><strong>${data.teachers}</strong></div>
          <div class="stat"><em>學生</em><strong>${data.students}</strong></div>
          <div class="stat"><em>班級</em><strong>${data.teams}</strong></div>
          <div class="stat"><em>到期學生</em><strong>${data.expiredStudents}</strong></div>
        </div>
        <p class="note">停用的老師 ${data.disabledTeachers} 位。授權期限留空表示不限期。</p>
      </div>`);
    return node;
  }

  async function peopleView(kind: 'teachers' | 'students'): Promise<HTMLElement> {
    const qs = new URLSearchParams({
      q: query,
      status: statusFilter,
      license: licenseFilter,
      verified: verifiedFilter,
    });
    const path = kind === 'teachers' ? '/api/admin/teachers' : '/api/admin/students';
    const data = await api<{ teachers?: Teacher[]; students?: Student[] }>(`${path}?${qs}`);
    const rows = kind === 'teachers' ? data.teachers ?? [] : data.students ?? [];
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <div class="top">
        <div>
          <h1>${kind === 'teachers' ? '老師' : '學生'}</h1>
          <p>${rows.length} 筆</p>
        </div>
        <input class="search" id="q" type="search" placeholder="搜尋名稱或 email" value="${query.replace(/"/g, '&quot;')}">
        <button class="btn primary" id="add" type="button">新增</button>
      </div>`;
    wrap.append(filters(kind));
    const table = document.createElement('div');
    table.className = 'table-wrap';
    const grid =
      kind === 'teachers'
        ? teacherTable(data.teachers ?? [])
        : studentTable(data.students ?? []);
    table.innerHTML = `<div class="table-card">${grid}</div>`;
    wrap.append(table);
    if (rows.length === 0) wrap.insertAdjacentHTML('beforeend', '<p class="empty">沒有符合的帳號</p>');
    wrap.querySelector('#q')?.addEventListener('change', (ev) => {
      query = (ev.target as HTMLInputElement).value;
      void paint();
    });
    wrap.querySelector('#add')?.addEventListener('click', () => openDrawer(kind, null, paint));
    table.querySelectorAll<HTMLButtonElement>('[data-edit]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = Number(btn.dataset.edit);
        const row = rows.find((r) => r.id === id);
        if (row) openDrawer(kind, row, paint);
      });
    });
    return wrap;
  }
}

function teacherTable(rows: Teacher[]): string {
  return `<table><thead><tr><th>姓名</th><th>Email</th><th>狀態</th><th>授權</th><th>驗證</th><th>班級</th><th></th></tr></thead><tbody>
    ${rows
      .map(
        (t) => `<tr>
          <td>${esc(t.name)}</td>
          <td class="mono">${esc(t.email)}</td>
          <td>${pill(t.status, t.status === 'active' ? '使用中' : '已停用')}</td>
          <td>${pill(t.licenseState, licenseLabel(t.licenseState, t.licensedUntil))}</td>
          <td>${t.emailVerified ? '已驗證' : '未驗證'}</td>
          <td class="mono">${t.teamCount}</td>
          <td><button class="btn sm" type="button" data-edit="${t.id}">編輯</button></td>
        </tr>`,
      )
      .join('')}
  </tbody></table>`;
}

function studentTable(rows: Student[]): string {
  return `<table><thead><tr><th>姓名</th><th>Email</th><th>狀態</th><th>授權</th><th>進度</th><th>班級</th><th></th></tr></thead><tbody>
    ${rows
      .map(
        (s) => `<tr>
          <td>${esc(s.name)}</td>
          <td class="mono">${esc(s.email ?? '—')}</td>
          <td>${pill(s.status, s.status === 'active' ? '使用中' : s.status === 'disabled' ? '已停用' : '已移除')}</td>
          <td>${pill(s.licenseState, licenseLabel(s.licenseState, s.licensedUntil))}</td>
          <td>${s.progressMode === 'class' ? '班級' : '自己'}</td>
          <td class="mono">${esc(s.memberships.join(' ') || '—')}</td>
          <td><button class="btn sm" type="button" data-edit="${s.id}">編輯</button></td>
        </tr>`,
      )
      .join('')}
  </tbody></table>`;
}

function licenseLabel(state: string, until: number | null): string {
  if (state === 'none') return '不限期';
  const day = until ? new Date(until).toISOString().slice(0, 10) : '';
  return state === 'expired' ? `已到期 ${day}` : `至 ${day}`;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

function openDrawer(
  kind: 'teachers' | 'students',
  row: Teacher | Student | null,
  refresh: () => Promise<void>,
): void {
  const isTeacher = kind === 'teachers';
  const back = $(`
    <div class="drawer-back">
      <form class="drawer">
        <h2>${row ? '編輯' : '新增'}${isTeacher ? '老師' : '學生'}</h2>
        <p class="lede">授權到期留空表示不限期。</p>
        <label class="field"><span>名稱</span><input name="name" type="text" required value="${row ? esc(row.name) : ''}"></label>
        ${
          isTeacher
            ? `<label class="field"><span>Email</span><input name="email" type="email" required value="${row ? esc((row as Teacher).email) : ''}" ${row ? 'readonly' : ''}></label>`
            : `<label class="field"><span>Email（可空白）</span><input name="email" type="email" value="${row ? esc((row as Student).email ?? '') : ''}" ${row ? 'readonly' : ''}></label>`
        }
        <label class="field"><span>${row ? '新密碼（空白表示不改）' : '密碼'}</span><input name="password" type="password" autocomplete="new-password" ${row ? '' : 'required'}></label>
        ${
          row
            ? `<label class="field"><span>狀態</span>
               <select name="status">
                 <option value="active">使用中</option>
                 <option value="disabled">停用</option>
                 ${isTeacher ? '' : '<option value="removed">移除</option>'}
               </select></label>
               <label class="field"><span>授權到期</span><input name="licensedUntil" type="date" value="${dateInput(row.licensedUntil)}"></label>
               <label class="check"><input name="clearLicense" type="checkbox"><span>清除期限，改為不限期</span></label>
               <label class="check"><input name="emailVerified" type="checkbox" ${row.emailVerified ? 'checked' : ''}><span>已驗證 email</span></label>
               ${
                 isTeacher
                   ? ''
                   : `<label class="field"><span>進度帳本</span>
                      <select name="progressMode">
                        <option value="personal">自己的進度</option>
                        <option value="class">目前班級的進度</option>
                      </select></label>`
               }`
            : ''
        }
        <div class="err" id="derr"></div>
        <div class="row-actions">
          <button class="btn primary" type="submit">儲存</button>
          <button class="btn" type="button" id="close">取消</button>
        </div>
      </form>
    </div>`);
  document.body.append(back);
  requestAnimationFrame(() => back.classList.add('show'));
  const form = back.querySelector('form')!;
  if (row) {
    (form.querySelector('[name=status]') as HTMLSelectElement | null)?.value &&
      ((form.querySelector('[name=status]') as HTMLSelectElement).value = row.status);
    const mode = form.querySelector('[name=progressMode]') as HTMLSelectElement | null;
    if (mode && 'progressMode' in row) mode.value = row.progressMode;
  }
  const close = (): void => {
    back.classList.remove('show');
    setTimeout(() => back.remove(), 200);
  };
  back.querySelector('#close')?.addEventListener('click', close);
  back.addEventListener('click', (ev) => {
    if (ev.target === back) close();
  });
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const fd = new FormData(form);
    const name = String(fd.get('name') ?? '');
    const password = String(fd.get('password') ?? '');
    const err = form.querySelector('#derr');
    const done = (p: Promise<unknown>): void => {
      p.then(() => {
        close();
        void refresh();
      }).catch((e: Error) => {
        if (err) err.textContent = e.message;
      });
    };
    if (!row) {
      if (isTeacher) {
        done(
          api('/api/admin/teachers', {
            method: 'POST',
            body: JSON.stringify({ name, email: fd.get('email'), password }),
          }),
        );
      } else {
        done(
          api('/api/admin/students', {
            method: 'POST',
            body: JSON.stringify({
              name,
              email: String(fd.get('email') ?? '') || null,
              password: password || null,
            }),
          }),
        );
      }
      return;
    }
    const patch: Record<string, unknown> = {
      name,
      status: fd.get('status'),
      emailVerified: fd.get('emailVerified') === 'on',
      clearLicense: fd.get('clearLicense') === 'on',
    };
    const until = String(fd.get('licensedUntil') ?? '');
    if (!patch.clearLicense && until) patch.licensedUntil = until;
    if (password) patch.password = password;
    if (!isTeacher) patch.progressMode = fd.get('progressMode');
    const id = row.id;
    done(
      api(`/api/admin/${kind}/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    );
  });
}
