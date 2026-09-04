// 老師後台進入點 — 帳號登入（email + 密碼 → session）→ 儀表板（REST 資料 + WS 即時名單）。
// 開頁：有 session → GET /me 驗證（成功同時滑動延長）→ 儀表板；401 → 清 session 回登入；
//       連不上伺服器 / 503 → 不清 session，顯示離線畫面自動重試（斷網不該把人登出）。
// 失效（WS 4401 / /me 401）：儀表板早已把選定房 + 分頁寫進 sessionStorage（resume.ts），重登後自動恢復。
import './style.css';
import {
  ApiError,
  changePassword,
  clearSession,
  fetchInfo,
  fetchLevels,
  isOfflineError,
  loadSession,
  login,
  logout,
  me,
  saveSession,
  touchSession,
} from './api';
import { toast } from './toast';
import { TeacherWs } from './ws';
import { DEV_EMAIL, DEV_PASSWORD, renderLogin, renderOffline } from './views/login';
import { renderDashboard, type DashboardView } from './views/dashboard';
import { clearResume, loadResume } from './resume';

const app = document.getElementById('app')!;
let wsClient: TeacherWs | null = null;
let dashboard: DashboardView | null = null;
/** 免登入模式（伺服器 TEACHER_AUTH_DISABLED=1，由 /api/info 得知）：登入頁多「測試模式：直接進入」 */
let authDisabled = false;
let registerCodeRequired = false;

function teardown(): void {
  wsClient?.stop();
  wsClient = null;
  dashboard?.destroy();
  dashboard = null;
}

function showLogin(notice?: string): void {
  teardown();
  const params = new URLSearchParams(location.search);
  const resetToken = params.get('reset') ?? undefined;
  renderLogin(app, {
    onSuccess: () => void enterDashboard(),
    authDisabled,
    registerCodeRequired,
    resetToken,
    notice,
    initialTab: resetToken ? 'reset' : 'login',
  });
}

/** session 失效（WS 4401 / /me 401）：清 token、回登入；resume 狀態保留給重登後恢復 */
function sessionExpired(): void {
  clearSession();
  showLogin('登入已過期，請重新登入');
}

/** 老師自己按登出：伺服器撤銷 + 本地清 session + 不再恢復上次狀態 */
async function doLogout(): Promise<void> {
  teardown();
  await logout();
  clearSession();
  clearResume();
  showLogin();
}

/** 免登入模式自動取票（伺服器不驗密碼）；失敗回傳 false 落回登入畫面 */
async function devLogin(): Promise<boolean> {
  try {
    saveSession(await login(DEV_EMAIL, DEV_PASSWORD));
    return true;
  } catch {
    return false;
  }
}

async function enterDashboard(): Promise<void> {
  teardown();
  // REST 資料抓不到就以 null 呈現（畫面顯示 —），不擋整個後台
  const [info, levels] = await Promise.all([
    fetchInfo().catch(() => {
      toast('讀不到伺服器資訊（/api/info）', 'error');
      return null;
    }),
    fetchLevels().catch(() => {
      toast('讀不到關卡清單（/api/levels）', 'error');
      return null;
    }),
  ]);

  const client = new TeacherWs(
    () => loadSession()?.ticket ?? null,
    {
      onStatus: (connected) => view.setWsStatus(connected),
      onStudents: (list) => view.setStudents(list),
      onArena: (msg) => view.onArenaMsg(msg),
      onSoccer: (msg) => view.onSoccerMsg(msg),
      onLock: (locked) => view.setLevelLock(locked),
      onRooms: (rooms, selected, teams) => view.setRooms(rooms, selected, teams),
      onUnauthorized: () => {
        clearSession();
        if (authDisabled) {
          // 免登入模式：票失效（如伺服器重啟）就靜靜換一張，不打擾使用者
          void devLogin().then((ok) => (ok ? client.connect() : showLogin()));
          return;
        }
        sessionExpired();
      },
    },
  );
  wsClient = client;

  const view = renderDashboard(app, {
    info,
    levels,
    me: loadSession()?.me ?? null,
    resume: loadResume(),
    send: (payload) => client.broadcast(payload),
    sendGame: (msg) => client.send(msg), // 賽局 / 房間管理訊息同一條路（roomCode 由 ws 補）
    onChangePassword: (cur, next) => changePassword(cur, next),
    onLogout: () => void doLogout(),
  });
  dashboard = view;
  client.connect();
}

/** 有 session 時的開頁驗證：true = 已進儀表板；false = 仍在離線/登入畫面 */
async function verifyAndEnter(): Promise<boolean> {
  try {
    touchSession(await me());
    await enterDashboard();
    return true;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      sessionExpired();
      return true; // 已離開離線畫面（回登入）
    }
    if (!isOfflineError(err)) {
      // 其他非預期錯誤（4xx）：也不貿然登出，當離線處理、讓老師自己決定
      console.warn('[auth] /me 失敗', err);
    }
    return false;
  }
}

async function boot(): Promise<void> {
  const session = loadSession();
  if (session) {
    // 免登入模式旗標背景更新（之後 session 失效回登入頁時才知道要不要顯示「測試模式」鈕）
    void fetchInfo()
      .then((i) => {
        authDisabled = !!i.teacherAuthDisabled;
        registerCodeRequired = !!i.teacherRegisterCodeRequired;
      })
      .catch(() => {});
    if (await verifyAndEnter()) return;
    renderOffline(app, {
      name: session.me.name,
      onRetry: verifyAndEnter,
      onLogout: () => void doLogout(),
    });
    return;
  }

  // 免登入模式偵測：伺服器 TEACHER_AUTH_DISABLED=1 時登入頁多一顆「測試模式：直接進入」
  authDisabled = await fetchInfo()
    .then((i) => {
      registerCodeRequired = !!i.teacherRegisterCodeRequired;
      return !!i.teacherAuthDisabled;
    })
    .catch(() => false);

  // 開發後門：URL ?dev=1（舊 ?pin= 同義）直接以測試帳號登入（headless 截圖測試用；伺服器有驗密碼時會 401 落回登入畫面）
  const params = new URLSearchParams(location.search);
  if (params.has('dev') || params.has('pin')) {
    if (await devLogin()) {
      await enterDashboard();
      return;
    }
  }
  showLogin();
}

void boot();
