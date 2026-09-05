// J-02 伺服器重播驗證進入點：stdin JSON { recording, claimedHash } → stdout RESULT { ok, replayHash }。
import { replayRecording } from '../src/core/replayRunner';
import type { InputRecordingV1 } from '@creafly/shared';
import { isInputRecordingV1, validateRecording } from '@creafly/shared';

interface VerifyInput {
  recording: InputRecordingV1;
  claimedHash: string;
}

async function main(): Promise<void> {
  const raw = await readStdin();
  const body = JSON.parse(raw) as VerifyInput;
  if (!isInputRecordingV1(body.recording)) {
    console.log(JSON.stringify({ ok: false, reason: '錄製格式錯誤' }));
    process.exit(1);
    return;
  }
  const err = validateRecording(body.recording);
  if (err) {
    console.log(JSON.stringify({ ok: false, reason: err }));
    process.exit(1);
    return;
  }
  const result = await replayRecording(body.recording);
  const ok = result.replayHash === body.claimedHash;
  console.log(
    `RESULT ${JSON.stringify({
      ok,
      replayHash: result.replayHash,
      claimedHash: body.claimedHash,
      ticks: result.ticks,
      reason: ok ? undefined : `重播 hash ${result.replayHash} ≠ 宣告 ${body.claimedHash}`,
    })}`,
  );
  process.exit(ok ? 0 : 1);
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on('data', (c) => chunks.push(c));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    process.stdin.on('error', reject);
  });
}

void main().catch((e) => {
  console.log(`RESULT ${JSON.stringify({ ok: false, reason: String(e) })}`);
  process.exit(1);
});
