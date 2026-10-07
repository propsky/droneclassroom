"""伺服器重播驗證（J-02）：以 Node 子進程重跑 simulator core，重算 replayHash 並確認確實過關。

驗證器來源（依序）：
  1. 打包單檔 `replay_verifier_bundle`（`node <檔>`）— 正式環境 Docker 映像內建
  2. 開發 fallback：`pnpm exec tsx apps/simulator/scripts/verify-recording.mts`
  3. 都沒有 → 跳過驗證（啟動時 log 警告；不是學生的錯，不標 suspect）

判定邏輯在 simulator `src/core/replayVerify.ts`，結果三態：
  ok / mismatch（可疑）/ unverifiable（無法判斷：舊版前端、前後端版本不同、關卡剛被修改…）
伺服器自身問題（逾時、無法啟動、輸出異常）一律 skipped，絕不算學生作弊。

子進程一律 asyncio 非同步執行並以 Semaphore 限制並行數：
驗證期間事件迴圈照常服務其他房間的賽局 tick / 廣播（t4g.micro 僅 1GB RAM，並行不宜多）。
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

from .config import Settings

logger = logging.getLogger("creafly.api.replay_verify")

_SIMULATOR_ROOT = Path(__file__).resolve().parents[2] / "simulator"
_DEV_SCRIPT = _SIMULATOR_ROOT / "scripts" / "verify-recording.mts"

VerifyStatus = Literal["ok", "mismatch", "unverifiable", "skipped"]


@dataclass(frozen=True)
class VerifyOutcome:
    status: VerifyStatus
    reason: str | None = None


_SKIPPED = VerifyOutcome("skipped")

# 子進程只拿到執行必需的環境變數：DATABASE_URL / 寄信 / AWS 等機密絕不外流給驗證器
_ENV_PASSTHROUGH = ("PATH", "HOME", "LANG", "LC_ALL", "TMPDIR")


def _subprocess_env() -> dict[str, str]:
    return {k: v for k in _ENV_PASSTHROUGH if (v := os.environ.get(k)) is not None}


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
            # 錄製內容來自學生端（不可信）：禁止 eval / new Function，
            # 就算判定邏輯有漏洞也無法執行注入的程式碼
            cmd: list[str] | None = [
                cfg.replay_node_bin,
                "--disallow-code-generation-from-strings",
                str(bundle),
            ]
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

    async def verify(
        self,
        input_log: dict | None,
        replay_hash: str | None,
        *,
        level_id: str | None = None,
        time_ms: float | None = None,
        server_level: dict[str, Any] | None = None,
        level_recently_edited: bool = False,
    ) -> VerifyOutcome:
        """重播 inputLog：比對 hash、確認過關、檢查用時與關卡內容。

        未附 inputLog / replayHash、驗證器不可用、伺服器端執行失敗 → skipped。
        """
        if input_log is None or replay_hash is None or self.command is None:
            return _SKIPPED
        if self._sem is None:
            self._sem = asyncio.Semaphore(self.concurrency)
        body: dict[str, Any] = {
            "recording": input_log,
            "claimedHash": replay_hash,
            "levelRecentlyEdited": level_recently_edited,
        }
        if level_id is not None:
            body["levelId"] = level_id
        if time_ms is not None:
            body["timeMs"] = time_ms
        if server_level is not None:
            body["serverLevel"] = server_level
        payload = json.dumps(body).encode()
        async with self._sem:
            try:
                proc = await asyncio.create_subprocess_exec(
                    *self.command,
                    stdin=asyncio.subprocess.PIPE,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                    cwd=str(self.cwd) if self.cwd else None,
                    env=_subprocess_env(),
                )
            except OSError:
                logger.exception("[Replay] 無法啟動驗證器 %s", self.command)
                return _SKIPPED
            try:
                stdout, stderr = await asyncio.wait_for(
                    proc.communicate(payload), timeout=self.timeout_sec
                )
            except TimeoutError:
                with contextlib.suppress(ProcessLookupError):
                    proc.kill()
                await proc.wait()
                logger.warning("[Replay] 驗證逾時（%.0fs），跳過", self.timeout_sec)
                return _SKIPPED
        # 驗證器以非 0 exit 表示「不通過」，原因在 RESULT 行 → 先解析輸出再看 exit code
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
            return _SKIPPED
        try:
            result = json.loads(line[7:])
        except json.JSONDecodeError:
            logger.warning("[Replay] RESULT 解析失敗：%s", line[:200])
            return _SKIPPED
        status = result.get("status")
        if status is None:  # 舊版驗證器輸出（只有 ok 布林）
            status = "ok" if result.get("ok") else "mismatch"
        reason = result.get("reason")
        if status == "ok":
            return VerifyOutcome("ok")
        if status == "unverifiable":
            return VerifyOutcome("unverifiable", reason or "無法驗證")
        if status == "mismatch":
            return VerifyOutcome("mismatch", reason or "重播 hash 不符")
        logger.warning("[Replay] 未知驗證狀態：%s", status)
        return _SKIPPED
