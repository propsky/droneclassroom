// 輸入錄製 REST 上傳（J-01）：WS 4KB 限制下，完整 JSON 走 POST /auth/student/replay-log。
import type { InputRecordingV1 } from '@creafly/shared';
import { getStudentToken } from './studentAuth';

const API_BASE = import.meta.env.VITE_API_URL ?? '';

/** 上傳錄製；回傳 logRef（冪等鍵 = clientLogId）。失敗回 null（不阻擋過關上報）。 */
export async function uploadReplayLog(
  clientLogId: string,
  recording: InputRecordingV1,
): Promise<string | null> {
  const token = getStudentToken();
  if (!token) return null;
  try {
    const res = await fetch(`${API_BASE}/auth/student/replay-log`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ clientLogId, recording }),
    });
    if (!res.ok) {
      console.warn('[replayLog] 上傳失敗', res.status, await res.text());
      return null;
    }
    const body = (await res.json()) as { logRef?: string };
    return body.logRef ?? clientLogId;
  } catch (e) {
    console.warn('[replayLog] 上傳錯誤', e);
    return null;
  }
}
