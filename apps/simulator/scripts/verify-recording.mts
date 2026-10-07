// J-02 伺服器重播驗證進入點：stdin JSON（VerifyInput）→ stdout `RESULT {...}`（VerifyResult）。
// 判定邏輯見 src/core/replayVerify.ts。
import { verifyRecording, type VerifyInput } from '../src/core/replayVerify';
import { SIM_VERSION } from '../src/core/simVersion';

async function main(): Promise<void> {
  const body = JSON.parse(await readStdin()) as VerifyInput;
  const result = await verifyRecording(body);
  console.log(`RESULT ${JSON.stringify(result)}`);
  process.exit(result.status === 'mismatch' ? 1 : 0);
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
  console.log(
    `RESULT ${JSON.stringify({ status: 'unverifiable', reason: `驗證器錯誤：${String(e)}`, simVersion: SIM_VERSION })}`,
  );
  process.exit(2);
});
