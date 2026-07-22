// 儀表板 — 版面資訊架構依 docs/design-system.md §5.1：
// topbar（品牌 + 連線狀態膠囊含學生數 + 登出）＋ 左欄 380px 學生名冊常駐卡 ＋ 右欄 tab 分區卡片。
// 每張卡片固定結構：卡頭（標題＋賽局狀態膠囊＋停止鈕〔進行中才出現〕）→ 控件區（label 在上）→ 動作列（右對齊，primary 最右）。
// 大亂鬥與足球對齊舊版 teacher.html 的功能：排行榜 / 隊伍名單 / 倒數時鐘 / 勝負 toast。
import type {
  ArenaScoreEntry,
  InfoResponse,
  LevelsResponse,
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
}

export interface DashboardOptions {
  info: InfoResponse | null;
  levels: LevelsResponse | null;
  /** 廣播給全班；未連線時回 false */
  send(payload: TeacherBroadcastPayload): boolean;
  /** 賽局控制訊息（大亂鬥 / 足球）；未連線時回 false */
  sendGame(msg: TeacherToServer): boolean;
  onLogout(): void;
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
      <aside class="side-col">
        <section class="card roster-card">
          <div class="card-head">
            <h2 class="card-title">學生名冊</h2>
            <span class="count-pill"><strong class="roster-count mono">0</strong><span class="count-max">/ ${esc(maxStudents)}</span></span>
          </div>
          <div class="card-body">
            <button type="button" class="lan-bar" id="lan-addr" title="點擊複製連線位址">
              <span class="lan-label">學生連線位址（點擊複製）</span>
              <span class="lan-row"><span class="lan-url mono">${esc(lanText)}</span>${ICONS.copy}</span>
            </button>
          </div>
          <table class="roster-table">
            <thead>
              <tr><th>#</th><th>學生</th><th>關卡</th><th class="right">成績</th></tr>
            </thead>
            <tbody id="student-tbody">
              <tr><td colspan="4" class="empty">尚無學生連線</td></tr>
            </tbody>
          </table>
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

  // ---- 名冊卡：連線位址列點擊複製 ----
  const lanBtn = root.querySelector<HTMLButtonElement>('#lan-addr')!;
  lanBtn.addEventListener('click', () => {
    if (lanText === '—') {
      toast('讀不到區網位址', 'error');
      return;
    }
    void (async () => {
      let ok = false;
      try {
        await navigator.clipboard.writeText(lanText);
        ok = true;
      } catch {
        ok = legacyCopy(lanText);
      }
      toast(ok ? `已複製 ${lanText}` : '複製失敗，請手動抄寫位址', ok ? 'success' : 'error');
    })();
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

  // ---- 動態更新 ----
  const wsStatusEl = root.querySelector<HTMLElement>('#ws-status')!;
  const countEl = root.querySelector<HTMLElement>('#student-count')!;
  const rosterCountEl = root.querySelector<HTMLElement>('.roster-count')!;
  const tbody = root.querySelector<HTMLElement>('#student-tbody')!;

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
        tbody.innerHTML = '<tr><td colspan="4" class="empty">尚無學生連線</td></tr>';
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
          </tr>`;
        })
        .join('');
    },
  };
}
