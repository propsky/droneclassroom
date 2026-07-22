// 老師後台進入點 — 登入（PIN → ticket）→ 儀表板（REST 資料 + WS 即時名單）。
import './style.css';
import { clearTicket, fetchInfo, fetchLevels, loadTicket, saveTicket, teacherLogin } from './api';
import { toast } from './toast';
import { TeacherWs } from './ws';
import { renderLogin } from './views/login';
import { renderDashboard } from './views/dashboard';

const app = document.getElementById('app')!;
let wsClient: TeacherWs | null = null;
/** 免登入模式（伺服器 TEACHER_AUTH_DISABLED=1，由 /api/info 得知）：跳過登入畫面自動取票 */
let authDisabled = false;

function showLogin(): void {
  wsClient?.stop();
  wsClient = null;
  renderLogin(app, () => void enterDashboard());
}

/** 免登入模式自動取票（伺服器不驗密碼，空字串即可）；失敗回傳 false 落回登入畫面 */
async function autoLogin(): Promise<boolean> {
  try {
    saveTicket(await teacherLogin(''));
    return true;
  } catch {
    return false;
  }
}

async function enterDashboard(): Promise<void> {
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
    () => loadTicket()?.ticket ?? null,
    {
      onStatus: (connected) => view.setWsStatus(connected),
      onStudents: (list) => view.setStudents(list),
      onArena: (msg) => view.onArenaMsg(msg),
      onSoccer: (msg) => view.onSoccerMsg(msg),
      onUnauthorized: () => {
        clearTicket();
        if (authDisabled) {
          // 免登入模式：票失效（如伺服器重啟）就靜靜換一張，不打擾使用者
          void autoLogin().then((ok) => (ok ? client.connect() : showLogin()));
          return;
        }
        toast('登入已過期，請重新輸入 PIN', 'error');
        showLogin();
      },
    },
  );
  wsClient = client;

  const view = renderDashboard(app, {
    info,
    levels,
    send: (payload) => client.broadcast(payload),
    sendGame: (msg) => client.send(msg),
    onLogout: () => {
      clearTicket();
      showLogin();
    },
  });
  client.connect();
}

async function boot(): Promise<void> {
  // 免登入模式偵測：伺服器 TEACHER_AUTH_DISABLED=1 時跳過登入畫面
  authDisabled = await fetchInfo()
    .then((i) => !!i.teacherAuthDisabled)
    .catch(() => false);
  if (authDisabled && !loadTicket()) await autoLogin();

  // 開發後門：URL ?pin=xxx 自動登入（headless 截圖測試用，正式環境 PIN 錯就照常回登入畫面）
  const urlPin = new URLSearchParams(location.search).get('pin');
  if (!loadTicket() && urlPin) {
    try {
      saveTicket(await teacherLogin(urlPin));
    } catch {
      /* 自動登入失敗 → 落到手動登入畫面 */
    }
  }
  if (loadTicket()) await enterDashboard();
  else showLogin();
}

void boot();
