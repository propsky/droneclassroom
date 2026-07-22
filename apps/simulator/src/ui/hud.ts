// HUD：狀態列（高度/速度/機頭/狀態/模式）、任務進度、passZone 進度條、
// 氣球計數、returnHome 步驟、機頭方向引導、toast、關卡計時。
// 60fps 更新的數字用直接 textContent 寫入（updateFrame 由主迴圈每幀呼叫）。
import { headingLabel, normalizeDeg, RAD2DEG } from '@creafly/shared';
import { bus } from '../core/events';
import { droneState, lenVec3, TICK_HZ } from '../core/droneState';
import { levelState, levelElapsedMs, getFaceGuidance } from '../core/level';
import { inkSetColor } from '../core/pen';

const $ = (id: string): HTMLElement | null => document.getElementById(id);

/** 操作說明卡收合狀態（§5.2：預設展開，收合記 localStorage） */
const LS_HELP_COLLAPSED = 'creafly_help_collapsed';

let toastTimeout: number | null = null;

export function showToast(msg: string, kind = ''): void {
  const el = $('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = `show ${kind}`;
  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = window.setTimeout(() => {
    el.className = '';
  }, 2500);
}

/** 操作說明卡：卡頭點擊收合（收成一行「操作說明」+ chevron），狀態記 localStorage */
function initHelpCollapse(): void {
  const hud = $('help-hud');
  const toggle = $('help-hud-toggle');
  if (!hud || !toggle) return;
  const apply = (collapsed: boolean): void => {
    hud.classList.toggle('collapsed', collapsed);
    toggle.setAttribute('aria-expanded', String(!collapsed));
  };
  apply(localStorage.getItem(LS_HELP_COLLAPSED) === '1');
  toggle.addEventListener('click', () => {
    const collapsed = !hud.classList.contains('collapsed');
    localStorage.setItem(LS_HELP_COLLAPSED, collapsed ? '1' : '0');
    apply(collapsed);
  });
}

export function initHud(): void {
  initHelpCollapse();
  bus.on('toast', ({ text, kind }) => showToast(text, kind));
  bus.on('state-hud', ({ text }) => {
    const el = $('hud-state');
    if (el) el.textContent = text;
  });

  bus.on('mode-changed', ({ mode }) => {
    const el = $('hud-mode');
    if (el) el.textContent = mode === 'manual' ? '手動' : '程式';
  });

  bus.on('level-loaded', ({ level }) => {
    // 任務圈 HUD
    const missionHud = $('mission-hud');
    if (missionHud) missionHud.style.display = level.rings?.length ? 'block' : 'none';
    buildRingDots(level.rings?.length ?? 0);
    updateRingCount(0, level.rings?.length ?? 0);
    // passZone 進度條
    const bar = $('progress-bar');
    if (bar) bar.style.display = level.passZones?.length ? 'block' : 'none';
    if (level.passZones?.length) initProgressBar(level.passZones.map((z) => z.label));
    // 氣球 HUD
    const balloonHud = $('balloon-hud');
    if (balloonHud) balloonHud.style.display = level.balloons?.length ? 'block' : 'none';
    const bc = $('balloon-count');
    if (bc) bc.textContent = `0/${level.balloons?.length ?? 0}`;
    // returnHome 步驟
    const rh = $('returnhome-step');
    if (rh) {
      if (level.returnHome) setReturnHomeStep('pending');
      else rh.style.display = 'none';
    }
    // 計時顯示（freeplay 不計時）
    const lt = $('level-timer');
    if (lt) lt.textContent = level.freeplay ? '自由活動' : '0.0s';
    // 畫畫教室：俯視 + 程式驅動，鍵盤操作說明 HUD 反而擋住畫面 → 該關隱藏
    const help = $('help-hud');
    if (help) help.style.display = level.draw ? 'none' : '';
    // 筆色選擇列：關卡 JSON 有 penColors 才顯示（手動飛行也能換色畫）
    buildPenBar(level.penColors);
  });

  // 筆色改變（積木換色 / 隨機換色 / 點選色塊）→ 同步高亮目前筆色
  bus.on('pen-color-changed', ({ color }) => {
    document.querySelectorAll<HTMLButtonElement>('.pen-swatch').forEach((b) => {
      b.classList.toggle('active', b.dataset['color'] === color);
    });
  });

  // 關卡清除（進大亂鬥）：關卡相關 HUD 全部收起
  bus.on('level-cleared', () => {
    ['mission-hud', 'progress-bar', 'balloon-hud', 'returnhome-step', 'heading-hud', 'pen-bar'].forEach(
      (id) => {
        const e = $(id);
        if (e) e.style.display = 'none';
      },
    );
  });

  bus.on('ring-passed', ({ collected, total }) => updateRingCount(collected, total));
  bus.on('rings-reset', () => {
    updateRingCount(0, levelState.rings.length);
    if (levelState.current?.returnHome) setReturnHomeStep('pending');
  });
  bus.on('zone-passed', () => updateZoneProgress());
  bus.on('balloon-popped', ({ collected, total }) => {
    const bc = $('balloon-count');
    if (bc) bc.textContent = `${collected}/${total}`;
  });
  bus.on('return-home', ({ phase }) => setReturnHomeStep(phase));

  bus.on('program-running', ({ running }) => {
    document.body.classList.toggle('program-running', running);
    const run = $('btn-run') as HTMLButtonElement | null;
    const stop = $('btn-stop') as HTMLButtonElement | null;
    if (run) run.disabled = running;
    if (stop) stop.disabled = !running;
  });
}

/** 筆色選擇列（畫畫教室）：由關卡 JSON 的 penColors 驅動，點色塊直接換筆色 */
function buildPenBar(penColors: string[] | undefined): void {
  const bar = $('pen-bar');
  const holder = $('pen-swatches');
  if (!bar || !holder) return;
  holder.innerHTML = '';
  if (!penColors?.length) {
    bar.style.display = 'none';
    return;
  }
  penColors.forEach((color) => {
    const btn = document.createElement('button');
    btn.className = 'pen-swatch';
    btn.dataset['color'] = color.toLowerCase();
    btn.style.background = color;
    btn.title = `換筆色 ${color}`;
    btn.addEventListener('click', () => inkSetColor(color));
    holder.appendChild(btn);
  });
  bar.style.display = 'block';
}

function buildRingDots(total: number): void {
  const holder = $('ring-dots');
  if (!holder) return;
  holder.innerHTML = '';
  for (let i = 0; i < total; i++) {
    const dot = document.createElement('div');
    dot.className = 'ring-dot' + (i === 0 ? ' current' : '');
    dot.id = `dot-${i}`;
    holder.appendChild(dot);
  }
  const totalEl = $('rings-total');
  if (totalEl) totalEl.textContent = String(total);
}

function updateRingCount(collected: number, total: number): void {
  const el = $('rings-passed');
  if (el) el.textContent = String(collected);
  for (let i = 0; i < total; i++) {
    const dot = $(`dot-${i}`);
    if (!dot) continue;
    dot.className = 'ring-dot';
    if (i < collected) dot.classList.add('done');
    else if (i === collected) dot.classList.add('current');
  }
}

function initProgressBar(labels: string[]): void {
  const steps = $('progress-steps');
  const text = $('progress-text');
  if (steps) {
    steps.innerHTML = '';
    labels.forEach((label, i) => {
      const step = document.createElement('div');
      step.className = 'step' + (i === 0 ? ' active' : '');
      step.textContent = `${i + 1}. ${label || `步驟 ${i + 1}`}`;
      steps.appendChild(step);
    });
  }
  if (text) text.textContent = `0/${labels.length}`;
}

function updateZoneProgress(): void {
  const s = levelState;
  const total = s.zoneProgress.length;
  const done = s.zoneProgress.filter(Boolean).length;
  const text = $('progress-text');
  if (text) text.textContent = `${done}/${total}`;
  const activeIdx = s.zoneProgress.findIndex((p) => !p);
  const steps = $('progress-steps');
  steps?.querySelectorAll('.step').forEach((step, i) => {
    step.classList.toggle('completed', !!s.zoneProgress[i]);
    step.classList.toggle('active', i === activeIdx);
  });
}

function setReturnHomeStep(phase: 'pending' | 'return' | 'land' | 'done'): void {
  const el = $('returnhome-step');
  if (!el) return;
  const map = {
    pending: { t: '最後：飛回起飛墊並降落', cls: '' },
    return: { t: '飛回起飛墊（原點）', cls: 'active' },
    land: { t: '降落在起飛墊上', cls: 'active' },
    done: { t: '✓ 已降落，完成！', cls: 'done' },
  } as const;
  const m = map[phase];
  el.textContent = m.t;
  el.className = `rh-step ${m.cls}`;
  el.style.display = 'block';
}

// ---- 每幀更新（直接 textContent，避免任何框架開銷）----
const cache = { alt: '', spd: '', head: '', timer: '' };

export function updateHudFrame(): void {
  const altEl = $('hud-alt');
  const spdEl = $('hud-spd');
  const headEl = $('hud-heading');
  const timerEl = $('level-timer');

  const alt = droneState.position.y.toFixed(1);
  if (altEl && alt !== cache.alt) {
    altEl.textContent = alt;
    cache.alt = alt;
  }
  // velocity 是每 tick 位移 → m/s = |v| * 60
  const spd = (lenVec3(droneState.velocity) * TICK_HZ).toFixed(1);
  if (spdEl && spd !== cache.spd) {
    spdEl.textContent = spd;
    cache.spd = spd;
  }
  const head = headingLabel(normalizeDeg(droneState.yaw * RAD2DEG));
  if (headEl && head !== cache.head) {
    headEl.textContent = head;
    cache.head = head;
  }
  if (timerEl && levelState.current && !levelState.current.freeplay) {
    const t = `${(levelElapsedMs() / 1000).toFixed(1)}s`;
    if (t !== cache.timer) {
      timerEl.textContent = t;
      cache.timer = t;
    }
  }

  updateHeadingGuide();
}

// 旋轉鑽圈（faceYaw）機頭方向 HUD
let lastGuideHtml = '';

function updateHeadingGuide(): void {
  const hud = $('heading-hud');
  if (!hud) return;
  const g = getFaceGuidance();
  if (!g) {
    if (hud.style.display !== 'none') hud.style.display = 'none';
    lastGuideHtml = '';
    return;
  }
  hud.style.display = 'block';
  const html = g.aligned
    ? `機頭：${headingLabel(g.yawDeg)}　<b class="ok">對準圈 ${g.ringIndex + 1} 了！往前飛穿過</b>`
    : `機頭：${headingLabel(g.yawDeg)}　目標：${headingLabel(g.targetDeg)}　<b class="warn">${g.signed > 0 ? '往左轉 ←' : '往右轉 →'}</b>`;
  if (html !== lastGuideHtml) {
    hud.innerHTML = html;
    lastGuideHtml = html;
  }
}
