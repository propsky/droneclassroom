import type { InputRecordingV1 } from '@creafly/shared';
import { mergeLevelProgress, replaceProgressMap } from '@creafly/shared';
import { bus, toast } from '../core/events';
import { clearProgressCache, loadProgressCache, saveProgressCache } from './progressLocalCache';
import { uploadReplayLog } from './replayLogUpload';
import { getStudentToken, loadStudentSession } from './studentAuth';
import { sendToServer, wsState } from './ws';

const LS_QUEUE = 'creafly_progress_queue';
const MAX_QUEUE = 200;
const ACK_TIMEOUT_MS = 3000;

interface QueuedComplete {
  clientEventId: string;
  clientTs: number;
  levelId: string;
  timeMs: number;
  sid: number;
  replayLogRef?: string;
  replayHash?: string;
}

export interface LevelProgress {
  bestTimeMs: number | null;
  attempts: number;
}

export const progressState = {
  progress: {} as Record<string, LevelProgress>,
};

let offlineToastShown = false;
let flushed = false;
const pendingAcks = new Map<string, { entry: QueuedComplete; timer: ReturnType<typeof setTimeout> }>();

function genEventId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0'));
  return `${h.slice(0, 4).join('')}-${h.slice(4, 6).join('')}-${h.slice(6, 8).join('')}-${h.slice(8, 10).join('')}-${h.slice(10).join('')}`;
}

function loadQueue(): QueuedComplete[] {
  try {
    const raw = localStorage.getItem(LS_QUEUE);
    if (!raw) return [];
    const q = JSON.parse(raw) as unknown;
    if (!Array.isArray(q)) return [];
    return q.filter(
      (e): e is QueuedComplete =>
        !!e && typeof e === 'object' && typeof (e as QueuedComplete).clientEventId === 'string',
    );
  } catch {
    return [];
  }
}

function saveQueue(q: QueuedComplete[]): void {
  try {
    localStorage.setItem(LS_QUEUE, JSON.stringify(q));
  } catch {
    /* 隱私模式 */
  }
}

function enqueue(entry: QueuedComplete): void {
  const q = loadQueue();
  if (q.some((e) => e.clientEventId === entry.clientEventId)) return;
  q.push(entry);
  while (q.length > MAX_QUEUE) {
    const dropped = q.shift();
    console.warn(`[progressQueue] 佇列已滿，丟棄：`, dropped?.levelId);
  }
  saveQueue(q);
}

async function resolveReplayRefs(
  clientEventId: string,
  inputLog?: InputRecordingV1,
  replayHash?: string,
): Promise<{ replayLogRef?: string; replayHash?: string }> {
  if (!inputLog || !replayHash) return { replayHash };
  const logRef = await uploadReplayLog(clientEventId, inputLog);
  if (!logRef) return { replayHash };
  return { replayLogRef: logRef, replayHash };
}

function sendCompletePayload(entry: QueuedComplete, offline = false): void {
  sendToServer({
    type: 'complete_level',
    levelId: entry.levelId,
    timeMs: entry.timeMs,
    clientEventId: entry.clientEventId,
    clientTs: entry.clientTs,
    offline,
    replayLogRef: entry.replayLogRef,
    replayHash: entry.replayHash,
  });
}

/**
 * 過關上報唯一入口。帳號模式附帶 replayLogRef + replayHash（錄製先 REST 上傳）。
 */
export function reportComplete(
  levelId: string,
  timeMs: number,
  extras?: { inputLog?: InputRecordingV1; replayHash?: string },
): void {
  const token = getStudentToken();
  if (!token) {
    sendToServer({ type: 'complete_level', levelId, timeMs });
    return;
  }
  const entry: QueuedComplete = {
    clientEventId: genEventId(),
    clientTs: Date.now(),
    levelId,
    timeMs,
    sid: loadStudentSession()?.me.id ?? 0,
    replayHash: extras?.replayHash ?? extras?.inputLog?.replayHash,
  };

  void (async () => {
    const refs = await resolveReplayRefs(entry.clientEventId, extras?.inputLog, entry.replayHash);
    entry.replayLogRef = refs.replayLogRef;
    entry.replayHash = refs.replayHash;

    if (wsState.connected) {
      sendCompletePayload(entry);
      const timer = setTimeout(() => {
        pendingAcks.delete(entry.clientEventId);
        enqueue(entry);
      }, ACK_TIMEOUT_MS);
      pendingAcks.set(entry.clientEventId, { entry, timer });
    } else {
      enqueue(entry);
      if (!offlineToastShown) {
        offlineToastShown = true;
        toast('📴 已離線紀錄成績，連線後自動上傳', 'warning');
      }
    }
  })();
}

function flushQueue(): void {
  if (!getStudentToken() || !wsState.connected) return;
  const sid = loadStudentSession()?.me.id ?? 0;
  const mine = loadQueue().filter((e) => e.sid === sid);
  if (mine.length === 0) return;
  flushed = true;
  for (const e of mine) sendCompletePayload(e, true);
}

export function handleCompleteAck(clientEventId: string): void {
  const pending = pendingAcks.get(clientEventId);
  if (pending) {
    clearTimeout(pending.timer);
    pendingAcks.delete(clientEventId);
    markLocalComplete(pending.entry.levelId, pending.entry.timeMs);
  }
  const q = loadQueue();
  const idx = q.findIndex((e) => e.clientEventId === clientEventId);
  if (idx < 0) return;
  const [acked] = q.splice(idx, 1);
  saveQueue(q);
  if (acked) markLocalComplete(acked.levelId, acked.timeMs);
  const sid = loadStudentSession()?.me.id ?? 0;
  if (flushed && !q.some((e) => e.sid === sid)) {
    flushed = false;
    offlineToastShown = false;
    toast('離線成績已上傳 ✓', 'success');
  }
}

export function handleProgressSync(progress: import('@creafly/shared').ProgressSyncMsg['progress']): void {
  progressState.progress = replaceProgressMap(progress);
  const sid = loadStudentSession()?.me.id;
  if (sid != null) saveProgressCache(sid, progressState.progress);
  bus.emit('progress-updated', {});
}

function markLocalComplete(levelId: string, timeMs: number): void {
  progressState.progress[levelId] = mergeLevelProgress(progressState.progress[levelId], timeMs);
  const sid = loadStudentSession()?.me.id;
  if (sid != null) saveProgressCache(sid, progressState.progress);
  bus.emit('progress-updated', {});
}

function hydrateProgressFromCache(): void {
  const session = loadStudentSession();
  if (!session) return;
  const cached = loadProgressCache(session.me.id);
  if (!cached) return;
  progressState.progress = cached;
  bus.emit('progress-updated', {});
}

export function refreshProgressFromCache(): void {
  hydrateProgressFromCache();
}

export function initProgressQueue(): void {
  hydrateProgressFromCache();
  bus.on('ws-connected', () => flushQueue());
  bus.on('student-logout', () => {
    progressState.progress = {};
    clearProgressCache();
    bus.emit('progress-updated', {});
  });
}
