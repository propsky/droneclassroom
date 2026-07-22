// 圖標系統 — Lucide 線稿 SVG 內嵌字串（docs/design-system.md §4；零 CDN）。
// 規格：viewBox 24、顯示 16、stroke: currentColor、stroke-width 1.75。
// Lucide icons © Lucide Contributors, ISC License（https://lucide.dev）。

/** 把 Lucide path 包成 16×16 內嵌 SVG（跟文字並排用，顏色吃 currentColor） */
function svg(paths: string): string {
  return (
    '<svg class="icon" width="16" height="16" viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" ' +
    `aria-hidden="true">${paths}</svg>`
  );
}

/** 教師後台用到的圖標（§4 清單子集） */
export const ICONS = {
  /** 開始（比賽時長按鈕） */
  play: svg('<polygon points="6 3 20 12 6 21 6 3"/>'),
  /** 停止比賽 */
  square: svg('<rect width="18" height="18" x="3" y="3" rx="2"/>'),
  /** 重置 / 重設賽局 */
  rotateCcw: svg('<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>'),
  /** 比賽（race start） */
  flag: svg('<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" x2="4" y1="22" y2="15"/>'),
  /** 手動模式 */
  gamepad: svg(
    '<line x1="6" x2="10" y1="11" y2="11"/><line x1="8" x2="8" y1="9" y2="13"/>' +
    '<line x1="15" x2="15.01" y1="12" y2="12"/><line x1="18" x2="18.01" y1="10" y2="10"/>' +
    '<path d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z"/>',
  ),
  /** 程式模式（積木編寫） */
  pencil: svg('<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/>'),
  /** 登出 */
  logOut: svg(
    '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>' +
    '<polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/>',
  ),
  /** 大亂鬥（競賽） */
  trophy: svg(
    '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/>' +
    '<path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/>' +
    '<path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/>' +
    '<path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
  ),
  /** 學生名單 */
  users: svg(
    '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>' +
    '<path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  ),
  /** 前鋒（足球） */
  target: svg('<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>'),
  /** 換隊（swap） */
  swap: svg('<path d="m16 3 4 4-4 4"/><path d="M20 7H4"/><path d="m8 21-4-4 4-4"/><path d="M4 17h16"/>'),
  /** 廣播 / 連線 */
  wifi: svg(
    '<path d="M12 20h.01"/><path d="M2 8.82a15 15 0 0 1 20 0"/>' +
    '<path d="M5 12.859a10 10 0 0 1 14 0"/><path d="M8.5 16.429a5 5 0 0 1 7 0"/>',
  ),
  /** 成績可疑警示（取代舊版警告 emoji） */
  alertTriangle: svg(
    '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 20h16a2 2 0 0 0 1.73-2Z"/>' +
    '<path d="M12 9v4"/><path d="M12 17h.01"/>',
  ),
  /** 複製（連線位址列點擊複製） */
  copy: svg(
    '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/>' +
    '<path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  ),
  /** 送出（廣播訊息） */
  send: svg('<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>'),
  /** 關卡 */
  map: svg(
    '<polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"/>' +
    '<line x1="9" x2="9" y1="3" y2="18"/><line x1="15" x2="15" y1="6" y2="21"/>',
  ),
} as const;
