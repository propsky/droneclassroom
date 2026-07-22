// 登入畫面 — 輸入教師 PIN → POST /auth/teacher → 進儀表板。
import { teacherLogin, saveTicket, LoginError } from '../api';

/** 依 HTTP 狀態碼轉成給老師看的訊息 */
function loginErrorText(err: unknown): string {
  if (err instanceof LoginError) {
    if (err.status === 401) return 'PIN 錯誤';
    if (err.status === 429) return '嘗試太多次，稍等一下';
    return `登入失敗（HTTP ${err.status}）`;
  }
  return '無法連到伺服器，請確認後端已啟動';
}

export function renderLogin(root: HTMLElement, onSuccess: () => void): void {
  root.innerHTML = `
    <div class="login-wrap">
      <div class="login-card">
        <div class="login-logo">CREAFLY<span class="accent">.</span></div>
        <h1>老師後台</h1>
        <p class="login-hint">輸入教師 PIN 進入課堂儀表板</p>
        <form id="login-form">
          <input id="pin-input" type="password" inputmode="numeric" autocomplete="off"
                 placeholder="教師 PIN" aria-label="教師 PIN">
          <div id="login-error" class="login-error" hidden></div>
          <button type="submit" class="btn btn-primary" id="login-btn">登入</button>
        </form>
      </div>
    </div>`;

  const form = root.querySelector<HTMLFormElement>('#login-form')!;
  const input = root.querySelector<HTMLInputElement>('#pin-input')!;
  const errorEl = root.querySelector<HTMLElement>('#login-error')!;
  const btn = root.querySelector<HTMLButtonElement>('#login-btn')!;

  const showError = (text: string): void => {
    errorEl.textContent = text;
    errorEl.hidden = false;
  };

  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const pin = input.value.trim();
    if (!pin) {
      showError('請輸入 PIN');
      return;
    }
    errorEl.hidden = true;
    btn.disabled = true;
    btn.textContent = '登入中…';
    void teacherLogin(pin)
      .then((res) => {
        saveTicket(res);
        onSuccess();
      })
      .catch((err: unknown) => {
        showError(loginErrorText(err));
        btn.disabled = false;
        btn.textContent = '登入';
        input.select();
      });
  });

  input.focus();
}
