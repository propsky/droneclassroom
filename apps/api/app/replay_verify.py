"""伺服器重播驗證（J-02）：以 Node 子進程重跑 simulator core，重算 replayHash 比對。

驗證器來源（依序）：
  1. 打包單檔 `replay_verifier_bundle`（`node <檔>`）— 正式環境 Docker 映像內建
  2. 開發 fallback：`pnpm exec tsx apps/simulator/scripts/verify-recording.mts`
  3. 都沒有 → 跳過驗證（啟動時 log 警告；不是學生的錯，不標 suspect）

子進程一律 asyncio 非同步執行並以 Semaphore 限制並行數：
驗證期間事件迴圈照常服務其他房間的賽局 tick / 廣播（t4g.micro 僅 1GB RAM，並行不宜多）。
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
from dataclasses import dataclass, field
from pathlib import Path

from .config import Settings

logger = logging.getLogger("creafly.api.replay_verify")

_SIMULATOR_ROOT = Path(__file__).resolve().parents[2] / "simulator"
_DEV_SCRIPT = _SIMULATOR_ROOT / "scripts" / "verify-recording.mts"


@dataclass
class ReplayVerifier:
    """None command = 驗證器不可用（跳過驗證）。"""

    command: list[str] | None
    cwd: Path | None = None
    timeout_sec: float = 30.0
    concurrency: int = 2
    _sem: asyncio.Semaphore | None = field(default=None, init=False, repr=False)

    @classmethod
    def from_settings(cls, cfg: Settings) -> ReplayVerifier:
        bundle = cfg.replay_verifier_bundle
        if bundle.is_file():
            cmd: list[str] | None = [cfg.replay_node_bin, str(bundle)]
            cwd = None
        elif _DEV_SCRIPT.is_file():
            cmd = ["pnpm", "exec", "tsx", str(_DEV_SCRIPT)]
            cwd = _SIMULATOR_ROOT
        else:
            cmd, cwd = None, None
        return cls(
            command=cmd,
            cwd=cwd,
            timeout_sec=cfg.replay_verify_timeout_sec,
            concurrency=max(1, cfg.replay_verify_concurrency),
        )

    @property
    def available(self) -> bool:
        return self.command is not None

    async def verify(self, input_log: dict | None, replay_hash: str | None) -> str | None:
        """重播 inputLog 並比對 hash；回傳 suspect 原因字串，通過則 None。

        未附 inputLog / replayHash → 跳過（向後相容舊 client）。
        驗證器不可用 / 伺服器端執行失敗 → 跳過（伺服器問題不算學生作弊）。
        hash 不符 / 錄製格式錯誤 → 回傳原因供 roster 標 suspect。
        """
        if input_log is None or replay_hash is None or self.command is None:
            return None
        if self._sem is None:
            self._sem = asyncio.Semaphore(self.concurrency)
        payload = json.dumps({"recording": input_log, "claimedHash": replay_hash}).encode()
        async with self._sem:
            try:
                proc = await asyncio.create_subprocess_exec(
                    *self.command,
                    stdin=asyncio.subprocess.PIPE,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                    cwd=str(self.cwd) if self.cwd else None,
                )
            except OSError:
                logger.exception("[Replay] 無法啟動驗證器 %s", self.command)
                return None
            try:
                stdout, stderr = await asyncio.wait_for(
                    proc.communicate(payload), timeout=self.timeout_sec
                )
            except TimeoutError:
                with contextlib.suppress(ProcessLookupError):
                    proc.kill()
                await proc.wait()
                logger.warning("[Replay] 驗證逾時（%.0fs），跳過", self.timeout_sec)
                return None
        # 驗證器以 exit 1 表示「不通過」，原因在 RESULT 行 → 先解析輸出再看 exit code
        line = next(
            (ln for ln in stdout.decode(errors="replace").splitlines() if ln.startswith("RESULT ")),
            None,
        )
        if line is None:
            logger.warning(
                "[Replay] 驗證器無 RESULT 輸出 rc=%s stderr=%s",
                proc.returncode,
                stderr.decode(errors="replace")[:500],
            )
            return None
        try:
            result = json.loads(line[7:])
        except json.JSONDecodeError:
            logger.warning("[Replay] RESULT 解析失敗：%s", line[:200])
            return None
        if result.get("ok"):
            return None
        return result.get("reason") or "重播 hash 不符"
