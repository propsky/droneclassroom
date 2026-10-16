import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_BRIDGE_URL,
  DEFAULT_CM_PER_METER,
  SCALE_CHOICES,
  getBridgeUrl,
  getCmPerMeter,
  hydrateRealPrefs,
  loadStoredBridgeUrl,
  loadStoredScale,
  normalizeBridgeUrl,
  saveStoredExecutionMode,
  saveStoredLinkPrefs,
  scaleOptionLabel,
  setBridgeUrl,
  setCmPerMeter,
  type PrefStore,
} from './realPrefs';

function memoryStore(initial: Record<string, string> = {}): PrefStore & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem(key) {
      const value = data[key];
      return value === undefined ? null : value;
    },
    setItem(key, value) {
      data[key] = value;
    },
  };
}

describe('真機偏好', () => {
  afterEach(() => {
    setBridgeUrl(DEFAULT_BRIDGE_URL);
    setCmPerMeter(DEFAULT_CM_PER_METER);
  });

  it('預設指向本機假橋接，比例 1 公尺 = 10 公分', () => {
    expect(getBridgeUrl()).toBe('ws://localhost:8765/ws');
    expect(getCmPerMeter()).toBe(10);
    expect(SCALE_CHOICES).toContain(10);
  });

  it('位址要是 ws 或 wss；空白用預設', () => {
    expect(normalizeBridgeUrl('')).toBe(DEFAULT_BRIDGE_URL);
    expect(normalizeBridgeUrl('  ws://127.0.0.1:8765/ws  ')).toBe('ws://127.0.0.1:8765/ws');
    expect(normalizeBridgeUrl('wss://bridge.example/ws')).toBe('wss://bridge.example/ws');
    expect(normalizeBridgeUrl('http://localhost:8765/ws')).toBeNull();
    expect(normalizeBridgeUrl('ws://bad host/ws')).toBeNull();
  });

  it('沒存過就是模擬器與預設位址', () => {
    const store = memoryStore();
    expect(hydrateRealPrefs(store)).toEqual({
      mode: 'sim',
      url: DEFAULT_BRIDGE_URL,
      scale: DEFAULT_CM_PER_METER,
    });
  });

  it('上次選擇、位址、比例會讀回來', () => {
    const store = memoryStore();
    saveStoredExecutionMode(store, 'real');
    saveStoredLinkPrefs(store, 'ws://10.0.0.8:8765/ws', 50);
    expect(hydrateRealPrefs(store)).toEqual({
      mode: 'real',
      url: 'ws://10.0.0.8:8765/ws',
      scale: 50,
    });
    expect(getBridgeUrl()).toBe('ws://10.0.0.8:8765/ws');
    expect(getCmPerMeter()).toBe(50);
  });

  it('壞掉的存檔退回預設', () => {
    const store = memoryStore();
    saveStoredLinkPrefs(store, 'not-a-socket', 10);
    store.setItem('creafly.exec.bridgeUrl', 'http://nope');
    store.setItem('creafly.exec.cmPerMeter', '7');
    store.setItem('creafly.exec.mode', 'maybe');
    expect(loadStoredBridgeUrl(store)).toBe(DEFAULT_BRIDGE_URL);
    expect(loadStoredScale(store)).toBe(DEFAULT_CM_PER_METER);
    expect(hydrateRealPrefs(store).mode).toBe('sim');
  });

  it('不在清單裡的比例設不進去', () => {
    expect(setCmPerMeter(15)).toBe(false);
    expect(getCmPerMeter()).toBe(DEFAULT_CM_PER_METER);
    expect(scaleOptionLabel(10)).toContain('80 公分');
    expect(scaleOptionLabel(100)).toContain('150 公分');
  });
});
