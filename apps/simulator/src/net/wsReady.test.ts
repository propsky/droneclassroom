import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WsReady, type WsReadySource } from './wsReady';

function fakeWs(connected = false): WsReadySource & { connect(): void; listeners: number } {
  let fns: Array<() => void> = [];
  const src = {
    up: connected,
    connected: () => src.up,
    onConnected(fn: () => void) {
      fns.push(fn);
      return () => {
        fns = fns.filter((f) => f !== fn);
      };
    },
    connect() {
      src.up = true;
      [...fns].forEach((f) => f());
    },
    get listeners() {
      return fns.length;
    },
  };
  return src;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('等 WebSocket 連上再載關卡', () => {
  it('已經連上：馬上 true', async () => {
    await expect(WsReady.wait(fakeWs(true), 8000)).resolves.toBe(true);
  });

  it('重新整理時晚一點才連上：等到連上就 true，不再監聽', async () => {
    const ws = fakeWs();
    const p = WsReady.wait(ws, 8000);
    vi.advanceTimersByTime(1500);
    ws.connect();
    await expect(p).resolves.toBe(true);
    expect(ws.listeners).toBe(0);
  });

  it('一直連不上：逾時 false，不再監聽', async () => {
    const ws = fakeWs();
    const p = WsReady.wait(ws, 8000);
    vi.advanceTimersByTime(8000);
    await expect(p).resolves.toBe(false);
    expect(ws.listeners).toBe(0);
  });
});
