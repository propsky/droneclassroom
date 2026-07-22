// nipplejs 虛擬雙搖桿（觸控裝置或 ?joystick 強制開啟）— 美國手 Mode 2：
// 左桿：上下 = 升降（throttle）、左右 = 旋轉（yaw）
// 右桿：上下 = 前後（pitch）、左右 = 左右平移（roll）
// 軸向對齊 W3C 慣例：推上 = 負值。
import nipplejs from 'nipplejs';
import { isManualLocked } from '../core/droneState';

export const virtualStick = {
  throttle: 0, // -1 升 / +1 降
  yaw: 0, // +1 = 機頭向右
  pitch: 0, // -1 前進 / +1 後退
  roll: 0, // +1 = 右飛
};

export const isTouchDevice: boolean =
  'ontouchstart' in window ||
  navigator.maxTouchPoints > 0 ||
  window.matchMedia('(pointer: coarse)').matches;

export function initVirtualJoystick(): void {
  const forced = new URLSearchParams(location.search).has('joystick');
  if (isTouchDevice || forced) {
    document.body.classList.add('touch-device', 'joystick-forced');
  }

  const leftZone = document.getElementById('joystick-left');
  const rightZone = document.getElementById('joystick-right');
  if (!leftZone || !rightZone) return;

  const commonOpts = {
    mode: 'static' as const,
    position: { left: '50%', top: '50%' },
    color: 'white',
    size: 130,
    restJoystick: true,
    restOpacity: 0.5,
    dynamicPage: false,
  };

  // 左搖桿：油門（升降）+ 偏航（旋轉）
  const leftStick = nipplejs.create({ ...commonOpts, zone: leftZone });
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

  // 右搖桿：俯仰（前後）+ 滾轉（左右）
  const rightStick = nipplejs.create({ ...commonOpts, zone: rightZone });
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
}
