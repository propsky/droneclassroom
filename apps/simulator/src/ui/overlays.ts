// Overlay 元件：登入 modal（快速進場：名字 + emoji + 房間碼｜學生帳號：班級碼+學生碼 / email+密碼）、
// 邀請設密碼頁（?invite=TOKEN）、關卡 intro、3-2-1 倒數、關卡選單、
// header 按鈕列（模式切換 / 回家 / 視角 / 全螢幕 / 改名 / 登出帳號）與 Blockly 工具列按鈕。
import type { StudentLoginRequest, StudentLoginResponse } from '@creafly/shared';
import { bus, toast } from '../core/events';
import {
  acceptInvite,
  clearStudentSession,
  fetchInviteInfo,
  fetchStudentMe,
  loadStudentSession,
  saveStudentSession,
  studentLogin,
  touchStudentSession,
  type StudentSession,
} from '../net/studentAuth';
import { progressState } from '../net/progressQueue';
import { canLoadLevel, loadEntitlement } from '../net/entitlement';
import { flags } from '../core/droneState';
import { levelState, loadLevel, armLevelStart, resetMission } from '../core/level';
import { setMode, runProgram, stopProgram, programState } from '../core/program';
import { togglePause, resumeGame } from '../core/pause';
import { goHome } from '../core/physics';
import { iconHtml, mountIcons } from './icons';

const $ = (id: string): HTMLElement | null => document.getElementById(id);

// =============================================================================
// 玩家（登入 / 顯示名稱 / 房間）
// =============================================================================
/**
 * 玩家身分：名字 + 動物 + 房間碼（老師開房給的 4 碼；空字串 = 預設房，向後相容）+ 密碼。
 * net/ws.ts 的 register 直接讀這裡（重連時自動帶同一組）。
 */
export const player = { name: '', emoji: '', roomCode: '', roomPassword: '' };

const LS_PLAYER = 'creafly_player';
/** 最後一次成功送出的房間碼（下次開啟預填；被踢 / 關房時清掉，避免重整又自動進同房） */
const LS_ROOM = 'creafly_room';
/** 房間密碼只留在本分頁（重整可自動重進有密碼的房；關分頁即忘） */
const SS_ROOM_PW = 'creafly_room_pw';
/** 進房等待逾時：伺服器沒回 room_joined / room_rejected（離線教室）→ 先放行單機遊玩 */
const JOIN_TIMEOUT_MS = 6000;

/** 房間碼正規化：去空白、大寫、只留英數、最多 4 碼 */
export function normalizeRoomCode(raw: string): string {
  return raw.replace(/[^0-9a-zA-Z]/g, '').toUpperCase().slice(0, 4);
}

const REJECT_TEXT: Record<string, string> = {
  not_found: '找不到這個房間，確認一下老師給的 4 碼',
  locked: '老師已鎖房，暫不開放加入',
  full: '房間已滿',
  bad_password: '密碼不對',
  closed: '房間已關閉',
};

function loadPlayer(): boolean {
  try {
    const saved = localStorage.getItem(LS_PLAYER);
    if (saved) {
      const p = JSON.parse(saved) as { name?: string; emoji?: string };
      if (p.name && p.emoji) {
        player.name = p.name;
        player.emoji = p.emoji;
        player.roomCode = normalizeRoomCode(localStorage.getItem(LS_ROOM) ?? '');
        player.roomPassword = player.roomCode ? sessionStorage.getItem(SS_ROOM_PW) ?? '' : '';
        return true;
      }
    }
  } catch (e) {
    console.warn('載入玩家資料失敗', e);
  }
  return false;
}

function savePlayer(): void {
  try {
    localStorage.setItem(
      LS_PLAYER,
      JSON.stringify({ name: player.name, emoji: player.emoji, createdAt: new Date().toISOString() }),
    );
    if (player.roomCode) localStorage.setItem(LS_ROOM, player.roomCode);
    else localStorage.removeItem(LS_ROOM);
    if (player.roomPassword) sessionStorage.setItem(SS_ROOM_PW, player.roomPassword);
    else sessionStorage.removeItem(SS_ROOM_PW);
  } catch {
    /* ignore */
  }
}

/** 被踢 / 關房：忘掉房間碼（重整不自動進同房），名字動物保留 */
function forgetRoom(): void {
  player.roomCode = '';
  player.roomPassword = '';
  try {
    localStorage.removeItem(LS_ROOM);
    sessionStorage.removeItem(SS_ROOM_PW);
  } catch {
    /* ignore */
  }
}

// =============================================================================
// 學生帳號模式（班級碼+學生碼 / email+密碼、邀請設密碼、90 天自動登入）
// 快速進場（訪客）流程零改變：沒 token、沒 ?invite= 時行為與過去完全相同。
// =============================================================================

/** 目前的學生帳號 session（null = 訪客）；WS register 的 studentToken 由 net/ws.ts 讀 localStorage */
let studentSession: StudentSession | null = null;

/** 頭像下拉「登出帳號」只在帳號模式顯示 */
function syncAccountUi(): void {
  const btn = $('player-logout');
  if (btn) btn.style.display = studentSession ? '' : 'none';
}

