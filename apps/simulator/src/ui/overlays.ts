// Overlay 元件：登入 modal（名字 + emoji）、關卡 intro、3-2-1 倒數、關卡選單、
// header 按鈕列（模式切換 / 回家 / 視角 / 全螢幕 / 改名）與 Blockly 工具列按鈕。
import { bus, toast } from '../core/events';
import { flags } from '../core/droneState';
import { levelState, loadLevel, armLevelStart, resetMission } from '../core/level';
import { setMode, runProgram, stopProgram, programState } from '../core/program';
import { togglePause, resumeGame } from '../core/pause';
import { goHome } from '../core/physics';
import { iconHtml, mountIcons } from './icons';

const $ = (id: string): HTMLElement | null => document.getElementById(id);

// =============================================================================
// 玩家（登入 / 顯示名稱）
// =============================================================================
export const player = { name: '', emoji: '' };

const LS_PLAYER = 'creafly_player';

function loadPlayer(): boolean {
  try {
    const saved = localStorage.getItem(LS_PLAYER);
    if (saved) {
      const p = JSON.parse(saved) as { name?: string; emoji?: string };
      if (p.name && p.emoji) {
        player.name = p.name;
        player.emoji = p.emoji;
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
  } catch {
    /* ignore */
  }
}

function showLoginModal(): void {
  const modal = $('login-modal');
  if (!modal) return;
  const nameInput = $('login-name') as HTMLInputElement | null;
  if (nameInput && player.name) nameInput.value = player.name;
  document.querySelectorAll('.emoji-btn').forEach((b) => {
    b.classList.toggle('selected', b.getAttribute('data-emoji') === player.emoji);
  });
  modal.classList.add('show');
}

function hideLoginModal(): void {
  $('login-modal')?.classList.remove('show');
  const hud = $('player-hud');
  const display = $('player-name-display');
  if (hud && display) {
    display.textContent = `${player.name}${player.emoji}`;
    hud.style.display = 'flex';
  }
  const av = $('player-avatar-emoji');
  if (av) av.textContent = player.emoji || '🙂';
}

export function initPlayer(onReady: () => void): void {
  document.querySelectorAll('.emoji-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.emoji-btn').forEach((b) => b.classList.remove('selected'));
      btn.classList.add('selected');
      player.emoji = btn.getAttribute('data-emoji') ?? '';
    });
  });
  $('login-start')?.addEventListener('click', () => {
    const name = ((($('login-name') as HTMLInputElement | null)?.value) ?? '').trim();
    if (!name) {
      toast('請輸入名字', 'error');
      return;
    }
    if (!player.emoji) {
      toast('請選一個動物', 'error');
      return;
    }
    player.name = name;
    savePlayer();
    hideLoginModal();
    toast(`✓ 歡迎 ${player.name}${player.emoji}！`, 'success');
    bus.emit('player-ready', {});
    setTimeout(onReady, 200);
  });

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

  // 開發後門：?autologin=1 直接以測試身分登入（headless 截圖 / demo 用；
  // 可用 &name= / &emoji= 指定身分 → 多開視窗驗多人時避免同名擠下線）
  const qs = new URLSearchParams(location.search);
  if (qs.get('autologin') === '1' && !loadPlayer()) {
    player.name = qs.get('name') || '測試';
    player.emoji = qs.get('emoji') || '🐬';
    savePlayer();
  }

  if (loadPlayer()) {
    hideLoginModal();
    bus.emit('player-ready', {});
    setTimeout(onReady, 200); // 已登入（重新整理）也要自動連線
  } else {
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
