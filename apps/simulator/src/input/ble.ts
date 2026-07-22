// pyController 藍牙搖桿（Web Bluetooth 橋接）— 行為對齊 legacy §6b。
// 事件驅動 ~20Hz（裝置每 50ms notify 一筆）覆寫虛擬搖桿四軸；斷線自動歸零恢復。
// 僅 Chrome/Edge（Windows/Android/ChromeOS/macOS）支援；iPad 請改用 Bluefy 瀏覽器。
// 不支援 Web Bluetooth 的瀏覽器：header 按鈕直接隱藏。
import { toast } from '../core/events';
import { iconHtml } from '../ui/icons';
import { decodeFrame, NUS_SERVICE, NUS_TX, NUS_RX, type BleControllerState } from './bleDecode';

// ---- Web Bluetooth 最小型別（tsconfig DOM lib 不含；只宣告用到的部分）----
interface BleCharacteristic extends EventTarget {
  value?: DataView;
  startNotifications(): Promise<unknown>;
}
interface BleGattServer {
  connected: boolean;
  connect(): Promise<BleGattServer>;
  disconnect(): void;
  getPrimaryService(uuid: string): Promise<{
    getCharacteristic(uuid: string): Promise<BleCharacteristic>;
  }>;
}
interface BleDevice extends EventTarget {
  name?: string;
  gatt?: BleGattServer;
  /** Chrome 85+：監聽裝置廣播（自動重連用；舊瀏覽器沒有 → 功能自動降級） */
  watchAdvertisements?(options?: { signal?: AbortSignal }): Promise<void>;
}
interface BluetoothApi {
  requestDevice(options: {
    filters: { services: string[] }[];
    optionalServices: string[];
  }): Promise<BleDevice>;
  /** Chrome 85+：曾授權過的裝置清單（persistent permissions；自動重連用） */
  getDevices?(): Promise<BleDevice[]>;
}

const bluetooth = (navigator as Navigator & { bluetooth?: BluetoothApi }).bluetooth;

export function isBleSupported(): boolean {
  return !!bluetooth;
}

// ---- 狀態：最新一筆搖桿資料（事件驅動更新；input/index.ts 每 tick 讀取）----
export const bleState = {
  connected: false,
  pad: null as BleControllerState | null,
};

const BLE_DEADZONE = 0.08; // 死區，避免搖桿中點飄移

const dz = (v: number): number => (Math.abs(v) < BLE_DEADZONE ? 0 : v);

/**
 * BLE 搖桿的語意軸讀值（虛擬搖桿慣例：推上 = 負 = 上升 / 前進）。
 * 連線中覆寫虛擬搖桿四軸；未連線回傳 null（疊加路徑改用 nipplejs）。
 */
export function bleAxes(): { throttle: number; yaw: number; pitch: number; roll: number } | null {
  if (!bleState.connected || !bleState.pad) return null;
  return {
    throttle: dz(-bleState.pad.throttle), // 搖桿往上(+1) → 上升（負）
    yaw: dz(bleState.pad.yaw),
    pitch: dz(-bleState.pad.pitch), // 搖桿往上(+1) → 前進（負）
    roll: dz(bleState.pad.roll),
  };
}

// ---- 連線管理 ----
let device: BleDevice | null = null;
let connecting = false;
/** 使用者主動按斷線（→ 不自動重連）；意外斷線才走重連路徑 */
let userDisconnected = false;
/** watchAdvertisements 的取消控制（連上或使用者斷線時停止掃描省電） */
let watchAbort: AbortController | null = null;

function setBleButton(text: string, connected: boolean): void {
  const btn = document.getElementById('connect-gamepad-btn');
  if (!btn) return;
  btn.innerHTML = `${iconHtml('bluetooth')}<span>${text}</span>`;
  btn.classList.toggle('active', connected);
  btn.title = connected
    ? '已連線 — 點擊可斷線'
    : '用藍牙連線 pyController 實體搖桿（需 HTTPS；iPad 請用 Bluefy）';
}

/** 斷線 / 連線失敗 → 重置狀態 + 歸零搖桿輸入（對齊 legacy onStatus 的斷線分支） */
function resetToDisconnected(): void {
  bleState.connected = false;
  bleState.pad = null;
  setBleButton('連線搖桿', false);
}

/**
 * 例外 → 給使用者看的中文訊息。
 * 「使用者按取消」（NotFoundError）不是錯誤 —— 回 null 表示安靜處理；
 * 原始例外一律進 console 供除錯，不直接丟英文給學生看。
 */
function humanBleError(err: unknown): { text: string; kind: 'error' | 'warning' } | null {
  console.warn('[BLE] 連線例外：', err);
  const name = err instanceof DOMException || err instanceof Error ? err.name : '';
  switch (name) {
    case 'NotFoundError': // 使用者關掉選擇視窗（或清單為空按了取消）
      return null;
    case 'SecurityError':
      return { text: '藍牙連線需要 HTTPS（或 localhost）才能使用', kind: 'error' };
    case 'NetworkError':
      return { text: '連不上手把 — 請確認 pyController 已開機且在附近，再試一次', kind: 'warning' };
    case 'InvalidStateError':
      return { text: '藍牙忙碌中，請稍等一下再試', kind: 'warning' };
    default:
      return { text: '連線失敗 — 請確認手把已開機，關掉再開一次後重試', kind: 'error' };
  }
}