// ---- 登入 modal 分頁（快速進場｜我有學生帳號）----
function setLoginTab(tab: 'guest' | 'account'): void {
  const tabGuest = $('login-tab-guest');
  const tabAcct = $('login-tab-account');
  tabGuest?.classList.toggle('active', tab === 'guest');
  tabAcct?.classList.toggle('active', tab === 'account');
  tabGuest?.setAttribute('aria-selected', String(tab === 'guest'));
  tabAcct?.setAttribute('aria-selected', String(tab === 'account'));
  const paneGuest = $('login-pane-guest');
  const paneAcct = $('login-pane-account');
  if (paneGuest) paneGuest.hidden = tab !== 'guest';
  if (paneAcct) paneAcct.hidden = tab !== 'account';
}

// ---- 帳號分頁狀態：碼登入 ↔ email 登入；密碼欄預設隱藏（伺服器說需要才展開）----
let acctMode: 'code' | 'email' = 'code';
let acctPwShown = false;

function setAcctMode(mode: 'code' | 'email'): void {
  acctMode = mode;
  const codeFields = $('acct-code-fields');
  const emailFields = $('acct-email-fields');
  if (codeFields) codeFields.hidden = mode !== 'code';
  if (emailFields) emailFields.hidden = mode !== 'email';
  const link = $('acct-mode-switch');
  if (link) link.textContent = mode === 'code' ? '用 email 登入' : '用班級碼登入';
  setAcctError(null);
}

function setAcctPwShown(shown: boolean): void {
  acctPwShown = shown;
  const field = $('acct-code-pw-field');
  if (field) field.hidden = !shown;
}

function setAcctError(text: string | null): void {
  const err = $('acct-error');
  if (err) {
    err.textContent = text ?? '';
    err.hidden = !text;
  }
}

function setAcctPending(on: boolean): void {
  const btn = $('acct-login-btn') as HTMLButtonElement | null;
  if (btn) {
    btn.disabled = on;
    btn.textContent = on ? '登入中…' : '登入';
  }
}

/** 學生碼正規化：只留英數、大寫、最多 2 碼（'01'…，保留前導零） */
function normalizeStudentCode(raw: string): string {
  return raw.replace(/[^0-9a-zA-Z]/g, '').toUpperCase().slice(0, 2);
}

/**
 * 登入 / 邀請接受成功（token + me）：存 session、身分以 DB 為準、收 modal、連線。
 * 不帶訪客房間碼 — 帳號模式由伺服器依班級自動進房；不等 room_joined（離線也能玩）。
 */
function onStudentLoggedIn(
  data: StudentLoginResponse,
  finishLogin: () => void,
  onJoin: () => void,
): void {
  saveStudentSession(data.token, data.me, data.expiresIn);
  studentSession = loadStudentSession();
  player.name = data.me.name;
  player.emoji = data.me.emoji;
  player.roomCode = '';
  player.roomPassword = '';
  syncAccountUi();
  setAcctError(null);
  finishLogin();
  toast(`✓ 歡迎回來 ${data.me.name}${data.me.emoji}！`, 'success');
  setTimeout(onJoin, 200);
}

/** 帳號分頁送出：驗欄位 → POST /auth/student/login → 401 需密碼時展開密碼欄（零阻力小學生流程） */
async function submitAccountLogin(finishLogin: () => void, onJoin: () => void): Promise<void> {
  const req: StudentLoginRequest = {};
  if (acctMode === 'code') {
    const teamInput = $('acct-team-code') as HTMLInputElement | null;
    const codeInput = $('acct-student-code') as HTMLInputElement | null;
    const teamCode = normalizeRoomCode(teamInput?.value ?? '');
    const studentCode = normalizeStudentCode(codeInput?.value ?? '');
    if (teamCode.length < 4) {
      setAcctError('班級碼是 4 碼英數，在老師發的小卡上');
      teamInput?.focus();
      return;
    }
    if (studentCode.length < 2) {
      setAcctError('學生碼是 2 碼，例如 01');
      codeInput?.focus();
      return;
    }
    req.teamCode = teamCode;
    req.studentCode = studentCode;
    const pw = acctPwShown ? (($('acct-code-pw') as HTMLInputElement | null)?.value ?? '') : '';
    if (pw) req.password = pw;
  } else {
    const emailInput = $('acct-email') as HTMLInputElement | null;
    const pwInput = $('acct-email-pw') as HTMLInputElement | null;
    const email = (emailInput?.value ?? '').trim();
    const pw = pwInput?.value ?? '';
    if (!email || !email.includes('@')) {
      setAcctError('請輸入 email');
      emailInput?.focus();
      return;
    }
    if (!pw) {
      setAcctError('請輸入密碼');
      pwInput?.focus();
      return;
    }
    req.email = email;
    req.password = pw;
  }

  setAcctPending(true);
  const res = await studentLogin(req);
  setAcctPending(false);
  if (res.ok) {
    onStudentLoggedIn(res.data, finishLogin, onJoin);
    return;
  }
  if (res.code === 'password_required') {
    // 這個帳號有設密碼 → 展開密碼欄讓學生補填再送一次
    setAcctPwShown(true);
    setAcctError('這個帳號有設定密碼，輸入密碼後再按一次登入');
    ($('acct-code-pw') as HTMLInputElement | null)?.focus();
    return;
  }
  if (res.code === 'network') {
    setAcctError('連不上伺服器，確認網路後再試一次');
    return;
  }
  setAcctError(
    acctMode === 'code' ? '登入失敗：班級碼、學生碼或密碼不對，再檢查一下' : '登入失敗：email 或密碼不對',
  );
}

