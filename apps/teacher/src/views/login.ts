// 登入畫面 — 「登入｜註冊」兩個分頁：登入 email + 密碼；註冊 名稱 + email + 密碼（最少 8 碼）+ 確認。
// 成功拿到 session（register / login 回應同型）→ saveSession → onSuccess。
// 免登入模式（/api/info.teacherAuthDisabled）多一顆「測試模式：直接進入」按鈕。
// 另含 renderOffline：開頁 /me 連不上伺服器時用，保留 token、不登出，自動重試。
import { ApiError, authErrorText, confirmPasswordReset, login, register, requestPasswordReset, saveSession } from '../api';
import { ICONS } from '../icons';

/** 免登入模式的假帳號（伺服器不驗，任意即可） */
export const DEV_EMAIL = 'teacher@local';
export const DEV_PASSWORD = 'dev-mode';

export const PASSWORD_MIN = 8;

export interface LoginOptions {
  onSuccess(): void;
  /** 免登入模式：顯示「測試模式：直接進入」 */
  authDisabled?: boolean;
  /** 註冊需要邀請碼時顯示欄位 */
  registerCodeRequired?: boolean;
  /** URL ?reset= 帶入的重設 token */
  resetToken?: string;
  /** 開頁時的提示（如「登入已過期，請重新登入」），顯示在表單上方 */
  notice?: string;
  /** 預設開哪個分頁 */
  initialTab?: 'login' | 'register' | 'forgot' | 'reset';
}

type Tab = 'login' | 'register' | 'forgot' | 'reset';

