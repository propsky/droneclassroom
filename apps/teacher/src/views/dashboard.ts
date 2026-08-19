// 儀表板 — 版面資訊架構依 docs/design-system.md §5.1：
// topbar（品牌 + 連線狀態膠囊含學生數 + 登出）＋ 房間列（跨兩欄）＋ 左欄 380px 學生名冊常駐卡 ＋ 右欄 tab 分區卡片。
// 房間：房間列選房（room_select）→ 名冊卡頭＝選定房（大字房碼 / 鎖房 / 設定 / 關閉）；roomCode 由 ws.ts 統一補，這裡不帶。
// 每張卡片固定結構：卡頭（標題＋賽局狀態膠囊＋停止鈕〔進行中才出現〕）→ 控件區（label 在上）→ 動作列（右對齊，primary 最右）。
// 大亂鬥與足球對齊舊版 teacher.html 的功能：排行榜 / 隊伍名單 / 倒數時鐘 / 勝負 toast。
import type {
  ArenaScoreEntry,
  InfoResponse,
  LevelsResponse,
  RoomInfo,
  RoomSettings,
  SoccerMode,
  SoccerPlayerState,
  SoccerTeam,
  StudentInfo,
  TeacherBroadcastPayload,
  TeacherToServer,
} from '@creafly/shared';
import type { TeacherArenaMsg, TeacherSoccerMsg } from '../ws';
import { ICONS } from '../icons';
import { toast } from '../toast';

export interface DashboardView {
  setWsStatus(connected: boolean): void;
  setStudents(list: StudentInfo[]): void;
  /** 大亂鬥訊息 → 排行榜 / 倒數時鐘 / 勝負 */
  onArenaMsg(msg: TeacherArenaMsg): void;
  /** 足球訊息 → 隊伍名單 / 比分 / 進球與勝負 toast */
  onSoccerMsg(msg: TeacherSoccerMsg): void;
  /** 關卡鎖定狀態（伺服器回送為準）→ 鎖定按鈕 UI */
  setLevelLock(locked: boolean): void;
  /** 房間列表 + 選定房（伺服器 room_list）→ 房間列 / 名冊卡頭 / 連線位址 */
  setRooms(rooms: RoomInfo[], selected: string | null): void;
}

export interface DashboardOptions {
  info: InfoResponse | null;
  levels: LevelsResponse | null;
  /** 廣播給全班；未連線時回 false */
  send(payload: TeacherBroadcastPayload): boolean;
  /** 賽局控制 / 房間管理訊息（大亂鬥 / 足球 / room_*）；未連線時回 false。roomCode 由 ws 層統一補 */
  sendGame(msg: TeacherToServer): boolean;
  onLogout(): void;
}

/** 預設房間（伺服器開機即存在、不可關閉；學生舊網址不帶 ?room= 就進這間）：房碼由伺服器設定（預設 MAIN），
 *  協定沒有 isDefault 欄位 → 以「最早建立」判定（預設房在開機時建立，永遠最早） */
function defaultRoomCode(rooms: RoomInfo[]): string | null {
  let first: RoomInfo | null = null;
  for (const r of rooms) if (!first || r.createdAt < first.createdAt) first = r;
  return first?.code ?? null;
}

/** 房間內有賽局在倒數/進行中（房間列小紅點） */
function roomLive(r: RoomInfo): boolean {
  const live = (s: string): boolean => s === 'countdown' || s === 'running';
  return live(r.arenaStatus) || live(r.soccerStatus);
}

function esc(text: string): string {
  return text.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );
}

/** 24px avatar chip — 學生的動物 emoji 是身分資料，一律收進圓底 chip 與名字並排（§5.1：後台鉻件與內容零 emoji，
 *  不准裸排在文字裡）。connected 給名冊用（chip 右下角上線小點）。 */
function avatarChip(emoji: string | null | undefined, connected?: boolean): string {
  const presence =
    connected === undefined ? '' : `<span class="presence ${connected ? 'on' : 'off'}"></span>`;
  return `<span class="avatar-chip" aria-hidden="true">${esc(emoji ?? '')}${presence}</span>`;
}

/** 舊式複製（教室後台常跑在 http 區網位址 → 沒有 navigator.clipboard 的安全來源） */
function legacyCopy(text: string): boolean {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  ta.remove();
  return ok;
}

/** 關卡下拉：由 /api/levels 動態產生，三章全列（每章一個 optgroup） */
function levelOptions(levels: LevelsResponse | null): string {
  if (!levels || levels.chapters.length === 0) {
    return '<option value="" disabled selected>（讀不到關卡清單）</option>';
  }
  return levels.chapters
    .map(
      (ch) =>
        `<optgroup label="第 ${ch.chapter} 章 ${esc(ch.name)}">` +
        ch.levels.map((l) => `<option value="${esc(l.id)}">${esc(l.id)} ${esc(l.name)}</option>`).join('') +
        `</optgroup>`,
    )
    .join('');
}

/** 倒數時鐘：對 endTime（伺服器絕對時間戳，legacy 慣例）每 500ms 倒推；
 *  時鐘偏差先照舊（協定升級另議），顯示負數時 clamp 為 0:00。 */
function makeCountdown(onText: (text: string) => void): {
  run(endTime: number): void;
  stop(): void;
} {
  let timer: ReturnType<typeof setInterval> | null = null;
  const stop = (): void => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  };
  const run = (endTime: number): void => {
    stop();
    const update = (): void => {
      const rem = Math.max(0, Math.ceil((endTime - Date.now()) / 1000));
      onText(`${Math.floor(rem / 60)}:${String(rem % 60).padStart(2, '0')}`);
      if (rem <= 0) stop();
    };
    update();
    timer = setInterval(update, 500);
  };
  return { run, stop };
}

