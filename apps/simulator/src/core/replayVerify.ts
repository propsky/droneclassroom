// J-02 伺服器重播驗證判定（純 core，Node 驗證器與單元測試共用）。
//
// 輸入：{ recording, claimedHash, levelId, timeMs, serverLevel?, levelRecentlyEdited? }
//   serverLevel：伺服器資料庫的關卡定義（權威）；有給就用它重播，學生端快照只拿來比對
// 輸出 status：
//   ok           — 重播 hash 相符且確實過關
//   mismatch     — 可疑（格式錯誤 / 關卡不符 / hash 不符 / 重播沒過關 / 用時不合理）
//   unverifiable — 無法判斷（舊版前端、前後端版本不同、關卡剛被老師修改…）— 不是學生的錯
import { replayRecording } from './replayRunner';
import { TICK_MS } from './droneState';
import { SIM_VERSION } from './simVersion';
import type { InputRecordingV2, LevelDef } from '@creafly/shared';
import { isInputRecordingV2, validateRecording } from '@creafly/shared';

export interface VerifyInput {
  recording: unknown;
  claimedHash: string;
  levelId?: string;
  timeMs?: number;
  serverLevel?: LevelDef | null;
  levelRecentlyEdited?: boolean;
}

export type VerifyStatus = 'ok' | 'mismatch' | 'unverifiable';

export interface VerifyResult {
  status: VerifyStatus;
  reason?: string;
  replayHash?: string;
  completed?: boolean;
  ticks?: number;
  simVersion: string;
}

/** 鍵排序後的 JSON：比對兩份關卡定義內容（與鍵順序、undefined 欄位無關） */
function canonical(v: unknown): string {
  const norm = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(norm);
    if (x && typeof x === 'object') {
      const o = x as Record<string, unknown>;
      return Object.fromEntries(
        Object.keys(o)
          .filter((k) => o[k] !== undefined)
          .sort()
          .map((k) => [k, norm(o[k])]),
      );
    }
    return x;
  };
  return JSON.stringify(norm(JSON.parse(JSON.stringify(v))));
}

/** 宣告用時不得短於模擬時間（模擬只會因掉幀 / 分頁背景比牆鐘慢，不會更快） */
const TIME_SLACK_RATIO = 1.02;
const TIME_SLACK_MS = 500;

export async function verifyRecording(input: VerifyInput): Promise<VerifyResult> {
  const base = { simVersion: SIM_VERSION };
  const raw = input.recording as { v?: unknown } | null;
  if (!isInputRecordingV2(raw)) {
    if (raw && typeof raw === 'object' && raw.v === 1) {
      return { ...base, status: 'unverifiable', reason: '舊版錄製格式（前端尚未更新）' };
    }
    return { ...base, status: 'mismatch', reason: '錄製格式錯誤' };
  }
  const rec: InputRecordingV2 = raw;
  if (input.levelId !== undefined && rec.levelId !== input.levelId) {
    return { ...base, status: 'mismatch', reason: '錄製關卡與過關關卡不符' };
  }
  if (rec.simVersion !== SIM_VERSION && rec.simVersion !== 'dev' && SIM_VERSION !== 'dev') {
    return { ...base, status: 'unverifiable', reason: `前後端模擬版本不同（${rec.simVersion}）` };
  }
  if (rec.unverifiable) return { ...base, status: 'unverifiable', reason: rec.unverifiable };
  const err = validateRecording(rec);
  if (err) return { ...base, status: 'mismatch', reason: err };

  if (input.serverLevel) {
    if (canonical(rec.level) !== canonical(input.serverLevel)) {
      return input.levelRecentlyEdited
        ? { ...base, status: 'unverifiable', reason: '關卡在嘗試期間被老師修改' }
        : { ...base, status: 'mismatch', reason: '錄製關卡內容與伺服器不符' };
    }
    rec.level = input.serverLevel;
  }

  const result = await replayRecording(rec);
  const out = { ...base, replayHash: result.replayHash, completed: result.completed, ticks: result.ticks };
  if (result.replayHash !== input.claimedHash) {
    return {
      ...out,
      status: 'mismatch',
      reason: `重播 hash ${result.replayHash} ≠ 宣告 ${input.claimedHash}`,
    };
  }
  if (!result.completed) return { ...out, status: 'mismatch', reason: '依錄製輸入重播未能過關' };
  const simMs = result.ticks * TICK_MS;
  if (typeof input.timeMs === 'number' && input.timeMs * TIME_SLACK_RATIO + TIME_SLACK_MS < simMs) {
    return {
      ...out,
      status: 'mismatch',
      reason: `宣告用時 ${(input.timeMs / 1000).toFixed(1)}s 短於模擬時間 ${(simMs / 1000).toFixed(1)}s`,
    };
  }
  return { ...out, status: 'ok' };
}