export function renderLogin(root: HTMLElement, opts: LoginOptions): void {
  root.innerHTML = `
    <div class="login-wrap">
      <div class="login-card">
        <div class="login-head">
          <div class="login-logo">CREAFLY<span class="accent">.</span></div>
          <h1>老師後台</h1>
          <p class="login-hint">用老師帳號登入課堂儀表板</p>
        </div>
        ${opts.notice ? `<div class="login-notice" role="status">${esc(opts.notice)}</div>` : ''}
        <div class="tabs login-tabs" role="tablist">
          <button type="button" class="tab-btn active" data-tab="login" role="tab" aria-selected="true">登入</button>
          <button type="button" class="tab-btn" data-tab="register" role="tab" aria-selected="false">註冊</button>
        </div>

        <form id="login-form" class="login-form" data-panel="login" novalidate>
          <div class="field">
            <label class="field-label" for="li-email">Email</label>
            <input id="li-email" type="text" inputmode="email" autocomplete="username" placeholder="name@school.edu.tw">
          </div>
          <div class="field">
            <label class="field-label" for="li-pass">密碼</label>
            <input id="li-pass" type="password" autocomplete="current-password" placeholder="密碼">
          </div>
          <div class="login-forgot-row">
            <button type="button" class="btn btn-link btn-sm" id="goto-forgot">忘記密碼？</button>
          </div>
          <div id="login-error" class="login-error" role="alert" hidden></div>
          <div class="login-actions">
            <button type="submit" class="btn btn-primary btn-lg" id="login-btn">登入</button>
          </div>
        </form>

        <form id="register-form" class="login-form" data-panel="register" novalidate hidden>
          <div class="field">
            <label class="field-label" for="rg-name">名稱</label>
            <input id="rg-name" type="text" autocomplete="name" placeholder="顯示給學生看的老師名稱">
          </div>
          <div class="field">
            <label class="field-label" for="rg-email">Email</label>
            <input id="rg-email" type="text" inputmode="email" autocomplete="username" placeholder="name@school.edu.tw">
          </div>
          ${
            opts.registerCodeRequired
              ? `<div class="field">
                   <label class="field-label" for="rg-code">註冊邀請碼</label>
                   <input id="rg-code" type="text" autocomplete="off" placeholder="向管理員索取">
                 </div>`
              : ''
          }
          <div class="field">
            <label class="field-label" for="rg-pass">密碼（至少 ${PASSWORD_MIN} 碼）</label>
            <input id="rg-pass" type="password" autocomplete="new-password" placeholder="至少 ${PASSWORD_MIN} 碼">
          </div>
          <div class="field">
            <label class="field-label" for="rg-pass2">確認密碼</label>
            <input id="rg-pass2" type="password" autocomplete="new-password" placeholder="再輸入一次">
          </div>
          <div id="register-error" class="login-error" role="alert" hidden></div>
          <div class="login-actions">
            <button type="submit" class="btn btn-primary btn-lg" id="register-btn">建立帳號</button>
          </div>
        </form>

        <form id="forgot-form" class="login-form" data-panel="forgot" novalidate hidden>
          <p class="login-hint">輸入註冊 email，我們會寄重設密碼連結（若帳號存在）。</p>
          <div class="field">
            <label class="field-label" for="fg-email">Email</label>
            <input id="fg-email" type="text" inputmode="email" autocomplete="username" placeholder="name@school.edu.tw">
          </div>
          <div id="forgot-error" class="login-error" role="alert" hidden></div>
          <div id="forgot-ok" class="login-notice" role="status" hidden></div>
          <div class="login-actions login-actions-split">
            <button type="button" class="btn btn-ghost" id="forgot-back">返回登入</button>
            <button type="submit" class="btn btn-primary" id="forgot-btn">寄送連結</button>
          </div>
        </form>

        <form id="reset-form" class="login-form" data-panel="reset" novalidate hidden>
          <p class="login-hint">請設定新密碼（至少 ${PASSWORD_MIN} 碼）。</p>
          <div class="field">
            <label class="field-label" for="rs-pass">新密碼</label>
            <input id="rs-pass" type="password" autocomplete="new-password" placeholder="至少 ${PASSWORD_MIN} 碼">
          </div>
          <div class="field">
            <label class="field-label" for="rs-pass2">確認新密碼</label>
            <input id="rs-pass2" type="password" autocomplete="new-password" placeholder="再輸入一次">
          </div>
          <div id="reset-error" class="login-error" role="alert" hidden></div>
          <div class="login-actions">
            <button type="submit" class="btn btn-primary btn-lg" id="reset-btn">重設並登入</button>
          </div>
        </form>

        ${
          opts.authDisabled
            ? `<div class="login-dev">
                 <span class="login-dev-text">伺服器目前為免登入測試模式</span>
                 <button type="button" class="btn btn-ghost btn-sm" id="dev-enter-btn">${ICONS.play}測試模式：直接進入</button>
               </div>`
            : ''
        }
      </div>
    </div>`;

  const q = <T extends HTMLElement>(sel: string): T => root.querySelector<T>(sel)!;
  const tabBtns = [...root.querySelectorAll<HTMLButtonElement>('.login-tabs .tab-btn')];
  const panels = [...root.querySelectorAll<HTMLFormElement>('.login-form')];

  const switchTab = (tab: Tab): void => {
    const showTabs = tab === 'login' || tab === 'register';
    q<HTMLElement>('.login-tabs').hidden = !showTabs;
    for (const b of tabBtns) {
      const on = b.dataset['tab'] === tab;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', String(on));
    }
    for (const p of panels) p.hidden = p.dataset['panel'] !== tab;
    const focusMap: Record<Tab, string> = {
      login: '#li-email',
      register: '#rg-name',
      forgot: '#fg-email',
      reset: '#rs-pass',
    };
    q<HTMLInputElement>(focusMap[tab]).focus();
  };
  for (const b of tabBtns) b.addEventListener('click', () => switchTab((b.dataset['tab'] as Tab) ?? 'login'));

  /** 送出中：按鈕停用 + 文字換成進行式；結束還原 */
  const busy = (btn: HTMLButtonElement, on: boolean, idleText: string, busyText: string): void => {
    btn.disabled = on;
    btn.textContent = on ? busyText : idleText;
  };
  const showError = (el: HTMLElement, text: string | null): void => {
    el.textContent = text ?? '';
    el.hidden = !text;
  };

  // ---- 登入 ----
  const loginForm = q<HTMLFormElement>('#login-form');
  const liEmail = q<HTMLInputElement>('#li-email');
  const liPass = q<HTMLInputElement>('#li-pass');
  const loginErr = q<HTMLElement>('#login-error');
  const loginBtn = q<HTMLButtonElement>('#login-btn');

  loginForm.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const email = liEmail.value.trim();
    const password = liPass.value;
    if (!email || !password) {
      showError(loginErr, '請輸入 email 和密碼');
      (email ? liPass : liEmail).focus();
      return;
    }
    showError(loginErr, null);
    busy(loginBtn, true, '登入', '登入中…');
    void login(email, password)
      .then((res) => {
        saveSession(res);
        opts.onSuccess();
      })
      .catch((err: unknown) => {
        showError(loginErr, authErrorText(err, 'login'));
        busy(loginBtn, false, '登入', '登入中…');
        if (err instanceof ApiError && err.status === 401) liPass.select();
      });
  });

  // ---- 註冊 ----
  const regForm = q<HTMLFormElement>('#register-form');
  const rgName = q<HTMLInputElement>('#rg-name');
  const rgEmail = q<HTMLInputElement>('#rg-email');
  const rgPass = q<HTMLInputElement>('#rg-pass');
  const rgPass2 = q<HTMLInputElement>('#rg-pass2');
  const regErr = q<HTMLElement>('#register-error');
  const regBtn = q<HTMLButtonElement>('#register-btn');

  regForm.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const name = rgName.value.trim();
    const email = rgEmail.value.trim();
    const password = rgPass.value;
    const confirm = rgPass2.value;
    const fail = (text: string, focus: HTMLInputElement): void => {
      showError(regErr, text);
      focus.focus();
    };
    if (!name) return fail('請輸入名稱', rgName);
    if (!email || !email.includes('@')) return fail('請輸入正確的 email', rgEmail);
    if (password.length < PASSWORD_MIN) return fail(`密碼至少 ${PASSWORD_MIN} 碼`, rgPass);
    if (password !== confirm) return fail('兩次輸入的密碼不一樣', rgPass2);
    showError(regErr, null);
    busy(regBtn, true, '建立帳號', '建立中…');
    void register(email, password, name, q<HTMLInputElement>('#rg-code')?.value.trim() || undefined)
      .then((res) => {
        saveSession(res);
        opts.onSuccess();
      })
      .catch((err: unknown) => {
        showError(regErr, authErrorText(err, 'register'));
        busy(regBtn, false, '建立帳號', '建立中…');
        if (err instanceof ApiError && err.status === 409) {
          // 已註冊 → 帶著 email 切到登入分頁，少打一次
          liEmail.value = email;
          switchTab('login');
          showError(loginErr, authErrorText(err, 'register'));
          liPass.focus();
        }
      });
  });

  // ---- 忘記密碼 ----
  const forgotForm = q<HTMLFormElement>('#forgot-form');
  const fgEmail = q<HTMLInputElement>('#fg-email');
  const forgotErr = q<HTMLElement>('#forgot-error');
  const forgotOk = q<HTMLElement>('#forgot-ok');
  const forgotBtn = q<HTMLButtonElement>('#forgot-btn');
  q<HTMLButtonElement>('#goto-forgot').addEventListener('click', () => switchTab('forgot'));
  q<HTMLButtonElement>('#forgot-back').addEventListener('click', () => switchTab('login'));
  forgotForm.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const email = fgEmail.value.trim();
    if (!email || !email.includes('@')) {
      showError(forgotErr, '請輸入正確的 email');
      fgEmail.focus();
      return;
    }
    showError(forgotErr, null);
    forgotOk.hidden = true;
    busy(forgotBtn, true, '寄送連結', '寄送中…');
    void requestPasswordReset(email)
      .then(() => {
        forgotOk.textContent = '若此 email 已註冊，重設連結已寄出（或請查看伺服器 log）。';
        forgotOk.hidden = false;
      })
      .catch((err: unknown) => {
        showError(forgotErr, authErrorText(err, 'forgot'));
      })
      .finally(() => busy(forgotBtn, false, '寄送連結', '寄送中…'));
  });

  // ---- 重設密碼（?reset= token）----
  const resetForm = q<HTMLFormElement>('#reset-form');
  const rsPass = q<HTMLInputElement>('#rs-pass');
  const rsPass2 = q<HTMLInputElement>('#rs-pass2');
  const resetErr = q<HTMLElement>('#reset-error');
  const resetBtn = q<HTMLButtonElement>('#reset-btn');
  const resetToken = opts.resetToken?.trim() ?? '';
  resetForm.addEventListener('submit', (ev) => {
    ev.preventDefault();
    if (!resetToken) {
      showError(resetErr, '重設連結無效，請重新申請');
      return;
    }
    const password = rsPass.value;
    const confirm = rsPass2.value;
    if (password.length < PASSWORD_MIN) {
      showError(resetErr, `密碼至少 ${PASSWORD_MIN} 碼`);
      rsPass.focus();
      return;
    }
    if (password !== confirm) {
      showError(resetErr, '兩次輸入的密碼不一樣');
      rsPass2.focus();
      return;
    }
    showError(resetErr, null);
    busy(resetBtn, true, '重設並登入', '處理中…');
    void confirmPasswordReset(resetToken, password)
      .then((res) => {
        saveSession(res);
        history.replaceState(null, '', location.pathname);
        opts.onSuccess();
      })
      .catch((err: unknown) => {
        showError(resetErr, authErrorText(err, 'reset'));
        busy(resetBtn, false, '重設並登入', '處理中…');
      });
  });

  // ---- 免登入測試模式 ----
  const devBtn = root.querySelector<HTMLButtonElement>('#dev-enter-btn');
  devBtn?.addEventListener('click', () => {
    devBtn.disabled = true;
    void login(DEV_EMAIL, DEV_PASSWORD)
      .then((res) => {
        saveSession(res);
        opts.onSuccess();
      })
      .catch((err: unknown) => {
        devBtn.disabled = false;
        showError(loginErr, authErrorText(err, 'login'));
      });
  });

  switchTab(opts.initialTab ?? (resetToken ? 'reset' : 'login'));
}

