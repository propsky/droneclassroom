/*
 * pyController (Route A / 標準 HID 手把) 的網頁讀取模組
 *
 * 控制器配對成系統 HID 搖桿後，網頁用「Gamepad API」讀取，不需 Web Bluetooth。
 * 軸對應 (ble_hid_sim.py)：
 *     axes[0] = 左搖桿 X    axes[1] = 左搖桿 Y
 *     axes[2] = 右搖桿 X    axes[3] = 右搖桿 Y
 *
 * ★ 重點：Gamepad API 回傳的是「每幀快照」，
 *   一定要在 requestAnimationFrame 迴圈裡「每一幀重新呼叫 navigator.getGamepads()」，
 *   不能存一份重複用，否則永遠讀到 0。
 *
 * 用法：
 *   const pad = new GamepadInput();
 *   pad.onData = (s) => { ... s.throttle, s.yaw, s.pitch, s.roll ... };
 *   pad.onStatus = (t) => { ... };
 *   pad.start();   // 開始輪詢；之後搖桿動一下、頁面有焦點就會被偵測到
 */

class GamepadInput {
  constructor() {
    this.index = null;     // 目前使用的 gamepad index
    this.deadzone = 0.05;  // 中心死區
    // Y 軸反向已在控制器韌體 (ble_hid_sim.py INVERT_LY/RY) 處理，網頁端不再反，
    // 否則會反兩次。若改回韌體不反向，再把這兩個設回 true。
    this.invertThrottle = false;
    this.invertPitch = false;
    this.onData = null;    // (state) => {}
    this.onStatus = null;  // (text) => {}
    this._running = false;
    this._loop = this._loop.bind(this);

    window.addEventListener('gamepadconnected', (e) => {
      // 多支時優先選名稱含 pyCtrl 的那支
      if (this.index === null || /pyctrl/i.test(e.gamepad.id)) {
        this.index = e.gamepad.index;
      }
      this._status('已連線：' + e.gamepad.id);
    });
    window.addEventListener('gamepaddisconnected', (e) => {
      if (e.gamepad.index === this.index) {
        this.index = null;
        this._status('已斷線');
      }
    });
  }

  _status(t) {
    if (this.onStatus) this.onStatus(t);
    console.log('[GamepadInput]', t);
  }

  _dz(v) {
    return Math.abs(v) < this.deadzone ? 0 : v;
  }

  start() {
    if (this._running) return;
    this._running = true;
    this._status('等待搖桿…請按一下手把或推一下搖桿 (頁面需在焦點)');
    requestAnimationFrame(this._loop);
  }

  stop() {
    this._running = false;
  }

  _loop() {
    if (!this._running) return;
    // ★ 每一幀都重新抓，不可快取
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];

    let gp = (this.index !== null) ? pads[this.index] : null;
    if (!gp) {
      // 還沒鎖定時，找第一支可用的
      for (const p of pads) {
        if (p) { gp = p; this.index = p.index; break; }
      }
    }

    if (gp && this.onData) this.onData(this.decode(gp));
    requestAnimationFrame(this._loop);
  }

  decode(gp) {
    const ax = gp.axes;
    const lx = this._dz(ax[0] || 0);
    const ly = this._dz(ax[1] || 0);
    const rx = this._dz(ax[2] || 0);
    const ry = this._dz(ax[3] || 0);

    // Mode 2 (美國手)：左=油門(Y)+偏航(X)，右=俯仰(Y)+翻滾(X)
    return {
      throttle: (this.invertThrottle ? -1 : 1) * ly,
      yaw: lx,
      pitch: (this.invertPitch ? -1 : 1) * ry,
      roll: rx,
      rawAxes: Array.prototype.slice.call(ax, 0, 6),  // 除錯用：看實際軸順序
      buttons: gp.buttons.map((b) => b.pressed),
      id: gp.id,
    };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { GamepadInput };
}
if (typeof window !== 'undefined') {
  window.GamepadInput = GamepadInput;
}
