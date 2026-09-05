// 首次上手新手引導（B-05）— 逐步導覽 overlay。
// 純 DOM，不碰 core；只在「第一次登入完成」時自動跑一次
// （localStorage 記已看過）。重看入口：頭像下拉「新手引導」或 ?guide=1。
// 高亮做法：一個吸在目標元素上的框，配超大 box-shadow 當半透明遮罩
// （單元素 cutout，免 canvas / 免第三方庫）。
import { bus } from '../core/events';
import { isTouchDevice } from '../input';

const LS_DONE = 'creafly_guide_done_v1';

interface Step {
  /** 目標元素 id；null = 置中卡片（無高亮） */
  target: string | null;
  title: string;
  body: string;
}

function buildSteps(): Step[] {
  const controlBody = isTouchDevice
    ? '用畫面下方的兩根虛擬搖桿：左手控制升降和轉向，右手控制前後左右。接上實體搖桿後會自動切換；也可點上方「連線搖桿」配對 BLE 手把。'
    : '鍵盤 WASD 控制前後左右，↑/↓ 升降，←/→ 轉向。接上搖桿後請按任意按鍵讓瀏覽器偵測。詳細按鍵看左邊的「操作說明」卡。';
  return [
    {
      target: null,
      title: '歡迎來到 CREAFLY！',
      body: '你有一台自己的無人機了！花 30 秒認識畫面，馬上起飛。',
    },
    {
      target: isTouchDevice ? null : 'help-hud',
      title: '怎麼操控？',
      body: controlBody,
    },
    {
      target: 'mode-mp-toggle',
      title: '兩種玩法',
      body: '「手動」直接開飛；「程式」用積木寫程式命令無人機飛（像遙控機器人）。',
    },
    {
      target: 'level-selector',
      title: '選關卡',
      body: '這裡選關卡：第 1 章新手村、第 2 章畫畫教室、第 3 章立體繪圖。跟著老師的進度玩！',
    },
    {
      target: 'pause-btn',
      title: '需要暫停？',
      body: '按這裡（或鍵盤 P）隨時暫停，計時也會停下來。',
    },
    {
      target: null,
      title: '準備好了！',
      body: '關閉這個引導後，按關卡說明上的「開始」就出發。祝飛行愉快！',
    },
  ];
}

export function initOnboarding(): void {
  const force = new URLSearchParams(location.search).get('guide') === '1';
  let playerReady = false;
  let introSeen = false;
  let started = false;

  const maybeStart = (): void => {
    if (started || !playerReady || !introSeen) return;
    if (!force && localStorage.getItem(LS_DONE)) return;
    started = true;
    // 等 intro modal 完整浮出再開始（避免和登入 toast 疊在一起）
    setTimeout(() => startTour(), 600);
  };

  bus.on('player-ready', () => {
    playerReady = true;
    maybeStart();
  });
  bus.on('level-intro', () => {
    introSeen = true;
    maybeStart();
  });

  // 重看入口：頭像下拉的「新手引導」
  document.getElementById('player-guide')?.addEventListener('click', () => {
    document.getElementById('player-hud')?.classList.remove('open');
    startTour();
  });
}

function startTour(): void {
  const steps = buildSteps().filter(
    (s) => s.target === null || document.getElementById(s.target),
  );
  if (steps.length === 0) return;

  const root = document.createElement('div');
  root.id = 'guide-root';
  root.innerHTML = `
    <div class="guide-spot"></div>
    <div class="guide-card">
      <div class="guide-progress"></div>
      <div class="guide-title"></div>
      <div class="guide-body"></div>
      <div class="guide-actions">
        <button class="guide-skip" type="button">跳過</button>
        <button class="guide-next" type="button">下一步</button>
      </div>
    </div>`;
  document.body.appendChild(root);

  const spot = root.querySelector<HTMLElement>('.guide-spot')!;
  const card = root.querySelector<HTMLElement>('.guide-card')!;
  const progressEl = root.querySelector<HTMLElement>('.guide-progress')!;
  const titleEl = root.querySelector<HTMLElement>('.guide-title')!;
  const bodyEl = root.querySelector<HTMLElement>('.guide-body')!;
  const nextBtn = root.querySelector<HTMLButtonElement>('.guide-next')!;
  const skipBtn = root.querySelector<HTMLButtonElement>('.guide-skip')!;

  let idx = 0;

  const render = (): void => {
    const step = steps[idx]!;
    progressEl.textContent = `${idx + 1} / ${steps.length}`;
    titleEl.textContent = step.title;
    bodyEl.textContent = step.body;
    nextBtn.textContent = idx === steps.length - 1 ? '完成 🚁' : '下一步';

    const el = step.target ? document.getElementById(step.target) : null;
    const visible = !!el && el.offsetParent !== null;
    if (el && visible) {
      const r = el.getBoundingClientRect();
      const pad = 6;
      spot.style.display = 'block';
      spot.style.left = `${r.left - pad}px`;
      spot.style.top = `${r.top - pad}px`;
      spot.style.width = `${r.width + pad * 2}px`;
      spot.style.height = `${r.height + pad * 2}px`;
      // 卡片放目標下方；放不下就放上方；水平 clamp 進視窗
      const cw = Math.min(340, window.innerWidth - 24);
      card.style.maxWidth = `${cw}px`;
      const below = r.bottom + 12;
      const cardH = card.offsetHeight || 160;
      const top = below + cardH > window.innerHeight - 12 ? r.top - cardH - 12 : below;
      const left = Math.max(12, Math.min(r.left, window.innerWidth - cw - 12));
      card.style.top = `${Math.max(12, top)}px`;
      card.style.left = `${left}px`;
      card.style.transform = 'none';
    } else {
      // 置中卡片（無高亮 → spot 縮成點置中，遮罩仍全覆蓋）
      spot.style.display = 'block';
      spot.style.left = '50vw';
      spot.style.top = '46vh';
      spot.style.width = '0px';
      spot.style.height = '0px';
      card.style.top = '50%';
      card.style.left = '50%';
      card.style.transform = 'translate(-50%, -50%)';
      card.style.maxWidth = `${Math.min(360, window.innerWidth - 24)}px`;
    }
  };

  const finish = (): void => {
    localStorage.setItem(LS_DONE, '1');
    root.remove();
    window.removeEventListener('resize', render);
  };

  nextBtn.addEventListener('click', () => {
    if (idx >= steps.length - 1) {
      finish();
      return;
    }
    idx++;
    render();
  });
  skipBtn.addEventListener('click', finish);
  window.addEventListener('resize', render);
  render();
}