/** 帳號分頁 / tab 切換的事件掛載（initPlayer 呼叫一次） */
function initAccountLogin(finishLogin: () => void, onJoin: () => void): void {
  $('login-tab-guest')?.addEventListener('click', () => setLoginTab('guest'));
  $('login-tab-account')?.addEventListener('click', () => setLoginTab('account'));
  $('acct-mode-switch')?.addEventListener('click', () =>
    setAcctMode(acctMode === 'code' ? 'email' : 'code'),
  );

  // 碼欄位：自動大寫 / 只留英數；任何輸入清錯誤
  const teamInput = $('acct-team-code') as HTMLInputElement | null;
  teamInput?.addEventListener('input', () => {
    const v = normalizeRoomCode(teamInput.value);
    if (teamInput.value !== v) teamInput.value = v;
    setAcctError(null);
  });
  const codeInput = $('acct-student-code') as HTMLInputElement | null;
  codeInput?.addEventListener('input', () => {
    const v = normalizeStudentCode(codeInput.value);
    if (codeInput.value !== v) codeInput.value = v;
    setAcctError(null);
  });
  ['acct-code-pw', 'acct-email', 'acct-email-pw'].forEach((id) =>
    $(id)?.addEventListener('input', () => setAcctError(null)),
  );
  // Enter 送出（帳號分頁）
  document.querySelectorAll<HTMLInputElement>('#login-pane-account input').forEach((el) =>
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') ($('acct-login-btn') as HTMLButtonElement | null)?.click();
    }),
  );

  $('acct-login-btn')?.addEventListener('click', () => void submitAccountLogin(finishLogin, onJoin));
}

/** 頭像下拉「登出帳號」：清 token、斷線回訪客、回登入 modal（快速進場分頁） */
function initLogout(): void {
  syncAccountUi();
  $('player-logout')?.addEventListener('click', () => {
    $('player-hud')?.classList.remove('open');
    clearStudentSession();
    studentSession = null;
    syncAccountUi();
    forgetRoom();
    bus.emit('student-logout', {}); // net/ws.ts：主動斷線、不自動重連
    setRoomTag(null);
    toast('👋 已登出帳號，回到訪客模式', 'success');
    setLoginTab('guest');
    showLoginModal();
  });
}

/**
 * 邀請連結設密碼頁（?invite=TOKEN）：蓋在登入 modal 之上。
 * 載入 GET /auth/student/invite/{token} 顯示歡迎詞 → 設密碼（≥8）+ 確認 → accept 成功 = 已登入。
 * token 無效（404）顯示「邀請連結已失效，請老師重寄」。
 */
function initInvite(inviteToken: string, finishLogin: () => void, onJoin: () => void): void {
  const modal = $('invite-modal');
  if (!modal) return;

  const showPane = (pane: 'loading' | 'valid' | 'invalid'): void => {
    const loading = $('invite-loading');
    const valid = $('invite-valid');
    const invalid = $('invite-invalid');
    if (loading) loading.hidden = pane !== 'loading';
    if (valid) valid.hidden = pane !== 'valid';
    if (invalid) invalid.hidden = pane !== 'invalid';
  };
  const setErr = (text: string | null): void => {
    const err = $('invite-error');
    if (err) {
      err.textContent = text ?? '';
      err.hidden = !text;
    }
  };
  /** 完成 / 放棄後把 ?invite= 從網址拿掉（重整不再重跑邀請流程） */
  const stripInviteParam = (): void => {
    const url = new URL(location.href);
    url.searchParams.delete('invite');
    history.replaceState(null, '', url.toString());
  };
  const pwInput = (): HTMLInputElement | null => $('invite-pw') as HTMLInputElement | null;
  const pw2Input = (): HTMLInputElement | null => $('invite-pw2') as HTMLInputElement | null;

  modal.classList.add('show');
  showPane('loading');
  void (async () => {
    const info = await fetchInviteInfo(inviteToken);
    if (!info.ok) {
      if (info.code === 'network') {
        const title = document.querySelector('#invite-invalid .level-intro-title');
        const body = document.querySelector('#invite-invalid .level-intro-body');
        if (title) title.textContent = '連不上伺服器';
        if (body) body.textContent = '目前連不上伺服器，確認網路後重新整理再試一次。';
      }
      showPane('invalid');
      return;
    }
    const welcome = $('invite-welcome');
    if (welcome) {
      welcome.textContent =
        `嗨 ${info.data.name}，歡迎加入「${info.data.teamName}」！` +
        `設定一組密碼，之後就能用 ${info.data.email} 登入。`;
    }
    showPane('valid');
    pwInput()?.focus();
  })();

  [pwInput(), pw2Input()].forEach((el) => el?.addEventListener('input', () => setErr(null)));
  document.querySelectorAll<HTMLInputElement>('#invite-valid input').forEach((el) =>
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') ($('invite-submit') as HTMLButtonElement | null)?.click();
    }),
  );

  $('invite-submit')?.addEventListener('click', () =>
    void (async () => {
      const pw = pwInput()?.value ?? '';
      const pw2 = pw2Input()?.value ?? '';
      if (pw.length < 8) {
        setErr('密碼至少 8 碼');
        pwInput()?.focus();
        return;
      }
      if (pw !== pw2) {
        setErr('兩次輸入的密碼不一樣');
        pw2Input()?.focus();
        return;
      }
      const btn = $('invite-submit') as HTMLButtonElement | null;
      if (btn) {
        btn.disabled = true;
        btn.textContent = '設定中…';
      }
      const res = await acceptInvite({ inviteToken, password: pw });
      if (btn) {
        btn.disabled = false;
        btn.textContent = '完成設定，開始飛行';
      }
      if (res.ok) {
        stripInviteParam();
        modal.classList.remove('show');
        onStudentLoggedIn(res.data, finishLogin, onJoin);
        return;
      }
      if (res.code === 'network') {
        setErr('連不上伺服器，確認網路後再試一次');
        return;
      }
      if (res.code === 'not_found' || res.code === 'unauthorized') {
        showPane('invalid'); // 送出瞬間剛好失效 / 被老師重寄作廢
        return;
      }
      setErr('設定失敗，請稍後再試');
    })(),
  );

  // 失效頁「回登入頁」：收起邀請 overlay，露出底下的登入 modal
  $('invite-close')?.addEventListener('click', () => {
    stripInviteParam();
    modal.classList.remove('show');
  });
}

