// 離線成績佇列 + 學生歷史進度（帳號模式）。
// 職責：
//   - reportComplete()：過關上報唯一入口（net/ws.ts 的 level-complete 轉呼叫）
//       訪客        → 照舊直接送 complete_level（不帶新欄位；斷線時 sendToServer 靜默丟棄）
//       帳號・連線中 → 帶 clientEventId/clientTs 直接送；3 秒沒收到 complete_ack → 進佇列備援
//       帳號・斷線   → 直接進佇列，重連後補傳（flush 帶原 clientTs + offline:true，稽核留痕）
//   - 佇列存 localStorage `creafly_progress_queue`（上限 200 筆防爆，滿了丟最舊）
//   - ws-connected（register 已在 onopen 先送出，同一條 WS 訊息有序）→ flush 逐筆補傳；
//     收到 complete_ack 才移除該筆（伺服器靠 clientEventId 冪等去重，重送無害）
//   - progress_sync / complete_ack → progressState 更新 + 發 progress-updated（關卡選單勾勾）
// 與 net/ws.ts 互相 import（皆為函式內延遲取用，無模組初始化循環問題）。
import type { ProgressSyncMsg } from '@creafly/shared';
import { bus, toast } from '../core/events';
import { getStudentToken, loadStudentSession } from './studentAuth';
import { sendToServer, wsState } from './ws';

const LS_QUEUE = 'creafly_progress_queue';
/** 佇列上限：離線一整學期也塞不滿；防 localStorage 爆量 */
const MAX_QUEUE = 200;
/** 連線中直送後等 ack 的備援時限：逾時視同沒送到，進佇列等重連補傳 */
const ACK_TIMEOUT_MS = 3000;

interface QueuedComplete {
  clientEventId: string;
  /** 真實完成時刻（ms epoch）：補傳時原樣帶上，伺服器稽核雙時間戳用 */
  clientTs: number;
  levelId: string;
  timeMs: number;
  /** 完成者（students.id）：共用裝置換帳號時只補傳本人的，避免成績掛錯人 */
  sid: number;
}

export interface LevelProgress {
  bestTimeMs: number | null;
  attempts: number;
}

/** 學生歷史進度（progress_sync 下發 + 本地 ack 即時併入）；訪客恆為空 */
export const progressState = {
  progress: {} as Record<string, LevelProgress>,
};

/** 同場只提示一次「已離線紀錄成績」；成功清空佇列後重置（下次再離線會再提示） */
let offlineToastShown = false;
/** 本次連線有補傳過 → 佇列清空時 toast「離線成績已上傳 ✓」 */
let flushed = false;
/** 連線中直送、尚未收到 ack 的事件（逾時進佇列備援） */
const pendingAcks = new Map<string, { entry: QueuedComplete; timer: ReturnType<typeof setTimeout> }>();

/** 冪等鍵：優先 crypto.randomUUID（http LAN 非安全上下文沒有 → getRandomValues 手組 UUID v4） */
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
    /* 隱私模式等寫不進去：本場仍靠記憶體內 pendingAcks 盡力送，重整後遺失 */
  }
}

function enqueue(entry: QueuedComplete): void {
  const q = loadQueue();
  if (q.some((e) => e.clientEventId === entry.clientEventId)) return;
  q.push(entry);
  while (q.length > MAX_QUEUE) {
    const dropped = q.shift();
    console.warn(
      `[progressQueue] 佇列已滿（${MAX_QUEUE} 筆），丟棄最舊一筆：`,
      dropped?.levelId,
      dropped?.clientEventId,
    );
  }
  saveQueue(q);
}

/**
 * 過關上報唯一入口。訪客路徑行為與過去完全相同（不帶新欄位）；
 * 帳號模式一律帶 clientEventId/clientTs，離線先入佇列、重連自動補傳。
 */
export function reportComplete(levelId: string, timeMs: number): void {
  const token = getStudentToken();
  if (!token) {
    // 訪客：照舊直接送（斷線時 sendToServer 靜默丟棄 — 訪客本來就不記錄成績）
    sendToServer({ type: 'complete_level', levelId, timeMs });
    return;
  }
  const entry: QueuedComplete = {
    clientEventId: genEventId(),
    clientTs: Date.now(),
    levelId,
    timeMs,
    sid: loadStudentSession()?.me.id ?? 0,
  };
  if (wsState.connected) {
    sendToServer({
      type: 'complete_level',
      levelId,
      timeMs,
      clientEventId: entry.clientEventId,
      clientTs: entry.clientTs,
    });
    // 直送不進佇列 — 等 ack；3 秒沒回應（伺服器忙 / 恰好斷線）才進佇列備援
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
}

/** 重連後補傳：只送本人的（共用裝置別人的留在佇列等本人登入）；ack 到才移除 */
function flushQueue(): void {
  if (!getStudentToken() || !wsState.connected) return;
  const sid = loadStudentSession()?.me.id ?? 0;
  const mine = loadQueue().filter((e) => e.sid === sid);
  if (mine.length === 0) return;
  flushed = true;
  for (const e of mine) {
    sendToServer({
      type: 'complete_level',
      levelId: e.levelId,
      timeMs: e.timeMs,
      clientEventId: e.clientEventId,
      clientTs: e.clientTs, // 原完成時刻，不是補傳時刻
      offline: true,
    });
  }
}

/** net/ws.ts 收到 complete_ack：清備援計時器、移出佇列、本地標記進度（不等下次 sync） */
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

/** net/ws.ts 收到 progress_sync：伺服器為準整份覆蓋（跨裝置同步） */
export function handleProgressSync(progress: ProgressSyncMsg['progress']): void {
  progressState.progress = { ...progress };
  bus.emit('progress-updated', {});
}

function markLocalComplete(levelId: string, timeMs: number): void {
  const cur = progressState.progress[levelId];
  progressState.progress[levelId] = {
    bestTimeMs: cur?.bestTimeMs == null ? timeMs : Math.min(cur.bestTimeMs, timeMs),
    attempts: (cur?.attempts ?? 0) + 1,
  };
  bus.emit('progress-updated', {});
}

/** net/ws.ts initWs() 呼叫一次：接上重連 flush 與登出清空 */
export function initProgressQueue(): void {
  // register 在 ws.onopen 同步先送、ws-connected 後發 — 同一條 WS 訊息有序，補傳一定排在 register 之後
  bus.on('ws-connected', () => flushQueue());
  // 登出：勾勾是帳號的資料 → 清畫面狀態；佇列保留（按 sid 隔離，本人再登入才補傳）
  bus.on('student-logout', () => {
    progressState.progress = {};
    bus.emit('progress-updated', {});
  });
}
