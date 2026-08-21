// topbar 帳號選單 — 老師名稱鈕 → 下拉：更改密碼（小 modal：目前 / 新 / 確認）、登出。
// 只管 DOM；實際呼叫 /password、/logout 由 main.ts 透過 options 注入。
import type { TeacherMe } from '@creafly/shared';
import { authErrorText } from '../api';
import { ICONS } from '../icons';
import { toast } from '../toast';
import { PASSWORD_MIN } from './login';

export interface AccountMenuOptions {
  me: TeacherMe | null;
  /** 呼叫 POST /auth/teacher/password；失敗丟 ApiError */
  onChangePassword(currentPassword: string, newPassword: string): Promise<void>;
  onLogout(): void;
}

export interface AccountMenu {
  /** /me 回來身分更新時同步名稱 */
  setMe(me: TeacherMe | null): void;
  /** 換畫面前收掉 modal / 下拉（避免殘留 body 上） */
  destroy(): void;
}

function esc(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function renderAccountMenu(slot: HTMLElement, opts: AccountMenuOptions): AccountMenu {
  const name = opts.me?.name || '老師';
  slot.innerHTML = `
    <div class="account">
      <button type="button" class="btn btn-ghost btn-sm account-btn" id="account-btn" aria-haspopup="menu" aria-expanded="false" title="${esc(opts.me?.email ?? '')}">
        ${ICONS.user}<span class="account-name" id="account-name">${esc(name)}</span>${ICONS.chevronDown}
      </button>
      <div class="menu-pop" id="account-pop" role="menu" hidden>
        <div class="menu-head">
          <div class="menu-name" id="account-pop-name">${esc(name)}</div>
          <div class="menu-sub" id="account-pop-email">${esc(opts.me?.email ?? '')}</div>
        </div>
        <button type="button" class="menu-item" id="account-password" role="menuitem">${ICONS.key}更改密碼</button>
        <button type="button" class="menu-item menu-item-danger" id="account-logout" role="menuitem">${ICONS.logOut}登出</button>
      </div>
    </div>`;

  const btn = slot.querySelector<HTMLButtonElement>('#account-btn')!;
  const pop = slot.querySelector<HTMLElement>('#account-pop')!;
  const nameEl = slot.querySelector<HTMLElement>('#account-name')!;
  const popNameEl = slot.querySelector<HTMLElement>('#account-pop-name')!;
  const popEmailEl = slot.querySelector<HTMLElement>('#account-pop-email')!;

  const openPop = (): void => {
    pop.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
  };
  const closePop = (): void => {
    pop.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
  };
  btn.addEventListener('click', () => (pop.hidden ? openPop() : closePop()));
  const onDocDown = (ev: MouseEvent): void => {
    if (pop.hidden) return;
    const t = ev.target as Node;
    if (pop.contains(t) || btn.contains(t)) return;
    closePop();
  };
  document.addEventListener('mousedown', onDocDown);
  const onDocKey = (ev: KeyboardEvent): void => {
    if (ev.key === 'Escape' && !pop.hidden) closePop();
  };
  document.addEventListener('keydown', onDocKey);

  slot.querySelector<HTMLButtonElement>('#account-logout')!.addEventListener('click', () => {
    closePop();
    opts.onLogout();
  });

  // ---- 更改密碼 modal（掛在 body，遮罩 + 卡片）----
  let modal: HTMLElement | null = null;
  const closeModal = (): void => {
    modal?.remove();
    modal = null;
  };
  const openModal = (): void => {
    closePop();
    closeModal();
    modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    modal.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="pw-title">
        <h2 class="modal-title" id="pw-title">更改密碼</h2>
        <p class="modal-desc">更新後，其他裝置上的登入會全部失效；這台不受影響。</p>
        <form id="pw-form" class="modal-form" novalidate>
          <div class="field">
            <label class="field-label" for="pw-cur">目前密碼</label>
            <input id="pw-cur" type="password" autocomplete="current-password">
          </div>
          <div class="field">
            <label class="field-label" for="pw-new">新密碼（至少 ${PASSWORD_MIN} 碼）</label>
            <input id="pw-new" type="password" autocomplete="new-password">
          </div>
          <div class="field">
            <label class="field-label" for="pw-new2">確認新密碼</label>
            <input id="pw-new2" type="password" autocomplete="new-password">
          </div>
          <div id="pw-error" class="login-error" role="alert" hidden></div>
          <div class="modal-actions">
            <button type="button" class="btn btn-ghost" id="pw-cancel">取消</button>
            <button type="submit" class="btn btn-primary" id="pw-save">更新密碼</button>
          </div>
        </form>
      </div>`;
    document.body.appendChild(modal);

    const form = modal.querySelector<HTMLFormElement>('#pw-form')!;
    const cur = modal.querySelector<HTMLInputElement>('#pw-cur')!;
    const nw = modal.querySelector<HTMLInputElement>('#pw-new')!;
    const nw2 = modal.querySelector<HTMLInputElement>('#pw-new2')!;
    const err = modal.querySelector<HTMLElement>('#pw-error')!;
    const save = modal.querySelector<HTMLButtonElement>('#pw-save')!;
    const showErr = (text: string | null, focus?: HTMLInputElement): void => {
      err.textContent = text ?? '';
      err.hidden = !text;
      focus?.focus();
    };

    modal.querySelector<HTMLButtonElement>('#pw-cancel')!.addEventListener('click', closeModal);
    modal.addEventListener('mousedown', (ev) => {
      if (ev.target === modal) closeModal(); // 點遮罩關閉
    });
    modal.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') closeModal();
    });
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      if (!cur.value) return showErr('請輸入目前密碼', cur);
      if (nw.value.length < PASSWORD_MIN) return showErr(`新密碼至少 ${PASSWORD_MIN} 碼`, nw);
      if (nw.value !== nw2.value) return showErr('兩次輸入的新密碼不一樣', nw2);
      if (nw.value === cur.value) return showErr('新密碼不能和目前密碼相同', nw);
      showErr(null);
      save.disabled = true;
      save.textContent = '更新中…';
      void opts
        .onChangePassword(cur.value, nw.value)
        .then(() => {
          closeModal();
          toast('密碼已更新', 'success');
        })
        .catch((e: unknown) => {
          save.disabled = false;
          save.textContent = '更新密碼';
          showErr(authErrorText(e, 'password'), cur);
        });
    });
    cur.focus();
  };
  slot.querySelector<HTMLButtonElement>('#account-password')!.addEventListener('click', openModal);

  return {
    setMe(me) {
      const n = me?.name || '老師';
      nameEl.textContent = n;
      popNameEl.textContent = n;
      popEmailEl.textContent = me?.email ?? '';
      btn.title = me?.email ?? '';
    },
    destroy() {
      closeModal();
      document.removeEventListener('mousedown', onDocDown);
      document.removeEventListener('keydown', onDocKey);
    },
  };
}