// ---- 登入 modal 元素 ----
const roomInput = (): HTMLInputElement | null => $('login-room') as HTMLInputElement | null;
const roomPwInput = (): HTMLInputElement | null => $('login-room-pw') as HTMLInputElement | null;

function setRoomError(text: string | null, field: 'code' | 'pw' | null = null): void {
  const err = $('login-room-error');
  const form = document.querySelector('#login-modal .login-form');
  if (err) {
    err.textContent = text ?? '';
    err.hidden = !text;
  }
  form?.classList.toggle('has-error', field === 'code');
  form?.classList.toggle('has-error-pw', field === 'pw');
}

/** URL ?room= 帶入 → 欄位唯讀鎖定；被拒 / 點「換房」時解鎖 */
function setRoomLocked(locked: boolean): void {
  const input = roomInput();
  const hint = $('login-room-hint');
  if (input) input.readOnly = locked;
  if (hint) hint.textContent = locked ? '房間碼由老師的網址帶入（點房間碼可修改）' : '沒有房間碼？留空即可';
}

/** 進房等待態：按鈕「加入中…」+ disabled；逾時放行 */
let joinTimer: number | null = null;
function setJoinPending(on: boolean): void {
  const btn = $('login-start') as HTMLButtonElement | null;
  if (btn) {
    btn.disabled = on;
    btn.textContent = on ? '加入中…' : '開始飛行';
  }
  if (!on && joinTimer) {
    clearTimeout(joinTimer);
    joinTimer = null;
  }
}

function showLoginModal(opts: { focusRoom?: boolean } = {}): void {
  const modal = $('login-modal');
  if (!modal) return;
  const nameInput = $('login-name') as HTMLInputElement | null;
  if (nameInput && player.name) nameInput.value = player.name;
  document.querySelectorAll('.emoji-btn').forEach((b) => {
    b.classList.toggle('selected', b.getAttribute('data-emoji') === player.emoji);
  });
  const rc = roomInput();
  if (rc) rc.value = player.roomCode;
  const pw = roomPwInput();
  if (pw) pw.value = player.roomPassword;
  setJoinPending(false);
  modal.classList.add('show');
  if (opts.focusRoom) {
    setRoomLocked(false); // 主動換房 → 解除 URL 鎖定
    rc?.focus();
    rc?.select();
  } else if (!player.name) {
    nameInput?.focus();
  }
}

function hideLoginModal(): void {
  $('login-modal')?.classList.remove('show');
  setJoinPending(false);
  const hud = $('player-hud');
  const display = $('player-name-display');
  if (hud && display) {
    display.textContent = `${player.name}${player.emoji}`;
    hud.style.display = 'flex';
  }
  const av = $('player-avatar-emoji');
  if (av) av.textContent = player.emoji || '🙂';
}

/** header 房間標籤：「房名 · 房碼」；名稱等於房碼時只顯示房碼 */
function setRoomTag(room: { code: string; name: string } | null): void {
  const tag = $('room-tag');
  if (!tag) return;
  if (!room) {
    tag.style.display = 'none';
    return;
  }
  const name = $('room-tag-name');
  const code = $('room-tag-code');
  if (name) name.textContent = room.name && room.name !== room.code ? room.name : '';
  if (code) code.textContent = room.code;
  tag.title = `房間：${room.name || room.code}（點擊換房）`;
  tag.style.display = 'inline-flex';
}

/**
 * 登入 / 進房流程。onJoin：以目前 player 身分（重新）連線並 register（main 傳 net/ws.rejoin）。
 * - 沒填房間碼 → 立刻收 modal、進預設房（向後相容；離線也能玩）
 * - 有填房間碼 → modal 留著等 room_joined（成功收起）/ room_rejected（顯示文案讓使用者改）；
 *   逾時（伺服器沒回）先放行單機遊玩，連上後 register 會自動再進房
 */