export function renderDashboard(root: HTMLElement, opts: DashboardOptions): DashboardView {
  const { info, levels } = opts;
  const lanText = info && info.lanAddresses.length > 0 ? `http://${info.lanAddresses[0]}:${info.port}` : '—';
  const maxStudents = info ? String(info.maxStudents) : '—';
  // 版本字樣不對外顯示（產品不以版次稱呼；InfoResponse.version 契約欄位保留供除錯）
  const version = '';

  root.innerHTML = `
    <header class="topbar">
      <div class="topbar-inner">
        <div class="topbar-brand">
          <span class="brand-logo">CREAFLY<span class="accent">.</span></span>
          <span class="brand-sub">老師後台</span>
          ${version ? `<span class="version-tag">${version}</span>` : ''}
        </div>
        <div class="topbar-tools">
          <div class="topbar-pill">
            <span id="ws-status" class="ws-off"><span class="status-dot off"></span>未連線</span>
            <span class="pill-divider" aria-hidden="true"></span>
            <span class="pill-students">學生 <strong id="student-count" class="mono">0</strong></span>
          </div>
          <button class="btn btn-ghost btn-sm" id="logout-btn">${ICONS.logOut}登出</button>
        </div>
      </div>
    </header>

    <div class="layout">
      <section class="room-strip" aria-label="房間列表">
        <div class="room-strip-row">
          <span class="room-strip-label">房間</span>
          <div class="room-chips" id="room-chips"><span class="room-chips-empty">連線後顯示房間</span></div>
          <button class="btn btn-primary btn-sm" id="btn-room-new">${ICONS.plus}開新房間</button>
        </div>
        <p class="room-hint" id="room-hint" hidden>目前只有預設房間；開新房間可分組或多班同時上課</p>
        <form class="room-form" id="room-form" hidden>
          <div class="ctl-grid">
            <div class="field">
              <label class="field-label" for="rf-name">房間名稱</label>
              <input id="rf-name" type="text" maxlength="30" placeholder="例：三年二班（留空用房間碼）">
            </div>
            <div class="field">
              <label class="field-label" for="rf-pass">加入密碼</label>
              <input id="rf-pass" type="text" maxlength="30" autocomplete="off" placeholder="留空 = 不需密碼">
            </div>
            <div class="field">
              <label class="field-label" for="rf-max">人數上限</label>
              <input id="rf-max" type="number" min="1" max="200" placeholder="預設 ${esc(maxStudents)}">
            </div>
          </div>
          <div class="room-form-actions">
            <button type="button" class="btn btn-ghost" id="rf-cancel">取消</button>
            <button type="submit" class="btn btn-primary">${ICONS.plus}建立房間</button>
          </div>
        </form>
      </section>

      <aside class="side-col">
        <section class="card roster-card">
          <div class="card-head room-head">
            <button type="button" class="room-code mono" id="room-code" title="點擊複製房間碼" disabled>—</button>
            <div class="room-meta">
              <span class="room-name" id="room-name">學生名冊</span>
              <span class="room-sub"><strong class="roster-count mono">0</strong><span id="room-max"> / ${esc(maxStudents)} 人</span><span class="room-flags" id="room-flags"></span></span>
            </div>
            <div class="room-tools" id="room-tools" hidden>
              <button class="btn btn-ghost btn-sm" id="btn-room-lock" title="鎖房後新學生無法加入，已在房內的不受影響">${ICONS.lockOpen}鎖房</button>
              <button class="btn btn-ghost btn-sm" id="btn-room-settings" aria-haspopup="dialog">${ICONS.settings}設定</button>
              <span class="tip-wrap" id="room-close-wrap"><button class="btn btn-danger btn-sm" id="btn-room-close">${ICONS.doorClosed}關閉房間</button></span>
            </div>
            <div class="room-pop" id="room-pop" role="dialog" aria-label="房間設定" hidden>
              <div class="room-pop-title">房間設定</div>
              <div class="field">
                <label class="field-label" for="rs-name">房間名稱</label>
                <input id="rs-name" type="text" maxlength="30" placeholder="例：三年二班">
              </div>
              <div class="field">
                <label class="field-label" for="rs-pass">加入密碼</label>
                <input id="rs-pass" type="text" maxlength="30" autocomplete="off" placeholder="留空 = 不需密碼">
                <label class="check-row" id="rs-clear-wrap" hidden><input type="checkbox" id="rs-clear">移除目前密碼</label>
              </div>
              <div class="field">
                <label class="field-label" for="rs-max">人數上限</label>
                <input id="rs-max" type="number" min="1" max="200">
              </div>
              <div class="room-pop-actions">
                <button type="button" class="btn btn-ghost btn-sm" id="rs-cancel">取消</button>
                <button type="button" class="btn btn-primary btn-sm" id="rs-save">${ICONS.check}儲存</button>
              </div>
            </div>
          </div>
          <div class="card-body">
            <button type="button" class="lan-bar" id="lan-addr" title="點擊複製連線位址">
              <span class="lan-label">學生連線位址（點擊複製）</span>
              <span class="lan-row"><span class="lan-url mono" id="lan-url">${esc(lanText)}</span>${ICONS.copy}</span>
            </button>
          </div>
          <div class="roster-scroll">
            <table class="roster-table">
              <thead>
                <tr><th>#</th><th>學生</th><th>關卡</th><th class="right">成績</th><th class="row-act"></th></tr>
              </thead>
              <tbody id="student-tbody">
                <tr><td colspan="5" class="empty">尚無學生連線</td></tr>
              </tbody>
            </table>
          </div>
        </section>
      </aside>

      <main class="work-col">
        <div class="tabs">
          <button class="tab-btn active" data-tab="levels">${ICONS.map}關卡 / 廣播</button>
          <button class="tab-btn" data-tab="arena">${ICONS.trophy}大亂鬥<span class="live-dot"></span></button>
          <button class="tab-btn" data-tab="soccer">${ICONS.target}足球<span class="live-dot"></span></button>
        </div>

        <section class="tab-panel active" id="panel-levels">
          <div class="card">
            <div class="card-head"><h2 class="card-title">關卡控制</h2></div>
            <div class="card-body">
              <div class="ctl-grid ctl-grid-wide">
                <div class="field">
                  <label class="field-label" for="level-select">課程關卡</label>
                  <select id="level-select">${levelOptions(levels)}</select>
                </div>
              </div>
            </div>
            <div class="card-actions">
              <button class="btn btn-ghost" id="btn-lock-level" title="鎖定後學生無法自行切換關卡，只能由老師廣播切關（遲到連上的學生也會套用）">${ICONS.lockOpen}鎖定關卡</button>
              <button class="btn btn-ghost" id="btn-load-level">${ICONS.map}全班載入此關卡</button>
              <button class="btn btn-primary" id="btn-race-start">${ICONS.flag}開始比賽</button>
            </div>
          </div>

          <div class="card">
            <div class="card-head"><h2 class="card-title">模式切換</h2></div>
            <div class="card-body">
              <p class="note">手動＝搖桿／鍵盤直接飛；程式＝Blockly 積木編程。點擊後全班立即切換。</p>
            </div>
            <div class="card-actions">
              <button class="btn btn-ghost" id="btn-mode-manual">${ICONS.gamepad}全班切到「手動模式」</button>
              <button class="btn btn-ghost" id="btn-mode-program">${ICONS.pencil}全班切到「程式模式」</button>
            </div>
          </div>

          <div class="card">
            <div class="card-head"><h2 class="card-title">全班廣播</h2></div>
            <div class="card-body">
              <div class="field">
                <label class="field-label" for="msg-text">廣播訊息（顯示在所有學生畫面）</label>
                <input id="msg-text" type="text" placeholder="輸入訊息後按 Enter 或「送出訊息」">
              </div>
            </div>
            <div class="card-actions">
              <button class="btn btn-danger" id="btn-reset-all">${ICONS.rotateCcw}廣播重置</button>
              <button class="btn btn-ghost" id="btn-send-msg">${ICONS.send}送出訊息</button>
            </div>
          </div>
        </section>

        <section class="tab-panel" id="panel-arena">
          <div class="card">
            <div class="card-head">
              <h2 class="card-title">大亂鬥</h2>
              <div class="card-head-tools">
                <span class="game-pill arena-pill" hidden><span class="pill-dot"></span><span class="pill-label"></span><span id="arena-clock" class="pill-clock mono"></span></span>
                <button class="btn btn-danger btn-sm" id="btn-arena-stop" hidden>${ICONS.square}停止比賽</button>
              </div>
            </div>
            <div class="card-body">
              <p class="note">學生先點自己畫面的「大亂鬥」進場，老師再按「開始大亂鬥」（全場一起倒數起跑）。</p>
              <div class="field">
                <span class="field-label">模式（開賽時套用）</span>
                <div class="mode-pick">
                  <label class="mode-option">
                    <input type="radio" name="arena-mode" value="balloon" checked>
                    <span class="mode-title">搶氣球</span>
                    <span class="mode-desc">限時內收集氣球，分數最高者獲勝</span>
                  </label>
                  <label class="mode-option">
                    <input type="radio" name="arena-mode" value="tag">
                    <span class="mode-title">鬼抓人</span>
                    <span class="mode-desc">隨機變身成鬼抓跑者，時間到比抓捕數定勝負</span>
                  </label>
                </div>
              </div>
              <div class="ctl-grid">
                <div class="field">
                  <label class="field-label" for="arena-field">場地（全場一致）</label>
                  <select id="arena-field">
                    <option value="grid">格線空場</option>
                    <option value="playground">遊樂場（有掩體、不可穿）</option>
                  </select>
                </div>
                <div class="field">
                  <label class="field-label" for="ghost-count">鬼的數量（鬼抓人）</label>
                  <select id="ghost-count" disabled>
                    <option value="1">1 鬼</option>
                    <option value="2" selected>2 鬼</option>
                    <option value="3">3 鬼</option>
                    <option value="4">4 鬼</option>
                  </select>
                </div>
                <div class="field">
                  <label class="field-label" for="arena-dur">時長</label>
                  <select id="arena-dur">
                    <option value="180">3 分鐘</option>
                    <option value="300">5 分鐘</option>
                    <option value="420">7 分鐘</option>
                  </select>
                </div>
              </div>
              <p class="hint">鬼抓人：倒數後隨機變身成鬼（紅色、較大、較快），鬼撞到人＝暈眩幾秒＋傳送回出生點，復活後還有一小段無敵時間（閃爍）讓他跑走，不會出局；時間到看鬼隊總抓捕數有沒有達門檻（跑者人數×3）＝鬼隊勝，沒達到＝跑者隊勝。</p>
            </div>
            <div class="card-actions">
              <button class="btn btn-primary arena-start">${ICONS.play}開始大亂鬥</button>
            </div>
          </div>

          <div class="card table-card">
            <div class="card-head"><h2 class="card-title">即時排行</h2></div>
            <table>
              <thead><tr><th>排名</th><th>玩家</th><th class="right">狀態</th></tr></thead>
              <tbody id="arena-board"><tr><td colspan="3" class="empty">尚未開始</td></tr></tbody>
            </table>
          </div>
        </section>

        <section class="tab-panel" id="panel-soccer">
          <div class="card">
            <div class="card-head"><h2 class="card-title">隊伍名單</h2></div>
            <div class="card-body">
              <p class="note">學生先點「足球對戰（多人）」進場（自動平均分隊）→ 點「設為前鋒」指定前鋒（每隊 1 名，換隊後系統自動補位）、點「換隊」把學生調到對面。</p>
              <div class="soccer-teams">
                <div class="team-col blue"><h3>藍隊</h3><div id="soccer-blue"><div class="empty">尚無人加入</div></div></div>
                <div class="team-col red"><h3>紅隊</h3><div id="soccer-red"><div class="empty">尚無人加入</div></div></div>
              </div>
            </div>
            <div class="card-actions">
              <button class="btn btn-ghost" id="btn-soccer-new">${ICONS.users}換新一輪（重新分隊）</button>
            </div>
          </div>

          <div class="card">
            <div class="card-head">
              <h2 class="card-title">比賽控制</h2>
              <div class="card-head-tools">
                <span class="game-pill soccer-pill" hidden><span class="pill-dot"></span><span class="pill-label"></span><span class="pill-clock mono"></span></span>
                <button class="btn btn-danger btn-sm" id="btn-soccer-stop" hidden>${ICONS.square}停止比賽</button>
              </div>
            </div>
            <div class="card-body">
              <div class="field">
                <span class="field-label">玩法選擇（開賽時套用）</span>
                <div class="mode-pick" id="soccer-mode-pick">
                  <label class="mode-option">
                    <input type="radio" name="soccer-mode" value="ball" checked>
                    <span class="mode-title">推球進門（推薦）</span>
                    <span class="mode-desc">全班一起把大球推進對方門，誰都能得分</span>
                  </label>
                  <label class="mode-option">
                    <input type="radio" name="soccer-mode" value="striker">
                    <span class="mode-title">前鋒穿門（進階）</span>
                    <span class="mode-desc">FAI 真實規則，只有前鋒穿門得分</span>
                  </label>
                </div>
              </div>
              <div class="ctl-grid">
                <div class="field">
                  <label class="field-label" for="soccer-dur">局時長</label>
                  <select id="soccer-dur">
                    <option value="180">3 分鐘</option>
                    <option value="120">2 分鐘</option>
                    <option value="60">1 分鐘</option>
                    <option value="30">30 秒（測試）</option>
                  </select>
                </div>
              </div>
              <p class="hint">前鋒與「得分後須回自家半場才能再得分」規則只在「前鋒穿門」玩法生效。</p>
              <div class="soccer-score" id="soccer-score"><span class="score-side blue">藍隊</span><span class="score-num">0 : 0</span><span class="score-side red">紅隊</span><span class="score-status">等待開始</span></div>
              <div class="hint" id="soccer-armed"></div>
            </div>
            <div class="card-actions">
              <button class="btn btn-ghost" id="btn-soccer-reset">${ICONS.rotateCcw}重設賽局</button>
              <button class="btn btn-primary" id="btn-soccer-start">${ICONS.play}開始足球賽</button>
            </div>
          </div>
        </section>
      </main>
    </div>`;

  // ---- 分頁切換 ----
  const tabBtns = [...root.querySelectorAll<HTMLButtonElement>('.tab-btn')];
  const switchTab = (name: string): void => {
    for (const b of tabBtns) b.classList.toggle('active', b.dataset['tab'] === name);
    for (const p of root.querySelectorAll('.tab-panel')) {
      p.classList.toggle('active', p.id === `panel-${name}`);
    }
  };
  for (const btn of tabBtns) {
    btn.addEventListener('click', () => switchTab(btn.dataset['tab'] ?? 'levels'));
  }
  // URL ?tab=arena|soccer 可直接開指定分頁（headless 截圖驗證也靠這個）
  const urlTab = new URLSearchParams(location.search).get('tab');
  if (urlTab && tabBtns.some((b) => b.dataset['tab'] === urlTab)) switchTab(urlTab);

  /** 賽局進行中 → 分頁鈕亮紅點（照舊版 live-dot 行為） */
  const setTabLive = (tab: string, on: boolean): void => {
    const btn = tabBtns.find((b) => b.dataset['tab'] === tab);
    btn?.classList.toggle('live', on);
  };

  /** 複製到剪貼簿（clipboard API 失敗 → execCommand 後備）並 toast 結果 */
  const copyText = (text: string, okText: string): void => {
    void (async () => {
      let ok = false;
      try {
        await navigator.clipboard.writeText(text);
        ok = true;
      } catch {
        ok = legacyCopy(text);
      }
      toast(ok ? okText : '複製失敗，請手動抄寫', ok ? 'success' : 'error');
    })();
  };

  // ---- 名冊卡：連線位址列點擊複製（選定房間時附 ?room=房碼，學生開網址直接進該房） ----
  const lanBtn = root.querySelector<HTMLButtonElement>('#lan-addr')!;
  const lanUrlEl = root.querySelector<HTMLElement>('#lan-url')!;
  let lanUrl = lanText;
  lanBtn.addEventListener('click', () => {
    if (lanText === '—') {
      toast('讀不到區網位址', 'error');
      return;
    }
    copyText(lanUrl, `已複製 ${lanUrl}`);
  });

  // ---- 廣播控制（全部走 broadcast / TeacherBroadcastPayload）----
  const levelSelect = root.querySelector<HTMLSelectElement>('#level-select')!;
  const send = (payload: TeacherBroadcastPayload, okText: string): void => {
    if (!opts.send(payload)) {
      toast('尚未連線到伺服器', 'error');
      return;
    }
    toast(okText, 'success');
  };
  const on = (id: string, fn: () => void): void => {
    root.querySelector<HTMLButtonElement>(`#${id}`)!.addEventListener('click', fn);
  };

  // 賽局狀態（大亂鬥 / 足球）— 停止鈕顯示與「切關會結束比賽」提醒都看這裡
  const gameState: { arena: string; soccer: string } = { arena: 'idle', soccer: 'idle' };
  const gameInProgress = (): boolean =>
    ['countdown', 'running'].includes(gameState.arena) ||
    ['countdown', 'running'].includes(gameState.soccer);
  /** 賽局進行中時附加在 confirm 的提醒（伺服器會智能停止比賽，這裡只是提示） */
  const gameWarn = (): string =>
    gameInProgress() ? '\n注意：目前有比賽進行中，切換將自動結束比賽。' : '';

  // 關卡鎖定：點擊送出切換請求，按鈕狀態等伺服器回送（setLevelLock）才更新 —
  // 開關以伺服器為準，多裝置 / 重整後台也同步
  let levelLocked = false;
  const lockBtn = root.querySelector<HTMLButtonElement>('#btn-lock-level')!;
  const drawLockBtn = (): void => {
    lockBtn.innerHTML = levelLocked ? `${ICONS.lock}解除關卡鎖定` : `${ICONS.lockOpen}鎖定關卡`;
    lockBtn.classList.toggle('btn-warning', levelLocked);
  };
  lockBtn.addEventListener('click', () => {
    const next = !levelLocked;
    send(
      { type: 'lock_level', locked: next },
      next ? '已鎖定關卡（學生無法自行切換）' : '已解除關卡鎖定',
    );
  });

  on('logout-btn', () => opts.onLogout());
  on('btn-load-level', () => {
    const levelId = levelSelect.value;
    if (!levelId) return;
    if (gameInProgress() && !confirm(`目前有比賽進行中，切換將自動結束比賽。\n確定全班載入 ${levelId}？`)) {
      return;
    }
    send({ type: 'load_level', levelId }, `全班載入 ${levelId}`);
  });
  on('btn-reset-all', () => {
    if (!confirm(`確定要重置所有學生？${gameWarn()}`)) return;
    send({ type: 'reset_all' }, '已廣播重置');
  });
  on('btn-race-start', () => {
    const levelId = levelSelect.value;
    if (!levelId) return;
    if (!confirm(`開始比賽模式（${levelId}）？所有學生會同步載入並計時${gameWarn()}`)) return;
    send({ type: 'race_start', levelId }, `比賽開始（${levelId}）`);
  });
  on('btn-mode-program', () => send({ type: 'set_mode', mode: 'program' }, '全班已切到程式模式'));
  on('btn-mode-manual', () => send({ type: 'set_mode', mode: 'manual' }, '全班已切到手動模式'));

  const msgInput = root.querySelector<HTMLInputElement>('#msg-text')!;
  const sendMsg = (): void => {
    const text = msgInput.value.trim();
    if (!text) return;
    send({ type: 'show_message', text }, `已廣播：${text}`);
    msgInput.value = '';
  };
  on('btn-send-msg', sendMsg);
  msgInput.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') sendMsg();
  });

  /** 賽局控制訊息（未連線 → toast 提示） */
  const sendGame = (msg: TeacherToServer, okText?: string): boolean => {
    if (!opts.sendGame(msg)) {
      toast('尚未連線到伺服器', 'error');
      return false;
    }
    if (okText) toast(okText, 'success');
    return true;
  };

  // ---- 大亂鬥分頁 ----
  const arenaFieldSel = root.querySelector<HTMLSelectElement>('#arena-field')!;
  const ghostCountSel = root.querySelector<HTMLSelectElement>('#ghost-count')!;
  const arenaDurSel = root.querySelector<HTMLSelectElement>('#arena-dur')!;
  const arenaBoard = root.querySelector<HTMLElement>('#arena-board')!;
  const arenaClockEl = root.querySelector<HTMLElement>('#arena-clock')!;
  const arenaStopBtn = root.querySelector<HTMLButtonElement>('#btn-arena-stop')!;
  const arenaPill = root.querySelector<HTMLElement>('.arena-pill')!;
  const arenaPillLabel = arenaPill.querySelector<HTMLElement>('.pill-label')!;
  const arenaStartBtns = [...root.querySelectorAll<HTMLButtonElement>('.arena-start')];
  const arenaClock = makeCountdown((text) => {
    arenaClockEl.textContent = text;
  });

  /** 讀模式 radio；「鬼的數量」只在鬼抓人時啟用（disabled 不隱藏，版面不跳） */
  const pickedArenaMode = (): 'balloon' | 'tag' =>
    root.querySelector<HTMLInputElement>('input[name="arena-mode"]:checked')?.value === 'tag'
      ? 'tag'
      : 'balloon';
  for (const r of root.querySelectorAll<HTMLInputElement>('input[name="arena-mode"]')) {
    r.addEventListener('change', () => {
      ghostCountSel.disabled = pickedArenaMode() !== 'tag';
    });
  }

  /** 卡頭狀態（§5.1）：進行中 → 狀態膠囊＋停止鈕出現、開始鈕 disabled 不隱藏（版面不跳） */
  const setArenaHead = (status: string): void => {
    const live = status === 'running' || status === 'countdown';
    arenaStopBtn.hidden = !live; // 停止鈕在卡頭，只在倒數/進行中顯示
    for (const b of arenaStartBtns) b.disabled = live;
    arenaPill.hidden = !live && status !== 'ended';
    arenaPill.classList.toggle('live', live);
    arenaPillLabel.textContent =
      status === 'running' ? '進行中' : status === 'countdown' ? '即將開始' : status === 'ended' ? '已結束' : '';
  };

  // 手動停止大亂鬥（倒數中或進行中皆可）→ 伺服器結算後廣播 arena_end reason:'teacher_stop'
  arenaStopBtn.addEventListener('click', () => {
    if (!confirm('確定要停止大亂鬥？比賽將立即結束並結算名次。')) return;
    sendGame({ type: 'arena_stop' });
  });

  for (const btn of arenaStartBtns) {
    btn.addEventListener('click', () => {
      const sec = Number(arenaDurSel.value) || 180;
      const mode = pickedArenaMode();
      const ghostCount = Number.parseInt(ghostCountSel.value, 10) || 1;
      const field = arenaFieldSel.value === 'playground' ? 'playground' : 'grid';
      const ok = sendGame(
        { type: 'arena_start', durationSec: sec, mode, ghostCount, field },
        `${mode === 'tag' ? '鬼抓人' : '搶氣球'}開始（${sec / 60} 分鐘，${field === 'playground' ? '遊樂場' : '格線'}）`,
      );
      // 倒數 3-2-1 期間伺服器不會推排行 → 先在本地給即時回饋
      if (ok) {
        arenaClock.stop();
        arenaClockEl.textContent = '3-2-1…';
        setArenaHead('countdown');
      }
    });
  }

  /** 排行榜 + 倒數時鐘（balloon：名次+分數；tag：鬼/跑者狀態 — 照舊版） */
  const renderArena = (
    entries: ArenaScoreEntry[],
    status: string,
    endTime: number,
    mode: string,
  ): void => {
    gameState.arena = status;
    setTabLive('arena', status === 'running' || status === 'countdown');
    setArenaHead(status);
    const tag = mode === 'tag';
    arenaBoard.innerHTML =
      entries.length > 0
        ? entries
            .map((s, i) => {
              const state = tag
                ? s.role === 'ghost'
                  ? `<span class="state-tag tag-ghost">鬼</span> 抓 ${s.score || 0}`
                  : s.stunned
                    ? '<span class="state-tag tag-stun">暈眩中</span>'
                    : s.invincible
                      ? '<span class="state-tag tag-safe">無敵中</span>'
                      : `被抓 ${s.caughtCount || 0} 次`
                : `<b class="mono">${s.score || 0}</b>`;
              // 鬼抓人也給序號（伺服器已依表現排序）——空白欄看起來像壞掉
              return `<tr><td class="mono">${i + 1}</td><td><span class="student-cell">${avatarChip(s.emoji)}<span class="student-name">${esc(s.name || '?')}</span></span></td><td class="right">${state}</td></tr>`;
            })
            .join('')
        : '<tr><td colspan="3" class="empty">等待玩家加入…</td></tr>';
    if (status === 'running' && endTime) {
      arenaClock.run(endTime);
    } else {
      arenaClock.stop();
      arenaClockEl.textContent = status === 'countdown' ? '3-2-1…' : '';
    }
  };

  // ---- 足球分頁 ----
  const soccerDurSel = root.querySelector<HTMLSelectElement>('#soccer-dur')!;
  const soccerScoreEl = root.querySelector<HTMLElement>('#soccer-score')!;
  const soccerArmedEl = root.querySelector<HTMLElement>('#soccer-armed')!;
  const soccerStopBtn = root.querySelector<HTMLButtonElement>('#btn-soccer-stop')!;
  const soccerStartBtn = root.querySelector<HTMLButtonElement>('#btn-soccer-start')!;
  const soccerPill = root.querySelector<HTMLElement>('.soccer-pill')!;
  const soccerPillLabel = soccerPill.querySelector<HTMLElement>('.pill-label')!;
  const soccerPillClock = soccerPill.querySelector<HTMLElement>('.pill-clock')!;
  const rosterEls: Record<SoccerTeam, HTMLElement> = {
    blue: root.querySelector<HTMLElement>('#soccer-blue')!,
    red: root.querySelector<HTMLElement>('#soccer-red')!,
  };
  // 比分列的最新狀態（goal_ok 只帶比分 → 其餘沿用上一筆）；mode 缺省 'striker'（legacy 相容）
  const soccer: {
    scores: Record<SoccerTeam, number>;
    armed: Record<SoccerTeam, boolean>;
    status: string;
    endTime: number;
    mode: SoccerMode;
  } = {
    scores: { blue: 0, red: 0 },
    armed: { blue: true, red: true },
    status: 'idle',
    endTime: 0,
    mode: 'striker',
  };
  /** 比分列（藍/紅隊色標 + mono 大號數字；statusText 例 '2:30' / '等待開始'） */
  const drawScore = (statusText: string): void => {
    soccerScoreEl.innerHTML =
      `<span class="score-side blue">藍隊</span>` +
      `<span class="score-num">${soccer.scores.blue} : ${soccer.scores.red}</span>` +
      `<span class="score-side red">紅隊</span>` +
      `<span class="score-status">${esc(statusText)}</span>`;
  };
  const soccerClock = makeCountdown((text) => {
    drawScore(text);
    soccerPillClock.textContent = text; // 卡頭狀態膠囊同步 mono 倒數
  });

  /** 讀玩法選擇（radio）：'ball' 推球進門（預設）/ 'striker' FAI 前鋒穿門 */
  const pickedSoccerMode = (): SoccerMode =>
    root.querySelector<HTMLInputElement>('input[name="soccer-mode"]:checked')?.value === 'striker'
      ? 'striker'
      : 'ball';

  on('btn-soccer-start', () => {
    const dur = Number.parseInt(soccerDurSel.value, 10) || 180;
    const mode = pickedSoccerMode();
    const ok = sendGame(
      { type: 'soccer_start', durationSec: dur, mode },
      `足球賽開始（${mode === 'ball' ? '推球進門' : '前鋒穿門'}，${dur} 秒）`,
    );
    if (ok) {
      soccer.mode = mode; // 進球 toast 文案先跟著本地選擇，之後以 soccer_state 為準
      soccerStartBtn.disabled = true; // 本地即時回饋（伺服器 soccer_state 隨後校正）
    }
  });
  on('btn-soccer-stop', () => {
    if (!confirm('確定要停止足球賽？比賽將立即結束並結算比分。')) return;
    sendGame({ type: 'soccer_stop' });
  });
  on('btn-soccer-reset', () => {
    sendGame({ type: 'soccer_reset', clearTeams: false }, '已重設賽局');
  });
  on('btn-soccer-new', () => {
    if (!confirm('換新一輪？會清掉目前分隊與前鋒、重新平均分隊。')) return;
    sendGame({ type: 'soccer_reset', clearTeams: true }, '換新一輪（重新分隊）');
  });

  // 名單操作用事件代理（名字/「設為前鋒」→ soccer_set_striker；「換隊」→ soccer_set_team）
  root.querySelector<HTMLElement>('.soccer-teams')!.addEventListener('click', (ev) => {
    const el = (ev.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!el) return;
    const id = el.dataset['id'];
    if (!id) return;
    if (el.dataset['act'] === 'striker') {
      sendGame({ type: 'soccer_set_striker', studentId: id });
    } else if (el.dataset['act'] === 'team') {
      const team: SoccerTeam = el.dataset['team'] === 'red' ? 'red' : 'blue';
      sendGame({ type: 'soccer_set_team', studentId: id, team });
    }
  });

  /** 藍紅隊名單（點名字設前鋒、換隊 — 照舊版；emoji 收進 avatar chip、前鋒用 target 圖標徽章） */
  const renderSoccerRoster = (players: Pick<SoccerPlayerState, 'id' | 'name' | 'emoji' | 'team' | 'striker'>[]): void => {
    for (const team of ['blue', 'red'] as const) {
      const other: SoccerTeam = team === 'blue' ? 'red' : 'blue';
      const list = players.filter((p) => p.team === team);
      rosterEls[team].innerHTML =
        list.length > 0
          ? list
              .map(
                (p) => `<div class="soccer-player${p.striker ? ' striker' : ''}">
                  ${avatarChip(p.emoji)}
                  <span class="soccer-name" data-act="striker" data-id="${esc(p.id)}">${esc(p.name || '?')}${p.striker ? `<span class="striker-badge">${ICONS.target}前鋒</span>` : ''}</span>
                  <span class="pick" data-act="striker" data-id="${esc(p.id)}">${p.striker ? '前鋒' : '設為前鋒'}</span>
                  <span class="pick" data-act="team" data-id="${esc(p.id)}" data-team="${other}">${ICONS.swap}換到${other === 'blue' ? '藍隊' : '紅隊'}</span>
                </div>`,
              )
              .join('')
          : '<div class="empty">尚無人加入</div>';
    }
  };

  /** 比分列 + armed 狀態 + 倒數時鐘 + 卡頭狀態膠囊（狀態沿用 soccer 物件的最新值） */
  const renderSoccerScore = (): void => {
    const { armed, status, endTime } = soccer;
    gameState.soccer = status;
    const live = status === 'running' || status === 'countdown';
    setTabLive('soccer', live);
    soccerStopBtn.hidden = !live; // 停止鈕在卡頭，只在倒數/進行中顯示
    soccerStartBtn.disabled = live; // 開始鈕 disabled 不隱藏（版面不跳）
    soccerPill.hidden = !live && status !== 'done';
    soccerPill.classList.toggle('live', live);
    soccerPillLabel.textContent =
      status === 'running' ? '進行中' : status === 'countdown' ? '即將開始' : status === 'done' ? '已結束' : '';
    if (status !== 'running') soccerPillClock.textContent = status === 'countdown' ? '3-2-1…' : '';
    soccerClock.stop();
    if (status === 'running' && endTime) {
      soccerClock.run(endTime);
    } else if (status === 'done') {
      drawScore('結束');
    } else if (status === 'countdown') {
      drawScore('3-2-1…');
    } else {
      drawScore('等待開始');
    }
    // armed：得分後前鋒須過中線回自家半場才能再得分（前鋒穿門玩法賽中才顯示）
    const armedText = (ok: boolean): string =>
      ok ? '<span class="armed-ok">可得分</span>' : '<span class="armed-no">前鋒須回自家半場</span>';
    soccerArmedEl.innerHTML =
      status === 'running' && soccer.mode === 'striker'
        ? `得分狀態：藍隊 ${armedText(armed.blue)} ｜ 紅隊 ${armedText(armed.red)}`
        : '';
  };

  // ---- 房間管理：房間列（切房 / 開新房）＋ 名冊卡頭（房碼 / 鎖房 / 設定 / 關閉）＋ 名冊移出 ----
  // 狀態以伺服器 room_list 為準；roomCode 由 ws 層對賽局/廣播訊息統一補上，這裡只在 room_* 訊息帶目標房碼。
  let rooms: RoomInfo[] = [];
  let selectedRoom: string | null = null;
  const knownCodes = new Set<string>();
  let pendingCreate = false;
  const currentRoom = (): RoomInfo | null => rooms.find((r) => r.code === selectedRoom) ?? null;

  const rosterCard = root.querySelector<HTMLElement>('.roster-card')!;
  const tbody = root.querySelector<HTMLElement>('#student-tbody')!;
  const chipsEl = root.querySelector<HTMLElement>('#room-chips')!;
  const roomHintEl = root.querySelector<HTMLElement>('#room-hint')!;
  const roomForm = root.querySelector<HTMLFormElement>('#room-form')!;
  const rfName = root.querySelector<HTMLInputElement>('#rf-name')!;
  const rfPass = root.querySelector<HTMLInputElement>('#rf-pass')!;
  const rfMax = root.querySelector<HTMLInputElement>('#rf-max')!;
  const roomCodeBtn = root.querySelector<HTMLButtonElement>('#room-code')!;
  const roomNameEl = root.querySelector<HTMLElement>('#room-name')!;
  const roomMaxEl = root.querySelector<HTMLElement>('#room-max')!;
  const roomFlagsEl = root.querySelector<HTMLElement>('#room-flags')!;
  const roomTools = root.querySelector<HTMLElement>('#room-tools')!;
  const roomLockBtn = root.querySelector<HTMLButtonElement>('#btn-room-lock')!;
  const roomCloseBtn = root.querySelector<HTMLButtonElement>('#btn-room-close')!;
  const roomCloseWrap = root.querySelector<HTMLElement>('#room-close-wrap')!;
  const roomPop = root.querySelector<HTMLElement>('#room-pop')!;
  const rsName = root.querySelector<HTMLInputElement>('#rs-name')!;
  const rsPass = root.querySelector<HTMLInputElement>('#rs-pass')!;
  const rsClear = root.querySelector<HTMLInputElement>('#rs-clear')!;
  const rsClearWrap = root.querySelector<HTMLElement>('#rs-clear-wrap')!;
  const rsMax = root.querySelector<HTMLInputElement>('#rs-max')!;

  /** 房間列 chip：房名（與房碼不同時另列 mono 房碼）＋ 人數 n/max ＋ 需密碼/鎖房圖標 ＋ 賽局進行中紅點 */
  const chipHtml = (r: RoomInfo): string => {
    const named = r.name && r.name !== r.code;
    return `<button type="button" class="room-chip${r.code === selectedRoom ? ' active' : ''}" data-code="${esc(r.code)}" aria-pressed="${r.code === selectedRoom}" title="切換到「${esc(r.name || r.code)}」">
      ${roomLive(r) ? '<span class="chip-live" title="賽局進行中"></span>' : ''}
      ${named ? `<span class="chip-name">${esc(r.name)}</span>` : ''}
      <span class="chip-code">${esc(r.code)}</span>
      <span class="chip-count">${r.studentCount}/${r.maxStudents}</span>
      ${r.hasPassword ? `<span class="chip-flag" title="需密碼">${ICONS.key}</span>` : ''}
      ${r.locked ? `<span class="chip-flag flag-locked" title="已鎖房">${ICONS.lock}</span>` : ''}
    </button>`;
  };

  /** 名冊卡頭：大字房碼（點擊複製）＋ 房名 ＋ 人數上限 ＋ 旗標；工具列（鎖房 / 設定 / 關閉）只在有房間資訊時出現 */
  const drawRoomHead = (): void => {
    const r = currentRoom();
    rosterCard.classList.toggle('rooms-on', !!r);
    roomTools.hidden = !r;
    if (!r) {
      roomCodeBtn.textContent = '—';
      roomCodeBtn.disabled = true;
      roomNameEl.textContent = '學生名冊';
      roomMaxEl.textContent = ` / ${maxStudents} 人`;
      roomFlagsEl.innerHTML = '';
      return;
    }
    roomCodeBtn.textContent = r.code;
    roomCodeBtn.disabled = false;
    const isDefault = r.code === defaultRoomCode(rooms);
    roomNameEl.textContent = r.name && r.name !== r.code ? r.name : isDefault ? '預設房間' : '未命名房間';
    roomMaxEl.textContent = ` / ${r.maxStudents} 人`;
    roomFlagsEl.innerHTML =
      (r.hasPassword ? `<span title="需密碼">${ICONS.key}</span>` : '') +
      (r.locked ? `<span class="flag-locked" title="已鎖房：新學生無法加入">${ICONS.lock}</span>` : '');
    roomLockBtn.innerHTML = r.locked ? `${ICONS.lock}開放` : `${ICONS.lockOpen}鎖房`;
    roomLockBtn.classList.toggle('btn-warning', r.locked);
    roomLockBtn.title = r.locked ? '目前鎖房中（新學生無法加入）；點擊開放加入' : '鎖房後新學生無法加入，已在房內的不受影響';
    roomCloseBtn.disabled = isDefault;
    roomCloseWrap.title = isDefault ? '預設房間無法關閉' : `關閉房間 ${r.code}（房內學生會被移出）`;
  };

  /** 學生連線位址：有選定房 → 加 ?room=房碼 */
  const drawLan = (): void => {
    const r = currentRoom();
    lanUrl = lanText === '—' || !r ? lanText : `${lanText}/?room=${encodeURIComponent(r.code)}`;
    lanUrlEl.textContent = lanUrl;
  };

  const drawRooms = (): void => {
    chipsEl.innerHTML =
      rooms.length > 0
        ? rooms.map(chipHtml).join('')
        : '<span class="room-chips-empty">尚未取得房間資訊（伺服器連線後顯示）</span>';
    // 空狀態：只有預設房 → 提示可開新房分組 / 多班
    roomHintEl.hidden = !(rooms.length === 1);
    drawRoomHead();
    drawLan();
  };

  /** 切房後先把名冊 / 賽局面板清成空狀態，等伺服器補送的 student_list + arena/soccer 快照重繪 */
  const resetForRoomSwitch = (): void => {
    tbody.innerHTML = '<tr><td colspan="5" class="empty">載入名冊中…</td></tr>';
    renderArena([], 'idle', 0, 'balloon');
    soccer.scores = { blue: 0, red: 0 };
    soccer.armed = { blue: true, red: true };
    soccer.status = 'idle';
    soccer.endTime = 0;
    renderSoccerRoster([]);
    renderSoccerScore();
  };

  // 房間列：點 chip 切房（樂觀高亮；伺服器 room_list 回來為準）
  chipsEl.addEventListener('click', (ev) => {
    const chip = (ev.target as HTMLElement).closest<HTMLElement>('.room-chip');
    const code = chip?.dataset['code'];
    if (!code || code === selectedRoom) return;
    if (!sendGame({ type: 'room_select', roomCode: code })) return;
    selectedRoom = code;
    resetForRoomSwitch();
    drawRooms();
  });

  // 開新房間：內嵌表單（名稱 / 密碼 / 上限）→ room_create；伺服器回 room_list（新房已 selected）
  const showRoomForm = (show: boolean): void => {
    roomForm.hidden = !show;
    if (show) rfName.focus();
    else roomForm.reset();
  };
  on('btn-room-new', () => showRoomForm(roomForm.hidden));
  on('rf-cancel', () => showRoomForm(false));
  roomForm.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const settings: RoomSettings = {};
    const name = rfName.value.trim();
    const password = rfPass.value.trim();
    const max = Number.parseInt(rfMax.value, 10);
    if (name) settings.name = name;
    if (password) settings.password = password;
    if (Number.isFinite(max) && max > 0) settings.maxStudents = max;
    if (!sendGame({ type: 'room_create', settings })) return;
    pendingCreate = true;
    showRoomForm(false);
  });

  // 卡頭：房碼點擊複製（老師投影 / 口頭報碼）
  roomCodeBtn.addEventListener('click', () => {
    const r = currentRoom();
    if (r) copyText(r.code, `已複製房間碼 ${r.code}`);
  });

  // 鎖房 / 開放 toggle
  roomLockBtn.addEventListener('click', () => {
    const r = currentRoom();
    if (!r) return;
    const locked = !r.locked;
    sendGame(
      { type: 'room_update', roomCode: r.code, settings: { locked } },
      locked ? `已鎖房 ${r.code}：新學生無法加入` : `已開放 ${r.code} 加入`,
    );
  });

  // 關閉房間（預設房停用）：confirm 含房名與人數
  roomCloseBtn.addEventListener('click', () => {
    const r = currentRoom();
    if (!r || r.code === defaultRoomCode(rooms)) return;
    const label = r.name && r.name !== r.code ? `${r.name}（${r.code}）` : r.code;
    if (!confirm(`確定關閉房間「${label}」？\n房內 ${r.studentCount} 位學生會被移出並回到進房畫面。${gameWarn()}`)) return;
    sendGame({ type: 'room_close', roomCode: r.code }, `已關閉房間 ${r.code}`);
  });

  // 設定 popover：改名 / 密碼 / 上限 → room_update（只送有變更的欄位；密碼欄空白 = 不動，勾「移除」才清）
  const openRoomPop = (): void => {
    const r = currentRoom();
    if (!r) return;
    rsName.value = r.name && r.name !== r.code ? r.name : '';
    rsPass.value = '';
    rsPass.placeholder = r.hasPassword ? '已設定；輸入新密碼可更換' : '留空 = 不需密碼';
    rsClear.checked = false;
    rsClearWrap.hidden = !r.hasPassword;
    rsMax.value = String(r.maxStudents);
    roomPop.hidden = false;
    rsName.focus();
  };
  const closeRoomPop = (): void => {
    roomPop.hidden = true;
  };
  on('btn-room-settings', () => (roomPop.hidden ? openRoomPop() : closeRoomPop()));
  on('rs-cancel', closeRoomPop);
  on('rs-save', () => {
    const r = currentRoom();
    if (!r) return;
    const settings: RoomSettings = {};
    const name = rsName.value.trim();
    if (name && name !== r.name) settings.name = name;
    if (rsClear.checked) settings.password = '';
    else if (rsPass.value.trim()) settings.password = rsPass.value.trim();
    const max = Number.parseInt(rsMax.value, 10);
    if (Number.isFinite(max) && max > 0 && max !== r.maxStudents) settings.maxStudents = max;
    if (Object.keys(settings).length === 0) {
      toast('沒有變更', 'info');
      closeRoomPop();
      return;
    }
    if (sendGame({ type: 'room_update', roomCode: r.code, settings }, `已更新房間 ${r.code} 設定`)) closeRoomPop();
  });
  roomPop.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') closeRoomPop();
    if (ev.key === 'Enter' && (ev.target as HTMLElement).tagName === 'INPUT') {
      ev.preventDefault();
      root.querySelector<HTMLButtonElement>('#rs-save')!.click();
    }
  });
  // 點 popover 以外處收起
  document.addEventListener('mousedown', (ev) => {
    if (roomPop.hidden) return;
    const t = ev.target as Node;
    if (roomPop.contains(t) || root.querySelector('#btn-room-settings')!.contains(t)) return;
    closeRoomPop();
  });

  // 名冊每列 hover「移出」→ room_kick（confirm 含學生名）
  tbody.addEventListener('click', (ev) => {
    const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>('.row-kick');
    if (!btn) return;
    const r = currentRoom();
    const id = btn.dataset['id'];
    if (!r || !id) return;
    const name = btn.dataset['name'] || '?';
    if (!confirm(`確定將「${name}」移出房間 ${r.code}？\n該生會回到進房畫面，可重新加入（鎖房時除外）。`)) return;
    sendGame({ type: 'room_kick', roomCode: r.code, studentId: id }, `已將 ${name} 移出`);
  });

  drawRooms();

  // ---- 動態更新 ----
  const wsStatusEl = root.querySelector<HTMLElement>('#ws-status')!;
  const countEl = root.querySelector<HTMLElement>('#student-count')!;
  const rosterCountEl = root.querySelector<HTMLElement>('.roster-count')!;

  return {
    onArenaMsg(msg: TeacherArenaMsg): void {
      switch (msg.type) {
        case 'arena_state': {
          // 快照（進場 / 重連補狀態）：players 帶計分欄位 → 依分數排序當排行榜
          const entries: ArenaScoreEntry[] = [...msg.players]
            .sort((a, b) => (b.score || 0) - (a.score || 0))
            .map((p) => ({
              id: p.id,
              name: p.name,
              emoji: p.emoji,
              score: p.score || 0,
              role: p.role ?? null,
              stunned: p.stunned,
              invincible: p.invincible,
              caughtCount: p.caughtCount,
            }));
          renderArena(entries, msg.status, msg.endTime, msg.mode);
          break;
        }
        case 'arena_scores':
          renderArena(msg.scores, msg.status, msg.endTime, msg.mode);
          break;
        case 'arena_end':
          renderArena(msg.ranking, 'ended', 0, msg.mode);
          // 結束原因：老師手動停止 / 切換關卡（智能停止）→ 提示原因；時間到 → 照舊報勝負
          if (msg.reason === 'teacher_stop') {
            toast('已手動停止', 'info');
          } else if (msg.reason === 'level_switch') {
            toast('已切換關卡，比賽結束', 'info');
          } else {
            toast(
              msg.mode === 'tag'
                ? msg.winner === 'ghosts'
                  ? '鬼隊勝！'
                  : '跑者隊勝！'
                : '大亂鬥結束',
              'success',
            );
          }
          break;
      }
    },
    onSoccerMsg(msg: TeacherSoccerMsg): void {
      switch (msg.type) {
        case 'soccer_state':
          soccer.scores = msg.scores;
          soccer.armed = msg.armed;
          soccer.status = msg.status;
          soccer.endTime = msg.endTime;
          soccer.mode = msg.mode ?? 'striker'; // 缺省視為 'striker'（legacy 相容）
          renderSoccerRoster(msg.players);
          renderSoccerScore();
          break;
        case 'soccer_players':
          renderSoccerRoster(msg.players);
          break;
        case 'soccer_scores':
          soccer.scores = msg.scores;
          soccer.armed = msg.armed;
          soccer.status = msg.status;
          soccer.endTime = msg.endTime;
          renderSoccerScore();
          break;
        case 'soccer_goal_ok': {
          soccer.scores = msg.scores;
          renderSoccerScore();
          const teamName = msg.team === 'blue' ? '藍隊' : '紅隊';
          if (msg.own) {
            // 推球模式烏龍球：得分歸對隊、by = 最後觸球者
            toast(`烏龍球！${msg.byName || '?'} 把球推進自家門 → ${teamName}得分`, 'success');
          } else if (soccer.mode === 'ball') {
            toast(`${msg.byName || '?'} 推球進門！（${teamName}得分）`, 'success');
          } else {
            toast(`${msg.byName || ''} 進球！（${msg.team === 'blue' ? '藍' : '紅'}隊）`, 'success');
          }
          break;
        }
        case 'soccer_end':
          soccer.scores = msg.scores;
          soccer.status = 'done';
          renderSoccerScore();
          // 結束原因：老師手動停止 / 切換關卡（智能停止）→ 提示原因；其餘照舊報勝負
          if (msg.reason === 'teacher_stop') {
            toast('已手動停止', 'info');
          } else if (msg.reason === 'level_switch') {
            toast('已切換關卡，比賽結束', 'info');
          } else {
            toast(
              msg.winner === 'blue' ? '藍隊勝！' : msg.winner === 'red' ? '紅隊勝！' : '平手',
              'success',
            );
          }
          break;
      }
    },
    setLevelLock(locked: boolean): void {
      levelLocked = locked;
      drawLockBtn();
    },
    setRooms(list: RoomInfo[], selected: string | null): void {
      rooms = list;
      selectedRoom = selected;
      // 新房出現（自己剛建立）→ toast 報房碼；房間被關閉的收合由 room_list 自然反映
      const created = list.filter((r) => !knownCodes.has(r.code) && knownCodes.size > 0);
      knownCodes.clear();
      for (const r of list) knownCodes.add(r.code);
      if (pendingCreate && created.length > 0) {
        toast(`已開新房間 ${created.map((r) => r.code).join('、')}`, 'success');
        pendingCreate = false;
      }
      if (!roomPop.hidden && !currentRoom()) closeRoomPop(); // 正在編輯的房被關掉
      drawRooms();
    },
    setWsStatus(connected: boolean): void {
      wsStatusEl.className = connected ? 'ws-on' : 'ws-off';
      wsStatusEl.innerHTML = `<span class="status-dot ${connected ? 'on' : 'off'}"></span>${connected ? '已連線' : '未連線'}`;
    },
    setStudents(list: StudentInfo[]): void {
      // 依完成時間短到長排名（沒成績的排最後）
      const sorted = [...list].sort((a, b) => {
        if (a.time != null && b.time != null) return a.time - b.time;
        if (a.time != null) return -1;
        if (b.time != null) return 1;
        return 0;
      });
      const online = String(sorted.filter((s) => s.connected).length);
      countEl.textContent = online; // topbar 膠囊
      rosterCountEl.textContent = online; // 名冊卡頭
      if (sorted.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="empty">尚無學生連線</td></tr>';
        return;
      }
      tbody.innerHTML = sorted
        .map((s, idx) => {
          const ranked = s.time != null;
          const rankClass = ranked && idx < 3 ? `rank-${idx + 1}` : '';
          const time = s.time != null ? `${(s.time / 1000).toFixed(1)}s` : '—';
          const suspect = s.suspect
            ? `<span class="suspect-badge" title="成績與伺服器觀察時間不符">${ICONS.alertTriangle}</span>`
            : '';
          return `<tr class="${rankClass}${s.connected ? '' : ' offline'}">
            <td class="mono">${ranked ? idx + 1 : '–'}</td>
            <td><span class="student-cell" title="${s.connected ? '線上' : '離線'}">${avatarChip(s.emoji, !!s.connected)}<span class="student-name">${esc(s.name)}</span>${suspect}</span></td>
            <td>${esc(s.level ?? '—')}</td>
            <td class="right mono">${time}</td>
            <td class="row-act"><button type="button" class="row-kick" data-id="${esc(s.id)}" data-name="${esc(s.name)}" title="將 ${esc(s.name)} 移出房間">移出</button></td>
          </tr>`;
        })
        .join('');
    },
  };
}
