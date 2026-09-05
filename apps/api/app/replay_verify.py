"""伺服器重播驗證（J-02）：呼叫 simulator 的 Node bundle 重算 replayHash。"""
from __future__ import annotations

import json
import logging
import subprocess
from pathlib import Path

logger = logging.getLogger("creafly.api.replay_verify")

_SIMULATOR_ROOT = Path(__file__).resolve().parents[2] / "simulator"
_VERIFY_SCRIPT = _SIMULATOR_ROOT / "scripts" / "verify-recording.mts"


def verify_input_log(input_log: dict | None, replay_hash: str | None) -> str | None:
    """重播 inputLog 並比對 hash；回傳 suspect 原因字串，通過則 None。

    未附 inputLog / replayHash → 跳過（向後相容舊 client）。
    驗證失敗（subprocess 錯誤、hash 不符）→ 回傳原因供 roster 標 suspect。
    """
    if input_log is None or replay_hash is None:
        return None
    if not _VERIFY_SCRIPT.is_file():
        logger.warning("[Replay] 找不到驗證腳本 %s，跳過重播", _VERIFY_SCRIPT)
        return None
    try:
        proc = subprocess.run(
            ["pnpm", "exec", "tsx", str(_VERIFY_SCRIPT)],
            input=json.dumps({"recording": input_log, "claimedHash": replay_hash}),
            capture_output=True,
            text=True,
            timeout=60,
            cwd=str(_SIMULATOR_ROOT),
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        logger.exception("[Replay] 子進程失敗：%s", exc)
        return "重播驗證失敗（伺服器無法執行）"
    if proc.returncode != 0:
        logger.warning("[Replay] 驗證腳本失敗 stderr=%s", proc.stderr[:500])
        return "重播驗證失敗（錄製格式或物理不一致）"
    line = next((ln for ln in proc.stdout.splitlines() if ln.startswith("RESULT ")), None)
    if not line:
        return "重播驗證失敗（無輸出）"
    try:
        result = json.loads(line[7:])
    except json.JSONDecodeError:
        return "重播驗證失敗（輸出解析錯誤）"
    if not result.get("ok"):
        return result.get("reason") or "重播 hash 不符"
    return None
