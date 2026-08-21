// header 溢出防護（跨裝置）：不靠寫死的視窗斷點，直接量「內容是否超出 header 右緣」，
// 超出就逐級降級 —— L1 全部按鈕收成 icon-only（body.header-compact）、
// L2 低頻按鈕依序移進「更多」下拉，一顆一顆直到塞得下為止。
// 任何動態變化（插搖桿出現「校正」、進房間出現房名標籤＋頭像、按鈕動態改字、
// 視窗 / 分割畫面改變大小）都會觸發重排，未來新增按鈕也不需要調整斷點。

const $ = (id: string): HTMLElement | null => document.getElementById(id);

/** L2 收納順序（排前面的先進「更多」；常用的留在 header 上越久越好） */
const MOVE_ORDER = [
  'connect-gamepad-btn',
  'fullscreen-btn',
  'music-btn',
  'mute-btn',
  'view-btn',
  'calib-fab',
];

interface HomeSlot {
  el: HTMLElement;
  parent: HTMLElement;
  next: Element | null;
}

export function initHeaderOverflow(): void {
  const header = $('header');
  const right = document.querySelector<HTMLElement>('.header-right');
  const left = document.querySelector<HTMLElement>('.header-left');
  const more = $('header-more');
  const moreBtn = $('header-more-btn');
  const panel = $('header-more-panel');
  if (!header || !right || !more || !moreBtn || !panel) return;

  // 記住每顆可收納按鈕的原位（還原用）
  const slots: HomeSlot[] = [];
  MOVE_ORDER.forEach((id) => {
    const el = $(id);
    if (el?.parentElement) slots.push({ el, parent: el.parentElement, next: el.nextElementSibling });
  });

  const overflowing = (): boolean => {
    const pad = parseFloat(getComputedStyle(header).paddingRight) || 0;
    // 訊號 1：header-right 右緣超出視窗（右側爆框吃字）。
    // 基準取「視窗寬」而非 header 自身右緣：#app 是 grid，內容過寬時整條 1fr 軌
    // 可能被撐大（grid item min-width:auto），header 自身永遠「裝得下」但視窗裝不下。
    const limit = Math.min(
      header.getBoundingClientRect().right,
      document.documentElement.clientWidth,
    );
    if (right.getBoundingClientRect().right > limit - pad + 1) return true;
    // 訊號 2：header-left 被 flex 壓到比內容窄（logo / 模式切換互相疊字）。
    // 房名標籤的刻意 ellipsis 不算在內（它自己 overflow:hidden，不會撐大 scrollWidth）。
    if (left && left.scrollWidth > left.clientWidth + 1) return true;
    return false;
  };

  const syncMore = (): void => {
    more.style.display = panel.childElementCount > 0 ? '' : 'none';
  };

  /** 按鈕歸位。next 參考點可能也被移走了 → 多輪解依賴，直到全部回到原位 */
  const restoreAll = (): void => {
    const remaining = [...slots];
    for (let pass = 0; pass < slots.length && remaining.length > 0; pass++) {
      for (let i = remaining.length - 1; i >= 0; i--) {
        const s = remaining[i];
        if (!s) continue;
        if (s.next && s.next.parentElement !== s.parent) continue;
        s.parent.insertBefore(s.el, s.next);
        remaining.splice(i, 1);
      }
    }
    remaining.forEach((s) => s.parent.appendChild(s.el)); // 保底（理論上不會走到）
  };

  const isVisible = (el: Element): boolean => (el as HTMLElement).offsetParent !== null;

  /** 空群組與落單的分隔線收起來（例：整組按鈕都被收進「更多」之後） */
  const cleanupSeps = (): void => {
    const kids = Array.from(right.children) as HTMLElement[];
    // 先判定各群組是否還有可見內容
    kids.forEach((k) => {
      if (!k.classList.contains('header-group')) return;
      k.style.display = Array.from(k.children).some(isVisible) ? '' : 'none';
    });
    // 分隔線：只在「前後都有可見內容」時顯示，連續多條只留一條
    let pending: HTMLElement | null = null;
    let seenContent = false;
    kids.forEach((k) => {
      if (k.classList.contains('header-sep')) {
        k.style.display = 'none';
        if (seenContent) pending = k;
        return;
      }
      if (!isVisible(k)) return;
      if (pending) {
        pending.style.display = '';
        pending = null;
      }
      seenContent = true;
    });
  };

  let scheduled = false;

  /** 冪等重排：每次都從完整狀態量起，不夠再逐級降級 */
  const relayout = (): void => {
    document.body.classList.remove('header-compact');
    restoreAll();
    syncMore();
    cleanupSeps();
    if (overflowing()) document.body.classList.add('header-compact');
    for (const s of slots) {
      if (!overflowing()) break;
      panel.appendChild(s.el);
      syncMore();
    }
    cleanupSeps();
  };

  const schedule = (): void => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      relayout();
    });
  };

  // 觸發來源 1：header 自身（= 視窗寬）與左右兩側實際寬度變化
  const ro = new ResizeObserver(schedule);
  ro.observe(header);
  ro.observe(right);
  if (left) ro.observe(left);
  window.addEventListener('resize', schedule);

  // 觸發來源 2：body class 變化（gamepad-connected 讓「校正」出現 / 消失 —— 按鈕若已被
  // 收進絕對定位的面板，寬度不變、ResizeObserver 不會響）。忽略自己掛的 header-compact，
  // 否則 relayout ↔ observer 會互相觸發成無窮迴圈。
  const bodyClassKey = (): string =>
    Array.from(document.body.classList)
      .filter((c) => c !== 'header-compact')
      .sort()
      .join(' ');
  let lastBodyKey = bodyClassKey();
  new MutationObserver(() => {
    const key = bodyClassKey();
    if (key === lastBodyKey) return;
    lastBodyKey = key;
    schedule();
  }).observe(document.body, { attributes: true, attributeFilter: ['class'] });

  // 「更多」開合 + 點外面關閉（與關卡選單同款行為）
  moreBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    more.classList.toggle('open');
  });
  document.addEventListener('click', (e) => {
    if (more.classList.contains('open') && !more.contains(e.target as Node)) {
      more.classList.remove('open');
    }
  });

  relayout();
}
