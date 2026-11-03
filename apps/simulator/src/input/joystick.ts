// 畫面虛擬雙搖桿 — 美國手 Mode 2：
// 左桿：上下 = 升降（throttle）、左右 = 旋轉（yaw）
// 右桿：上下 = 前後（pitch）、左右 = 左右平移（roll）
// 軸向對齊 W3C 慣例：推上 = 負值。
// 要不要畫出來由 TouchJoystickPreference 決定（主要指標 coarse、有觸控螢幕，或使用者手動打開）。
// 相對拖曳（padGrab.ts）：按下的點就是中心，手指一碰不會瞬間打桿；搖桿頭畫的是搖桿值，不是手指位置。
import { isManualLocked } from '../core/droneState';
import { PadGrab } from './padGrab';
import { TouchJoystickPreference } from './touchJoystickPref';

export const virtualStick = {
  throttle: 0, // -1 升 / +1 降
  yaw: 0, // +1 = 機頭向右
  pitch: 0, // -1 前進 / +1 後退
  roll: 0, // +1 = 右飛
};

/** 一個圓盤：抓住它的那根手指、搖桿頭、寫入哪兩軸。 */
interface Pad {
  zone: HTMLElement;
  knob: HTMLElement;
  grab: PadGrab;
  pointer: number | null;
  travel: number;
  /** x 往右、y 往上，各 -1..1 */
  write(x: number, y: number): void;
}

let mounted: { pads: Pad[]; stop: AbortController } | null = null;

function browserStore(): Storage | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

/** 主要指標是手指。桌機滑鼠即使誤報 ontouchstart / maxTouchPoints 也是 false。 */
export function primaryPointerIsCoarse(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return TouchJoystickPreference.primaryPointerIsCoarse(window);
}

/** 給新手引導、連線提示用：這台裝置的主要指標是不是觸控。 */
export const isTouchDevice: boolean = primaryPointerIsCoarse();

/** 讓位（右下活動入口／安全區）。ui 在啟動時註冊，input 不直接依賴畫面元件。 */
let syncLayout: () => void = () => undefined;

export function registerJoystickLayout(fn: () => void): void {
  syncLayout = fn;
}

/** 這一頁虛擬搖桿應不應該出現（含 localStorage 與 ?joystick=1）。 */
export function touchJoysticksShouldShow(): boolean {
  const urlForced = typeof location !== 'undefined' && new URLSearchParams(location.search).has('joystick');
  return TouchJoystickPreference.resolve(
    TouchJoystickPreference.readOverride(browserStore()),
    TouchJoystickPreference.deviceShowsJoysticks(typeof window === 'undefined' ? null : window),
    urlForced,
  );
}

function zeroStick(): void {
  virtualStick.throttle = 0;
  virtualStick.yaw = 0;
  virtualStick.pitch = 0;
  virtualStick.roll = 0;
}

function destroySticks(): void {
  if (!mounted) return;
  mounted.stop.abort();
  for (const pad of mounted.pads) pad.knob.remove();
  mounted = null;
}

/** 搖桿值寫進兩軸並移動搖桿頭。倒數、程式執行中鎖手動：軸寫 0、頭留在中間。 */
function setPad(pad: Pad, x: number, y: number): void {
  if (isManualLocked()) x = y = 0;
  pad.write(x, y);
  pad.knob.style.transform = `translate(-50%, -50%) translate(${x * pad.travel}px, ${-y * pad.travel}px)`;
}

function releasePad(pad: Pad): void {
  pad.pointer = null;
  pad.zone.classList.remove('stick-active');
  setPad(pad, 0, 0);
}

function mountPad(zone: HTMLElement, write: Pad['write'], signal: AbortSignal): Pad {
  const knob = document.createElement('div');
  knob.className = 'stick-knob';
  zone.appendChild(knob);
  const pad: Pad = { zone, knob, grab: new PadGrab(), pointer: null, travel: PadGrab.travel(zone.clientWidth || 170), write };

  zone.addEventListener(
    'pointerdown',
    (e) => {
      if (pad.pointer !== null) return; // 同一個圓盤只認第一根手指
      e.preventDefault();
      pad.pointer = e.pointerId;
      try {
        zone.setPointerCapture(e.pointerId); // 手指滑出圓盤仍繼續推
      } catch {
        /* 合成事件沒有可捕捉的指標 */
      }
      pad.travel = PadGrab.travel(zone.clientWidth || 170);
      const vv = window.visualViewport;
      const reach = PadGrab.reachOf(vv?.width ?? window.innerWidth, vv?.height ?? window.innerHeight);
      // 兩根桿放開都彈回 0：按下的點就是中心
      pad.grab.grab(e.clientX, e.clientY, 0, 0, pad.travel, reach);
      zone.classList.add('stick-active');
      setPad(pad, 0, 0);
    },
    { signal },
  );
  zone.addEventListener(
    'pointermove',
    (e) => {
      if (e.pointerId !== pad.pointer) return;
      const [x, y] = pad.grab.read(e.clientX, e.clientY);
      setPad(pad, x, y);
    },
    { signal },
  );
  const end = (e: PointerEvent): void => {
    if (e.pointerId === pad.pointer) releasePad(pad);
  };
  zone.addEventListener('pointerup', end, { signal });
  zone.addEventListener('pointercancel', end, { signal });
  zone.addEventListener('lostpointercapture', end, { signal });
  setPad(pad, 0, 0);
  return pad;
}

function mountSticks(): void {
  destroySticks();
  const leftZone = document.getElementById('joystick-left');
  const rightZone = document.getElementById('joystick-right');
  if (!leftZone || !rightZone) return;
  const stop = new AbortController();
  const pads = [
    mountPad(
      leftZone,
      (x, y) => {
        // 推上 = 負 = 上升
        virtualStick.throttle = -y;
        virtualStick.yaw = x;
      },
      stop.signal,
    ),
    mountPad(
      rightZone,
      (x, y) => {
        virtualStick.pitch = -y;
        virtualStick.roll = x;
      },
      stop.signal,
    ),
  ];
  mounted = { pads, stop };
}

function relayoutSticks(): void {
  syncLayout();
  if (!document.body.classList.contains('touch-joysticks')) return;
  if (!mounted) mountSticks();
}

/** 依解析結果掛上或拆掉 body.touch-joysticks。隱藏時軸歸零，避免看不見的搖桿還在推飛機。 */
export function applyTouchJoystickVisibility(visible = touchJoysticksShouldShow()): void {
  document.body.classList.toggle('touch-joysticks', visible);
  zeroStick();
  syncLayout();
  if (!visible) {
    destroySticks();
    return;
  }
  mountSticks();
}

export function initVirtualJoystick(): void {
  applyTouchJoystickVisibility();
  const onResize = (): void => relayoutSticks();
  window.addEventListener('resize', onResize);
  window.visualViewport?.addEventListener('resize', onResize);
}

/** 工具列按下「觸控搖桿」：寫入選擇並立刻套用。 */
export function setTouchJoysticksVisible(visible: boolean): void {
  TouchJoystickPreference.writeOverride(browserStore(), visible);
  applyTouchJoystickVisibility(visible);
}