/** 訂閱 notify（requestDevice 與自動重連共用） */
async function attachAndListen(dev: BleDevice): Promise<void> {
  const server = await dev.gatt!.connect();
  const svc = await server.getPrimaryService(NUS_SERVICE);
  const txChar = await svc.getCharacteristic(NUS_TX);
  try {
    await svc.getCharacteristic(NUS_RX); // RX 為預留，沒有也無妨
  } catch {
    /* ignore */
  }
  await txChar.startNotifications();
  txChar.addEventListener('characteristicvaluechanged', (event: Event) => {
    const value = (event.target as BleCharacteristic).value;
    if (!value) return;
    const pad = decodeFrame(value);
    if (pad) {
      bleState.pad = pad;
      bleState.connected = true;
    }
  });
  bleState.connected = true;
  setBleButton('已連線', true);
}

/** 意外斷線：先就地重試 GATT（3 次退避），失敗改監聽廣播等它回來 */
async function onUnexpectedDisconnect(): Promise<void> {
  resetToDisconnected();
  if (userDisconnected || !device) {
    userDisconnected = false;
    toast('搖桿已斷線', '');
    return;
  }
  toast('搖桿斷線，自動重連中…', 'warning');
  for (const delayMs of [1000, 2000, 4000]) {
    await new Promise((r) => setTimeout(r, delayMs));
    try {
      await attachAndListen(device);
      toast(`已重新連上 ${device.name ?? 'pyController'}`, 'success');
      return;
    } catch {
      /* 下一輪 */
    }
  }
  // GATT 直連救不回（手把可能被關機）→ 轉為監聽廣播，開機就自動接回
  watchForDevice(device);
  toast('先關掉手把再開機，會自動重新連線', 'warning');
}

/** 監聽已授權裝置的廣播 → 一收到就直連（Chrome 85+；不支援就靜默略過） */
function watchForDevice(dev: BleDevice): void {
  if (!dev.watchAdvertisements) return;
  watchAbort?.abort();
  watchAbort = new AbortController();
  dev.addEventListener(
    'advertisementreceived',
    () => {
      watchAbort?.abort(); // 省電：連上就停止掃描
      watchAbort = null;
      void attachAndListen(dev)
        .then(() => toast(`已自動連線 ${dev.name ?? 'pyController'}`, 'success'))
        .catch(() => {
          /* 下次廣播再試 */
          watchForDevice(dev);
        });
    },
    { once: true },
  );
  dev.watchAdvertisements({ signal: watchAbort.signal }).catch(() => {
    /* 不支援或被拒 → 維持手動連線 */
  });
}

/** 開頁自動重連：曾授權過的裝置直接監聽廣播，免再開選擇視窗 */
async function tryAutoReconnect(): Promise<void> {
  if (!bluetooth?.getDevices) return;
  try {
    const devices = await bluetooth.getDevices();
    if (devices.length === 0) return;
    device = devices[0] ?? null; // 教室情境一人一支，取第一支即可
    if (!device) return;
    device.addEventListener('gattserverdisconnected', () => void onUnexpectedDisconnect());
    watchForDevice(device);
  } catch {
    /* 靜默：自動重連是加分項，失敗不打擾 */
  }
}

async function connect(): Promise<void> {
  if (!bluetooth || connecting) return;
  connecting = true;
  try {
    toast('搜尋裝置中…（在視窗中選擇與手把螢幕相同的那台 pyCtrl-XX）');
    setBleButton('連線中…', false);
    // 用「服務 UUID」過濾：iOS/Bluefy 上比 namePrefix 可靠得多（namePrefix 在 iOS 常掃不到）
    device = await bluetooth.requestDevice({
      filters: [{ services: [NUS_SERVICE] }],
      optionalServices: [NUS_SERVICE],
    });
    device.addEventListener('gattserverdisconnected', () => void onUnexpectedDisconnect());

    toast(`連線中… ${device.name ?? ''}`);
    await attachAndListen(device);
    toast(`已連線：${device.name ?? 'pyController'}`, 'success');
  } catch (err) {
    resetToDisconnected();
    const msg = humanBleError(err);
    if (msg) toast(msg.text, msg.kind);
  } finally {
    connecting = false;
  }
}

function disconnect(): void {
  userDisconnected = true;
  watchAbort?.abort();
  watchAbort = null;
  if (device?.gatt?.connected) device.gatt.disconnect();
}

/** header「連線搖桿」按鈕：不支援的瀏覽器直接隱藏；點擊切換連線/斷線 */
export function initBle(): void {
  const btn = document.getElementById('connect-gamepad-btn');
  if (!btn) return;
  if (!isBleSupported()) {
    btn.style.display = 'none';
    return;
  }
  btn.addEventListener('click', () => {
    if (bleState.connected) {
      disconnect(); // 已連線 → 斷線
      return;
    }
    void connect();
  });

  // 配對過的裝置開頁自動接回（Chrome 85+ persistent permissions；其餘瀏覽器維持手動）
  void tryAutoReconnect();
}