export function initPlayer(onJoin: () => void): void {
  document.querySelectorAll('.emoji-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.emoji-btn').forEach((b) => b.classList.remove('selected'));
      btn.classList.add('selected');
      player.emoji = btn.getAttribute('data-emoji') ?? '';
    });
  });

  // 房間碼：自動大寫 / 只留英數；改動就清錯誤
  roomInput()?.addEventListener('input', (e) => {
    const el = e.target as HTMLInputElement;
    const v = normalizeRoomCode(el.value);
    if (el.value !== v) el.value = v;
    setRoomError(null);
  });
  roomPwInput()?.addEventListener('input', () => setRoomError(null));
  // 唯讀（URL 帶入）時點一下就解鎖可改
  roomInput()?.addEventListener('click', () => {
    if (roomInput()?.readOnly) setRoomLocked(false);
  });
  // Enter 送出
  document.querySelectorAll<HTMLInputElement>('#login-modal input').forEach((el) =>
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') ($('login-start') as HTMLButtonElement | null)?.click();
    }),
  );

  /** modal 收起 + 通知（新手引導等） */
  const finishLogin = (): void => {
    hideLoginModal();
    bus.emit('player-ready', {});
  };

  $('login-start')?.addEventListener('click', () => {
    const name = ((($('login-name') as HTMLInputElement | null)?.value) ?? '').trim();
    if (!name) {
      toast('請輸入名字', 'error');
      $('login-name')?.focus();
      return;
    }
    if (!player.emoji) {
      toast('請選一個動物', 'error');
      return;
    }
    const code = normalizeRoomCode(roomInput()?.value ?? '');
    if (code && code.length < 4) {
      setRoomError('房間碼是 4 碼英數（老師給的），或留空進預設房', 'code');
      roomInput()?.focus();
      return;
    }
    const roomChanged = code !== player.roomCode;
    player.name = name;
    player.roomCode = code;
    player.roomPassword = code ? (roomPwInput()?.value ?? '') : '';
    savePlayer();
    setRoomError(null);
    if (roomChanged) {
      // 換房：先退出大亂鬥 / 足球等接管型模式（賽局屬於舊房）
      bus.emit('mode-takeover', { mode: 'level' });
      setRoomTag(null);
    }
    if (!code) {
      // 預設房：不等伺服器（離線也要能玩）
      finishLogin();
      toast(`✓ 歡迎 ${player.name}${player.emoji}！`, 'success');
      setTimeout(onJoin, 200);
      return;
    }
    // 指定房間：等 room_joined / room_rejected；逾時放行
    setJoinPending(true);
    onJoin();
    joinTimer = window.setTimeout(() => {
      joinTimer = null;
      if (!$('login-modal')?.classList.contains('show')) return;
      finishLogin();
      toast('⚠️ 還沒連上老師伺服器，連上後會自動加入房間', 'warning');
    }, JOIN_TIMEOUT_MS);
  });

  // ---- 房間事件（net/ws.ts）----
  bus.on('room-joined', ({ room }) => {
    setRoomTag(room);
    if ($('login-modal')?.classList.contains('show')) {
      finishLogin();
      toast(`✓ 已加入 ${room.name || room.code}，歡迎 ${player.name}${player.emoji}！`, 'success');
    }
  });
  bus.on('room-rejected', ({ reason }) => {
    setRoomTag(null);
    const shown = $('login-modal')?.classList.contains('show');
    if (!shown) showLoginModal({ focusRoom: true });
    setJoinPending(false);
    setRoomLocked(false); // URL 帶入的碼也可能是錯的 → 解鎖讓使用者改
    setRoomError(REJECT_TEXT[reason] ?? '無法加入房間', reason === 'bad_password' ? 'pw' : 'code');
    if (reason === 'bad_password') {
      const pw = roomPwInput();
      pw?.focus();
      pw?.select();
    } else {
      const rc = roomInput();
      rc?.focus();
      rc?.select();
    }
  });
  bus.on('room-left', () => {
    // 被踢 / 關房：清房間碼、回登入 modal（房間碼欄位清空並聚焦）；不自動重連（ws 已 stopped）
    forgetRoom();
    setRoomTag(null);
    showLoginModal({ focusRoom: true });
    setRoomError(null);
    const rc = roomInput();
    if (rc) rc.value = '';
    const pw = roomPwInput();
    if (pw) pw.value = '';
  });
  // header 房間標籤：點擊換房
  $('room-tag')?.addEventListener('click', () => showLoginModal({ focusRoom: true }));

  // 頭像下拉 + 改名
  const hud = $('player-hud');
  const avatar = $('player-avatar');
  avatar?.addEventListener('click', (e) => {
    e.stopPropagation();
    hud?.classList.toggle('open');
  });
  document.addEventListener('click', (e) => {
    if (hud && !hud.contains(e.target as Node)) hud.classList.remove('open');
  });
  $('player-rename')?.addEventListener('click', () => {
    hud?.classList.remove('open');
    showLoginModal();
  });

  // ---- 學生帳號模式（快速進場分頁 = 既有訪客流程，行為零改變）----
  initAccountLogin(finishLogin, onJoin);
  initLogout();

  const qs = new URLSearchParams(location.search);

  // 邀請連結（?invite=TOKEN）：設密碼 overlay 蓋在登入 modal 之上，完成即登入
  const inviteToken = qs.get('invite');
  if (inviteToken) {
    showLoginModal();
    initInvite(inviteToken, finishLogin, onJoin);
    return;
  }

  // 90 天自動登入：有存 token → 直接帳號模式連線（register 帶 token），背景驗證 + 滑動延長
  studentSession = loadStudentSession();
  syncAccountUi();
  if (studentSession) {
    player.name = studentSession.me.name;
    player.emoji = studentSession.me.emoji;
    player.roomCode = '';
    player.roomPassword = '';
    hideLoginModal();
    bus.emit('player-ready', {});
    setTimeout(onJoin, 200);
    void fetchStudentMe(studentSession.token).then((res) => {
      if (res.ok) {
        // 驗證通過：身分以 DB 最新為準（老師改名 / 換 emoji 下次開頁生效）
        touchStudentSession(res.data);
        player.name = res.data.name;
        player.emoji = res.data.emoji;
        const display = $('player-name-display');
        if (display) display.textContent = `${player.name}${player.emoji}`;
        const av = $('player-avatar-emoji');
        if (av) av.textContent = player.emoji || '🙂';
      } else if (res.code === 'unauthorized' || res.code === 'not_found') {
        // token 失效：清掉（下次手動登入）；本次伺服器已回退訪客，照常玩
        clearStudentSession();
        studentSession = null;
        syncAccountUi();
        toast('⚠️ 帳號登入已過期，下次進場請重新登入', 'warning');
      }
      // network：離線教室照常單機玩，token 保留下次再驗
    });
    return;
  }

  // ---- 訪客流程（與帳號功能加入前完全相同）----
  // 開發後門：?autologin=1 直接以測試身分登入（headless 截圖 / demo 用；
  // 可用 &name= / &emoji= 指定身分 → 多開視窗驗多人時避免同名擠下線；&room= / &roompw= 指定房間）
  const urlRoom = normalizeRoomCode(qs.get('room') ?? '');
  if (qs.get('autologin') === '1' && !loadPlayer()) {
    player.name = qs.get('name') || '測試';
    player.emoji = qs.get('emoji') || '🐬';
    savePlayer();
  }

  if (loadPlayer()) {
    if (urlRoom) {
      // 老師投影的網址帶碼 → 覆蓋上次的房間碼直接進房（密碼由 &roompw= 或 modal 補）
      if (urlRoom !== player.roomCode) player.roomPassword = '';
      player.roomCode = urlRoom;
      if (qs.get('roompw')) player.roomPassword = qs.get('roompw') ?? '';
      savePlayer();
    }
    hideLoginModal();
    bus.emit('player-ready', {});
    setTimeout(onJoin, 200); // 已登入（重新整理）也要自動連線
  } else {
    if (urlRoom) {
      player.roomCode = urlRoom;
      const rc = roomInput();
      if (rc) rc.value = urlRoom;
      setRoomLocked(true);
    }
    showLoginModal();
  }
}

