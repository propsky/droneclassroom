// nipplejs 虛擬雙搖桿 — 美國手 Mode 2：
// 左桿：上下 = 升降（throttle）、左右 = 旋轉（yaw）
// 右桿：上下 = 前後（pitch）、左右 = 左右平移（roll）
// 軸向對齊 W3C 慣例：推上 = 負值。
// 要不要畫出來由 TouchJoystickPreference 決定（主要指標 coarse，或使用者手動打開）。
import nipplejs from 'nipplejs';
import { isManualLocked } from '../core/droneState';
import { TouchJoystickPreference } from './touchJoystickPref';

export const virtualStick = {
  throttle: 0, // -1 升 / +1 降
  yaw: 0, // +1 = 機頭向右
  pitch: 0, // -1 前進 / +1 後退
  roll: 0, // +1 = 右飛
};

interface StickManager {
  destroy(): void;
  on(event: 'move', handler: (evt: unknown, data: { vector: { x: number; y: number } }) => void): void;
  on(event: 'end', handler: () => void): void;
}

const managers: StickManager[] = [];

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

/** 這一頁虛擬搖桿應不應該出現（含 localStorage 與 ?joystick=1）。 */
export function touchJoysticksShouldShow(): boolean {
  const urlForced = typeof location !== 'undefined' && new URLSearchParams(location.search).has('joystick');
  return TouchJoystickPreference.resolve(
    TouchJoystickPreference.readOverride(browserStore()),
    primaryPointerIsCoarse(),
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
  while (managers.length > 0) {
    const manager = managers.pop();
    try {
      manager?.destroy();
    } catch {
      /* 已經拆掉 */
    }
  }
}

function mountSticks(): void {
  destroySticks();
  const leftZone = document.getElementById('joystick-left');
  const rightZone = document.getElementById('joystick-right');
  if (!leftZone || !rightZone) return;

  // 圓盤跟區域一起縮（直式把區域收到 132，避免左右桿互壓）。橫式區域仍是 170 → 維持 130。
  const zoneWidth = Math.min(leftZone.clientWidth || 170, rightZone.clientWidth || 170);
  const nippleSize = Math.min(130, Math.max(96, Math.round(zoneWidth - 8)));
  const commonOpts = {
    mode: 'static' as const,
    position: { left: '50%', top: '50%' },
    color: 'white',
    size: nippleSize,
    restJoystick: true,
    restOpacity: 0.5,
    dynamicPage: false,
  };

  const leftStick = nipplejs.create({ ...commonOpts, zone: leftZone }) as StickManager;
  leftStick.on('move', (_evt, data) => {
    if (isManualLocked()) {
      virtualStick.throttle = 0;
      virtualStick.yaw = 0;
      return;
    }
    // nipplejs 推上是 +y；取負後：推上 = 負 = 上升
    virtualStick.throttle = -data.vector.y;
    virtualStick.yaw = data.vector.x;
  });
  leftStick.on('end', () => {
    virtualStick.throttle = 0;
    virtualStick.yaw = 0;
  });

  const rightStick = nipplejs.create({ ...commonOpts, zone: rightZone }) as StickManager;
  rightStick.on('move', (_evt, data) => {
    if (isManualLocked()) {
      virtualStick.pitch = 0;
      virtualStick.roll = 0;
      return;
    }
    virtualStick.pitch = -data.vector.y;
    virtualStick.roll = data.vector.x;
  });
  rightStick.on('end', () => {
    virtualStick.pitch = 0;
    virtualStick.roll = 0;
  });

  managers.push(leftStick, rightStick);
}

/** 依解析結果掛上或拆掉 body.touch-joysticks。隱藏時軸歸零，避免看不見的搖桿還在推飛機。 */
export function applyTouchJoystickVisibility(visible = touchJoysticksShouldShow()): void {
  document.body.classList.toggle('touch-joysticks', visible);
  zeroStick();
  if (!visible) {
    destroySticks();
    return;
  }
  mountSticks();
}

export function initVirtualJoystick(): void {
  applyTouchJoystickVisibility();
}

/** 工具列按下「觸控搖桿」：寫入選擇並立刻套用。 */
export function setTouchJoysticksVisible(visible: boolean): void {
  TouchJoystickPreference.writeOverride(browserStore(), visible);
  applyTouchJoystickVisibility(visible);
}
