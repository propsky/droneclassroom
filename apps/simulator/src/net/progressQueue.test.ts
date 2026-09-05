import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sendToServer = vi.fn();
const wsState = { connected: false };

vi.mock('./ws', () => ({
  sendToServer,
  wsState,
}));

const studentToken = vi.fn<() => string | null>(() => null);
const studentSession = vi.fn<() => { me: { id: number } } | null>(() => null);

vi.mock('./studentAuth', () => ({
  getStudentToken: () => studentToken(),
  loadStudentSession: () => studentSession(),
}));

vi.mock('./progressLocalCache', () => ({
  loadProgressCache: vi.fn(() => null),
  saveProgressCache: vi.fn(),
  clearProgressCache: vi.fn(),
}));

vi.mock('./replayLogUpload', () => ({
  uploadReplayLog: vi.fn(() => Promise.resolve(null)),
}));

const busHandlers = new Map<string, Set<() => void>>();
vi.mock('../core/events', () => ({
  bus: {
    on: (ev: string, fn: () => void) => {
      if (!busHandlers.has(ev)) busHandlers.set(ev, new Set());
      busHandlers.get(ev)!.add(fn);
    },
    emit: vi.fn(),
  },
  toast: vi.fn(),
}));

describe('progressQueue', () => {
  const store = new Map<string, string>();

  beforeEach(async () => {
    vi.resetModules();
    sendToServer.mockClear();
    wsState.connected = false;
    studentToken.mockReturnValue(null);
    studentSession.mockReturnValue(null);
    store.clear();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
    });
    busHandlers.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('訪客過關不帶 clientEventId', async () => {
    const { reportComplete } = await import('./progressQueue');
    reportComplete('1-1', 30000);
    expect(sendToServer).toHaveBeenCalledWith({
      type: 'complete_level',
      levelId: '1-1',
      timeMs: 30000,
    });
  });

  it('帳號斷線時入佇列', async () => {
    studentToken.mockReturnValue('tok');
    studentSession.mockReturnValue({ me: { id: 7 } });
    const { reportComplete } = await import('./progressQueue');
    reportComplete('1-2', 25000);
    await vi.waitFor(() => expect(store.get('creafly_progress_queue')).toBeTruthy());
    const raw = store.get('creafly_progress_queue')!;
    const q = JSON.parse(raw) as { levelId: string; sid: number }[];
    expect(q[0]?.levelId).toBe('1-2');
    expect(q[0]?.sid).toBe(7);
    expect(sendToServer).not.toHaveBeenCalled();
  });

  it('帳號連線中直送並在 ack 後更新本地', async () => {
    studentToken.mockReturnValue('tok');
    studentSession.mockReturnValue({ me: { id: 3 } });
    wsState.connected = true;
    const { reportComplete, handleCompleteAck, progressState } = await import('./progressQueue');
    reportComplete('1-3', 18000);
    await vi.waitFor(() => expect(sendToServer).toHaveBeenCalled());
    const eid = sendToServer.mock.calls[0]![0].clientEventId as string;
    handleCompleteAck(eid);
    expect(progressState.progress['1-3']).toEqual({ bestTimeMs: 18000, attempts: 1 });
  });

  it('handleProgressSync 以伺服器為準覆蓋', async () => {
    const { handleProgressSync, progressState } = await import('./progressQueue');
    handleProgressSync({
      '2-1': { bestTimeMs: 9000, attempts: 2 },
    });
    expect(progressState.progress).toEqual({ '2-1': { bestTimeMs: 9000, attempts: 2 } });
  });
});