// =============================================================================
// 關卡 intro / 倒數 / 選單
// =============================================================================
export function initOverlays(): void {
  // 靜態 HTML 的 <span data-icon> 圖標掛載（鉻件 SVG 圖標，設計系統 §4）
  mountIcons();

  // ---- 關卡 intro ----
  // ?autostart=1：headless 截圖 / 自動化測試用 — 跳過「開始」按鈕直接啟動
  const autoStart = new URLSearchParams(location.search).get('autostart') === '1';
  bus.on('level-intro', ({ level }) => {
    if (autoStart) {
      armLevelStart();
      return;
    }
    const modal = $('level-intro');
    if (!modal) return;
    const title = modal.querySelector('.level-intro-title');
    const body = modal.querySelector('.level-intro-body');
    if (title) title.textContent = `${level.id} · ${level.name}`;
    if (body) body.textContent = level.intro ?? '';
    modal.classList.add('show');
  });
  bus.on('level-armed', () => $('level-intro')?.classList.remove('show'));
  // 關卡清除（進大亂鬥）：關掉 intro、取消關卡按鈕高亮
  bus.on('level-cleared', () => {
    $('level-intro')?.classList.remove('show');
    document.querySelectorAll('.level-btn').forEach((b) => b.classList.remove('active'));
  });
  $('level-intro-start')?.addEventListener('click', () => armLevelStart());

  // ---- 3-2-1 倒數 ----
  bus.on('countdown', ({ n }) => {
    const el = $('countdown-overlay');
    if (!el) return;
    if (n > 0) {
      el.textContent = String(n);
      el.className = '';
      void el.offsetWidth; // 重新觸發 pop 動畫
      el.className = 'show';
    } else {
      el.textContent = 'GO!';
      el.className = 'show go';
      setTimeout(() => {
        el.className = '';
      }, 650);
    }
  });

  // ---- 關卡選單（動態建立，三章；draw 關加畫筆圖標）----
  // 老師鎖定關卡：選單停用，只能由老師廣播切關
  let levelLocked = false;
  bus.on('level-lock', ({ locked }) => {
    levelLocked = locked;
    $('level-selector')?.classList.toggle('locked', locked);
    const toggle = $('level-menu-toggle');
    if (toggle) {
      toggle.innerHTML = locked
        ? `${iconHtml('lock')}<span>關卡</span>`
        : `${iconHtml('map')}<span>關卡</span><span class="btn-ic chev">${iconHtml('chevron-down')}</span>`;
      toggle.title = locked ? '老師已鎖定關卡選擇' : '選擇關卡';
    }
    if (locked) closeLevelMenu();
  });
  // 已完成勾勾（帳號模式）：progress_sync 下發或 complete_ack 本地併入 → 重畫所有關卡按鈕的標記
  const applyProgressMarks = (): void => {
    document.querySelectorAll<HTMLButtonElement>('.level-btn').forEach((btn) => {
      const p = progressState.progress[btn.dataset['level'] ?? ''];
      const mark = btn.querySelector('.lvl-check');
      if (p) {
        if (!mark) btn.insertAdjacentHTML('beforeend', `<span class="lvl-check">${iconHtml('check', 14)}</span>`);
        btn.classList.add('completed');
        btn.title =
          p.bestTimeMs != null ? `已完成 · 最佳 ${(p.bestTimeMs / 1000).toFixed(1)} 秒` : '已完成';
      } else {
        mark?.remove();
        btn.classList.remove('completed');
        if (!btn.classList.contains('entitlement-locked')) btn.removeAttribute('title');
      }
    });
  };
  const applyEntitlementMarks = (): void => {
    const ent = loadEntitlement();
    document.querySelectorAll<HTMLButtonElement>('.level-btn').forEach((btn) => {
      const lid = btn.dataset['level'] ?? '';
      const gated = !!(ent && ent.mode !== 'open' && !canLoadLevel(lid));
      btn.classList.toggle('entitlement-locked', gated);
      if (gated) {
        btn.title =
          ent?.mode === 'licensed'
            ? '此關卡不在班級授權範圍內'
            : '試玩版未開放此關卡';
      }
    });
  };
  const refreshLevelButtons = (): void => {
    applyProgressMarks();
    applyEntitlementMarks();
  };
  bus.on('progress-updated', refreshLevelButtons);
  bus.on('entitlement-updated', refreshLevelButtons);
  bus.on('levels-ready', ({ levels }) => {
    const holder = $('level-selector-btns');
    if (!holder) return;
    holder.innerHTML = '';
    const makeBtn = (level: (typeof levels)[number]): HTMLButtonElement => {
      const btn = document.createElement('button');
      btn.className = 'level-btn';
      btn.dataset['level'] = level.id;
      const isDraw = !!(level.draw || level.view);
      if (isDraw) btn.insertAdjacentHTML('beforeend', iconHtml('pencil'));
      const label = document.createElement('span');
      label.textContent = `${level.id} ${level.name}`;
      btn.appendChild(label);
      btn.addEventListener('click', () => {
        if (levelLocked) {
          toast('🔒 老師已鎖定關卡，無法自行切換', 'warning');
          return;
        }
        loadLevel(level.id);
        closeLevelMenu();
      });
      return btn;
    };
    // 章節導覽：依章分組 + 章名標題（chapters 空時退回平鋪，行為與舊版相同）
    if (levelState.chapters.length > 0) {
      levelState.chapters.forEach((ch) => {
        const title = document.createElement('div');
        title.className = 'level-chapter-title';
        title.textContent = `第 ${ch.chapter} 章 · ${ch.name}`;
        holder.appendChild(title);
        ch.levels.forEach((level) => holder.appendChild(makeBtn(level)));
      });
    } else {
      levels.forEach((level) => holder.appendChild(makeBtn(level)));
    }
    applyProgressMarks(); // progress_sync 比關卡資料早到（帳號模式剛連上）→ 建完選單補畫勾勾
    applyEntitlementMarks();
  });
  bus.on('level-loaded', ({ level }) => {
    document
      .querySelectorAll('.level-btn')
      .forEach((b) => b.classList.toggle('active', b.getAttribute('data-level') === level.id));
  });
  const closeLevelMenu = (): void => {
    $('level-selector')?.classList.remove('open');
  };
  $('level-menu-toggle')?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (levelLocked) {
      toast('🔒 老師已鎖定關卡，無法自行切換', 'warning');
      return;
    }
    $('level-selector')?.classList.toggle('open');
  });
  document.addEventListener('click', (e) => {
    const ls = $('level-selector');
    if (ls?.classList.contains('open') && !ls.contains(e.target as Node)) closeLevelMenu();
  });

  // ---- 模式切換（segmented：active 段由 body.mode-* class 驅動，見 style.css）----
  bus.on('mode-changed', ({ mode }) => {
    document.body.classList.toggle('mode-manual', mode === 'manual');
    document.body.classList.toggle('mode-program', mode === 'program');
    const btn = $('mode-mp-toggle');
    if (btn)
      btn.title =
        mode === 'manual' ? '目前：手動模式（點擊切到程式模式）' : '目前：程式模式（點擊切到手動模式）';
  });
  $('mode-mp-toggle')?.addEventListener('click', () => {
    if (programState.running) {
      toast('⏳ 程式執行中，無法切換模式', 'error');
      return;
    }
    setMode(flags.mode === 'manual' ? 'program' : 'manual');
  });
  // URL ?mode=program（headless 截圖 / 深連結用）
  const modeParam = new URLSearchParams(location.search).get('mode');
  if (modeParam === 'program' || modeParam === 'manual') {
    setTimeout(() => setMode(modeParam), 200);
  }

  // ---- header 按鈕 ----
  $('home-btn')?.addEventListener('click', () => goHome());
  initPause();
  initFullscreen();

  // ---- Blockly 工具列（積木內容由後續任務實作；API 已就緒）----
  $('btn-run')?.addEventListener('click', () => {
    const provider = (window as unknown as Record<string, unknown>)['__creaflyGetCode'];
    if (typeof provider === 'function') {
      const code = (provider as () => string)();
      runProgram(code);
    } else {
      toast('🧩 積木編輯器開發中 — 可先用 window.CREAFLY.runProgram(code) 測試', 'warning');
    }
  });
  $('btn-stop')?.addEventListener('click', () => stopProgram());
  $('btn-reset')?.addEventListener('click', () => resetMission());

  // iPad/iOS：擋掉雙指縮放
  ['gesturestart', 'gesturechange', 'gestureend'].forEach((ev) =>
    document.addEventListener(ev, (e) => e.preventDefault(), { passive: false }),
  );

  void levelState;
}

