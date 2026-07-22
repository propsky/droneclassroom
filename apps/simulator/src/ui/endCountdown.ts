// 賽局結束倒數 chip（設計系統 §5.3）— 大亂鬥 / 足球對戰共用。
// 與 arena / soccer HUD 共用同一時間源（server 下發的 endTime，Date.now() 比較）：
// - 剩 10 秒出現（頂部置中小 chip、--warn 色），每秒數字淡入替換
// - 剩 ≤3 秒：放大 1.4 倍 + --danger 色 + 每秒輕脈衝 + 滴聲（音效關閉時不響）
// - 0 秒淡出交棒結算 UI；提前結束（arena_end / soccer_end / 離場）立即隱藏
// - prefers-reduced-motion：只變色不縮放不脈衝（見 style.css）
import { arenaState } from '../multiplayer/arena';
import { soccerState } from '../multiplayer/soccer';
import { playTickSound } from './audio';

/** 剩幾秒開始顯示 chip */
const SHOW_AT_SEC = 10;
/** 剩幾秒進入危險態（放大 + 變紅 + 脈衝 + 滴聲） */
const DANGER_AT_SEC = 3;
/** 輪詢間隔（讀 arena / soccer 狀態，不改動其邏輯） */
const POLL_MS = 100;

let chip: HTMLElement | null = null;
let numEl: HTMLElement | null = null;
/** 目前顯示中的秒數；-1 = 隱藏 */
let shownSec = -1;

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

/** 進行中賽局的 endTime（兩模式互斥，最多一個 active）；0 = 沒有進行中的賽局 */
function activeEndTime(): number {
  if (arenaState.active && arenaState.status === 'running' && arenaState.endTime) {
    return arenaState.endTime;
  }
  if (soccerState.active && soccerState.status === 'running' && soccerState.endTime) {
    return soccerState.endTime;
  }
  return 0;
}

export function initEndCountdown(): void {
  chip = document.createElement('div');
  chip.id = 'end-countdown';
  numEl = document.createElement('span');
  numEl.className = 'ec-num';
  chip.appendChild(numEl);
  // 掛在場景浮層內 → 頂部置中對齊「場景」而非整頁（不壓 header；程式模式也對齊場景區）
  (document.getElementById('scene-overlay') ?? document.body).appendChild(chip);
  window.setInterval(tick, POLL_MS);
}

function tick(): void {
  if (!chip || !numEl) return;
  const endTime = activeEndTime();
  if (!endTime) {
    // 提前結束（老師 arena_stop / soccer_stop、離場、切關）→ 立即隱藏
    hide(true);
    return;
  }
  const rem = Math.ceil((endTime - Date.now()) / 1000);
  if (rem > SHOW_AT_SEC) {
    hide(true);
    return;
  }
  if (rem <= 0) {
    // 自然歸零：淡出交棒結算 UI（transition 處理淡出）
    hide(false);
    return;
  }
  if (rem === shownSec) return;
  shownSec = rem;
  chip.classList.add('show');
  // 每秒數字淡入替換（不彈跳；reduced-motion 時純替換）
  numEl.textContent = String(rem);
  if (!reducedMotion.matches) {
    numEl.classList.remove('ec-in');
    void numEl.offsetWidth; // 重觸發 CSS animation
    numEl.classList.add('ec-in');
  }
  if (rem <= DANGER_AT_SEC) {
    chip.classList.add('danger');
    if (!reducedMotion.matches) {
      chip.classList.remove('pulse');
      void chip.offsetWidth;
      chip.classList.add('pulse');
    }
    playTickSound(); // 每秒一滴（音效關閉時內部直接 return）
  } else {
    chip.classList.remove('danger', 'pulse');
  }
}

/** 隱藏 chip。instant = 跳過淡出（end 訊息提前來 / 離場） */
function hide(instant: boolean): void {
  if (!chip || shownSec === -1) return;
  shownSec = -1;
  if (instant) {
    chip.style.transition = 'none';
    chip.classList.remove('show', 'danger', 'pulse');
    void chip.offsetWidth; // 先以無過渡狀態生效再還原 transition
    chip.style.transition = '';
  } else {
    chip.classList.remove('show', 'danger', 'pulse');
  }
}
