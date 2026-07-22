/*
 * pyController <-> droneclassroom Web Bluetooth 橋接 (Route B)
 *
 * 控制器 (ESP32 / MicroPython, ble_sim_peripheral.py) 廣播 Nordic UART Service，
 * 每 50ms 用 TX 特徵 notify 一個 7-byte frame。本模組負責：
 *   1. 用 navigator.bluetooth 連線 (namePrefix 'pyController')
 *   2. 訂閱 notify、解碼 7-byte frame
 *   3. 依 Mode 2 (美國手) 映射成 throttle / yaw / pitch / roll (-1..1) 與按鈕
 *
 * 用法：
 *   const ctrl = new DroneController();
 *   ctrl.onData = (s) => { ... s.throttle, s.yaw, s.pitch, s.roll, s.buttons ... };
 *   ctrl.onStatus = (txt) => { ... };
 *   document.querySelector('#connect').onclick = () => ctrl.connect();
 *
 * 注意：Web Bluetooth 僅支援 Chrome/Edge (Windows/Android/ChromeOS)。
 *       iPad/iPhone 的 Safari 不支援，需改用免費的 "Bluefy" 瀏覽器 App。
 */

const NUS_SERVICE = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const NUS_TX      = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'; // 裝置 -> 網頁 (notify)
const NUS_RX      = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'; // 網頁 -> 裝置 (預留)

// 把 0..255 (中點 127) 正規化到 -1..1
const norm = (v) => Math.max(-1, Math.min(1, (v - 127) / 127));

class DroneController {
  constructor() {
    this.device = null;
    this.server = null;
    this.txChar = null;
    this.rxChar = null;
    // 油門/俯仰 Y 軸方向。實機測試後：兩個前後都相反，故改為不反向。
    // 若日後又相反，把對應的設回 true 即可。
    this.invertThrottle = false;
    this.invertPitch = false;
    this.onData = null;    // (state) => {}
    this.onStatus = null;  // (text) => {}
    this._onNotify = this._onNotify.bind(this);
  }

  _status(t) {
    if (this.onStatus) this.onStatus(t);
    console.log('[DroneController]', t);
  }

  get isSupported() {
    return typeof navigator !== 'undefined' && !!navigator.bluetooth;
  }

  async connect() {
    if (!this.isSupported) {
      this._status('此瀏覽器不支援 Web Bluetooth。iPad 請改用 Bluefy 瀏覽器。');
      return;
    }
    try {
      this._status('搜尋裝置中…（在視窗中選擇與手把螢幕相同的那台 pyCtrl-XX）');
      // 用「服務 UUID」過濾：iOS/Bluefy 上比 namePrefix 可靠得多（namePrefix 在 iOS 常掃不到，清單會空白）
      this.device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [NUS_SERVICE] }],
        optionalServices: [NUS_SERVICE],
      });
      this.device.addEventListener('gattserverdisconnected', () => {
        this._status('已斷線');
      });

      this._status('連線中… ' + this.device.name);
      this.server = await this.device.gatt.connect();
      const svc = await this.server.getPrimaryService(NUS_SERVICE);
      this.txChar = await svc.getCharacteristic(NUS_TX);
      try {
        this.rxChar = await svc.getCharacteristic(NUS_RX);
      } catch (_) { /* RX 為預留，沒有也無妨 */ }

      await this.txChar.startNotifications();
      this.txChar.addEventListener('characteristicvaluechanged', this._onNotify);
      this._status('已連線：' + this.device.name);
    } catch (err) {
      this._status('連線失敗：' + err.message);
    }
  }

  disconnect() {
    if (this.device && this.device.gatt.connected) {
      this.device.gatt.disconnect();
    }
  }

  _onNotify(event) {
    const dv = event.target.value; // DataView
    if (dv.byteLength < 7) return;
    this.onData && this.onData(this.decode(dv));
  }

  /* 7-byte frame -> 控制狀態 (Mode 2 美國手) */
  decode(dv) {
    const lx = dv.getUint8(1); // 左搖桿 X
    const ly = dv.getUint8(2); // 左搖桿 Y
    const rx = dv.getUint8(3); // 右搖桿 X
    const ry = dv.getUint8(4); // 右搖桿 Y
    const bFace = dv.getUint8(5); // D-pad + 面板鍵
    const bSys  = dv.getUint8(6); // 系統 / 搖桿按下鍵

    // Mode 2：左=油門(Y)+偏航(X)，右=俯仰(Y)+翻滾(X)
    const throttle = (this.invertThrottle ? -1 : 1) * norm(ly);
    const yaw      = norm(lx);
    const pitch    = (this.invertPitch ? -1 : 1) * norm(ry);
    const roll     = norm(rx);

    const dpad = bFace & 0x0f; // 0=上 4=下 6=左 2=右 8=無
    return {
      throttle, yaw, pitch, roll,
      raw: { lx, ly, rx, ry },
      dpad: { up: dpad === 0, down: dpad === 4, left: dpad === 6, right: dpad === 2 },
      buttons: {
        Y: !!(bFace & (1 << 4)),
        B: !!(bFace & (1 << 5)),
        A: !!(bFace & (1 << 6)),
        X: !!(bFace & (1 << 7)),
        Back:   !!(bSys & (1 << 4)),
        Start:  !!(bSys & (1 << 5)),
        RStick: !!(bSys & (1 << 6)),
        LStick: !!(bSys & (1 << 7)),
      },
    };
  }
}

// 同時支援 ES module 與一般 <script> 引入
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { DroneController };
}
if (typeof window !== 'undefined') {
  window.DroneController = DroneController;
}