/** 暫停：header 按鈕 + P 鍵 + overlay（繼續 / 重新本關）；多人賽局中收起按鈕 */
function initPause(): void {
  const btn = $('pause-btn') as HTMLButtonElement | null;
  if (!btn) return;

  const setBtn = (paused: boolean): void => {
    btn.innerHTML = paused
      ? `${iconHtml('play')}<span>繼續</span>`
      : `${iconHtml('pause')}<span>暫停</span>`;
    btn.classList.toggle('active', paused);
  };

  bus.on('level-paused', ({ paused }) => {
    setBtn(paused);
    $('pause-overlay')?.classList.toggle('show', paused);
  });
  // 換關（含老師廣播切關）會直接清掉暫停旗標 → UI 同步復位
  bus.on('level-loaded', () => {
    setBtn(false);
    $('pause-overlay')?.classList.remove('show');
  });

  btn.addEventListener('click', () => togglePause());
  $('pause-resume')?.addEventListener('click', () => resumeGame());
  $('pause-restart')?.addEventListener('click', () => {
    resumeGame();
    if (levelState.current) loadLevel(levelState.current.id);
  });

  // P 鍵切換（輸入框聚焦時不攔截）
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'p' && e.key !== 'P') return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (btn.style.display === 'none') return; // 多人賽局中不可暫停
    togglePause();
  });

  // 多人賽局（伺服器權威時間）不可暫停 → 收起按鈕；回一般關卡再顯示
  const setVisible = (show: boolean): void => {
    btn.style.display = show ? '' : 'none';
  };
  bus.on('arena-entered', () => setVisible(false));
  bus.on('soccer-entered', () => setVisible(false));
  bus.on('arena-exited', () => setVisible(true));
  bus.on('soccer-exited', () => setVisible(true));
  bus.on('level-cleared', () => {
    // 進賽局前的清關：若正暫停中先恢復，避免賽局被凍結
    resumeGame();
  });
}

