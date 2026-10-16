// 真機連線偏好：橋接位址、距離比例，以及上次的模擬器／真機選擇。
// 這裡不碰 DOM。瀏覽器 localStorage 由 ui 傳進來。
import type { ExecutionMode } from '@creafly/shared';

export const DEFAULT_BRIDGE_URL = 'ws://localhost:8765/ws';
export const DEFAULT_CM_PER_METER = 10;

/** 設定面板可選的比例（1 模擬公尺 = 幾公分） */
export const SCALE_CHOICES = [10, 25, 50, 100] as const;

export const EXECUTION_MODE_STORAGE_KEY = 'creafly.exec.mode';
export const BRIDGE_URL_STORAGE_KEY = 'creafly.exec.bridgeUrl';
export const SCALE_STORAGE_KEY = 'creafly.exec.cmPerMeter';

export interface PrefStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

let cmPerMeter = DEFAULT_CM_PER_METER;
let bridgeUrl = DEFAULT_BRIDGE_URL;

export function getCmPerMeter(): number {
  return cmPerMeter;
}

export function getBridgeUrl(): string {
  return bridgeUrl;
}

export function setCmPerMeter(value: number): boolean {
  if (!(SCALE_CHOICES as readonly number[]).includes(value)) return false;
  cmPerMeter = value;
  return true;
}

export function setBridgeUrl(url: string): void {
  bridgeUrl = url;
}

/** 空字串用預設位址。不是 ws:// 或 wss:// 就回 null。 */
export function normalizeBridgeUrl(raw: string): string | null {
  const text = raw.trim();
  if (!text) return DEFAULT_BRIDGE_URL;
  if (!/^wss?:\/\/\S+$/i.test(text)) return null;
  return text;
}

export function scaleOptionLabel(cm: number): string {
  const takeoff = Math.min(150, 8 * cm);
  const forward = 2 * cm;
  return `${cm} 公分（起飛 8 公尺 → ${takeoff} 公分，前進 2 公尺 → ${forward} 公分）`;
}

function read(store: PrefStore, key: string): string | null {
  try {
    return store.getItem(key);
  } catch {
    return null;
  }
}

function write(store: PrefStore, key: string, value: string): void {
  try {
    store.setItem(key, value);
  } catch {
    /* 無痕模式存不了就算了 */
  }
}

export function loadStoredExecutionMode(store: PrefStore): ExecutionMode {
  return read(store, EXECUTION_MODE_STORAGE_KEY) === 'real' ? 'real' : 'sim';
}

export function saveStoredExecutionMode(store: PrefStore, mode: ExecutionMode): void {
  write(store, EXECUTION_MODE_STORAGE_KEY, mode);
}

export function loadStoredBridgeUrl(store: PrefStore): string {
  const raw = read(store, BRIDGE_URL_STORAGE_KEY);
  if (raw === null) return DEFAULT_BRIDGE_URL;
  return normalizeBridgeUrl(raw) ?? DEFAULT_BRIDGE_URL;
}

export function loadStoredScale(store: PrefStore): number {
  const raw = read(store, SCALE_STORAGE_KEY);
  const value = Number(raw);
  if ((SCALE_CHOICES as readonly number[]).includes(value)) return value;
  return DEFAULT_CM_PER_METER;
}

export function saveStoredLinkPrefs(store: PrefStore, url: string, scale: number): void {
  write(store, BRIDGE_URL_STORAGE_KEY, url);
  write(store, SCALE_STORAGE_KEY, String(scale));
}

/** 把存檔套進目前這次頁面的設定。不連線。 */
export function hydrateRealPrefs(store: PrefStore): { mode: ExecutionMode; url: string; scale: number } {
  const mode = loadStoredExecutionMode(store);
  const url = loadStoredBridgeUrl(store);
  const scale = loadStoredScale(store);
  setBridgeUrl(url);
  setCmPerMeter(scale);
  return { mode, url, scale };
}
