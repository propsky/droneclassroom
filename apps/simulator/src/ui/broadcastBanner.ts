// 老師廣播橫幅 — 場景頂部置中的大字訊息（獨立於 #toast）。
// 為什麼不用 toast：toast 是單一 DOM＋單一 timeout，任何系統訊息（如「已恢復連線」）
// 都會把老師廣播蓋掉；且 13px 在教室投影 / 平板距離下太小。
// 字級歸類為「遊戲事件回饋」（design-system §5，與倒數 / 結束倒數同類），可突破五級字級。
import { bus } from '../core/events';

/** 停留時間：基礎 4s + 每字 150ms，上限 12s（長訊息給足閱讀時間） */
const BASE_MS = 4000;
const PER_CHAR_MS = 150;
const MAX_MS = 12000;

let banner: HTMLDivElement | null = null;
let hideTimer: number | null = null;

export function initBroadcastBanner(): void {
  banner = document.createElement('div');
  banner.id = 'broadcast-banner';
  // 掛在場景浮層內：只蓋 3D 畫面、不壓 header（比照 ui/endCountdown.ts）
  (document.getElementById('scene-overlay') ?? document.body).appendChild(banner);

  bus.on('broadcast-message', ({ text }) => show(text));
}

function show(text: string): void {
  if (!banner || !text) return;
  banner.textContent = `📢 ${text}`;
  // 重觸發進場動畫（連續兩則廣播時第二則也要有動效）
  banner.classList.remove('show');
  void banner.offsetWidth;
  banner.classList.add('show');
  if (hideTimer != null) clearTimeout(hideTimer);
  const duration = Math.min(MAX_MS, BASE_MS + text.length * PER_CHAR_MS);
  hideTimer = window.setTimeout(() => {
    hideTimer = null;
    banner?.classList.remove('show');
  }, duration);
}