/** 視角按鈕文字同步（點按鈕與按 C 鍵共用；由 main 呼叫）。label 由 CameraRig 決定（足球中三段循環）。 */
export function syncViewButton(view: { label: string; fpv: boolean }): void {
  const btn = $('view-btn');
  if (!btn) return;
  btn.innerHTML = `${iconHtml('eye')}<span>視角：${view.label}</span>`;
  btn.classList.toggle('active', view.fpv);
}

function initFullscreen(): void {
  const btn = $('fullscreen-btn');
  if (!btn) return;
  const doc = document as Document & {
    webkitFullscreenElement?: Element | null;
    webkitExitFullscreen?: () => void;
  };
  const fsEl = (): Element | null => document.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
  const update = (): void => {
    const on = !!fsEl();
    btn.innerHTML = on
      ? `${iconHtml('minimize')}<span>離開全螢幕</span>`
      : `${iconHtml('expand')}<span>全螢幕</span>`;
    btn.classList.toggle('active', on);
  };
  btn.addEventListener('click', () => {
    const el = document.documentElement as HTMLElement & {
      webkitRequestFullscreen?: () => Promise<void> | void;
    };
    if (!fsEl()) {
      const req = el.requestFullscreen ?? el.webkitRequestFullscreen;
      if (req) {
        try {
          void Promise.resolve(req.call(el)).catch(() => undefined);
        } catch {
          /* ignore */
        }
      } else {
        toast('此瀏覽器不支援全螢幕', 'warning');
      }
    } else {
      const exit = document.exitFullscreen ?? doc.webkitExitFullscreen;
      try {
        void exit?.call(document);
      } catch {
        /* ignore */
      }
    }
  });
  document.addEventListener('fullscreenchange', update);
  document.addEventListener('webkitfullscreenchange', update);
}