export interface OfflineOptions {
  /** 老師名稱（已保留的 session） */
  name: string;
  /** 按「立即重試」或自動重試：回 true 表示已離開此畫面 */
  onRetry(): Promise<boolean>;
  onLogout(): void;
  /** 自動重試間隔（ms） */
  retryMs?: number;
}

/** 離線畫面 — 開頁時 /me 連不上伺服器：token 不清、不登出，每隔幾秒自動重試 */
export function renderOffline(root: HTMLElement, opts: OfflineOptions): void {
  const retryMs = opts.retryMs ?? 5000;
  root.innerHTML = `
    <div class="login-wrap">
      <div class="login-card">
        <div class="login-head">
          <div class="login-logo">CREAFLY<span class="accent">.</span></div>
          <h1>連不上伺服器</h1>
          <p class="login-hint">已保留 ${esc(opts.name)} 的登入狀態，不會被登出；伺服器恢復後會自動進入儀表板。</p>
        </div>
        <div class="offline-status" id="offline-status" role="status">
          <span class="status-dot off"></span><span id="offline-text">每 ${Math.round(retryMs / 1000)} 秒自動重試</span>
        </div>
        <div class="login-actions login-actions-split">
          <button type="button" class="btn btn-ghost" id="offline-logout">${ICONS.logOut}登出</button>
          <button type="button" class="btn btn-primary" id="offline-retry">${ICONS.rotateCcw}立即重試</button>
        </div>
      </div>
    </div>`;

  const retryBtn = root.querySelector<HTMLButtonElement>('#offline-retry')!;
  const textEl = root.querySelector<HTMLElement>('#offline-text')!;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let gone = false;

  const schedule = (): void => {
    if (gone) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void attempt(), retryMs);
  };
  const attempt = async (): Promise<void> => {
    if (gone) return;
    retryBtn.disabled = true;
    textEl.textContent = '重試中…';
    const left = await opts.onRetry();
    if (left) {
      gone = true;
      if (timer) clearTimeout(timer);
      return;
    }
    retryBtn.disabled = false;
    textEl.textContent = `仍然連不上，每 ${Math.round(retryMs / 1000)} 秒自動重試`;
    schedule();
  };

  retryBtn.addEventListener('click', () => void attempt());
  root.querySelector<HTMLButtonElement>('#offline-logout')!.addEventListener('click', () => {
    gone = true;
    if (timer) clearTimeout(timer);
    opts.onLogout();
  });
  schedule();
}

function esc(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
