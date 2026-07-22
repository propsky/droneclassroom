// 老師後台進入點 — 登入（PIN → ticket）→ 儀表板（REST 資料 + WS 即時名單）。
import './style.css';
import { clearTicket, fetchInfo, fetchLevels, loadTicket, saveTicket, teacherLogin } from './api';
import { toast } from './toast';
import { TeacherWs } from './ws';
import { renderLogin } from './views/login';
import { renderDashboard } from './views/dashboard';

const app = document.getElementById('app')!;
let wsClient: TeacherWs | null = null;

function showLogin(): void {
  wsClient?.stop();
  wsClient = null;
  renderLogin(app, () => void enterDashboard());
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
