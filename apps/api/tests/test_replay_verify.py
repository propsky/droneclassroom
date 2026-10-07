"""重播驗證器（J-02）：非同步子進程、逾時、輸出解析、不阻塞事件迴圈。"""

import asyncio
import json
import shutil
import sys
import time
from pathlib import Path

import pytest

from app.config import Settings
from app.replay_verify import ReplayVerifier

REC = {"v": 1, "levelId": "1-1"}


def _stub(code: str, **kw: object) -> ReplayVerifier:
    """以 python -c 假冒驗證器（讀 stdin、印 RESULT）。"""
    return ReplayVerifier(command=[sys.executable, "-c", code], **kw)  # type: ignore[arg-type]


async def test_unavailable_skips() -> None:
    assert await ReplayVerifier(command=None).verify(REC, "abc") is None


async def test_missing_inputs_skip() -> None:
    v = _stub("raise SystemExit(9)")
    assert await v.verify(None, "abc") is None
    assert await v.verify(REC, None) is None


async def test_ok_result_passes() -> None:
    v = _stub("import sys;sys.stdin.read();print('RESULT {\"ok\": true}')")
    assert await v.verify(REC, "abc") is None


async def test_mismatch_returns_reason_even_with_exit_1() -> None:
    code = (
        "import sys,json;d=json.load(sys.stdin);"
        "print('RESULT '+json.dumps({'ok':False,'reason':'hash 不符 '+d['claimedHash']}));"
        "sys.exit(1)"
    )
    assert await _stub(code).verify(REC, "abc") == "hash 不符 abc"


async def test_no_result_line_skips() -> None:
    v = _stub("import sys;sys.stdin.read();print('boom', file=sys.stderr);sys.exit(2)")
    assert await v.verify(REC, "abc") is None


async def test_timeout_kills_and_skips() -> None:
    v = _stub("import time;time.sleep(30)", timeout_sec=0.3)
    t0 = time.monotonic()
    assert await v.verify(REC, "abc") is None
    assert time.monotonic() - t0 < 5


async def test_does_not_block_event_loop() -> None:
    v = _stub("import sys,time;sys.stdin.read();time.sleep(0.5);print('RESULT {\"ok\": true}')")
    ticks = 0

    async def ticker() -> None:
        nonlocal ticks
        while True:
            await asyncio.sleep(0.02)
            ticks += 1

    task = asyncio.create_task(ticker())
    try:
        assert await v.verify(REC, "abc") is None
    finally:
        task.cancel()
    assert ticks >= 10


async def test_concurrency_limited() -> None:
    v = _stub(
        "import sys,time;sys.stdin.read();time.sleep(0.3);print('RESULT {\"ok\": true}')",
        concurrency=1,
    )
    t0 = time.monotonic()
    await asyncio.gather(v.verify(REC, "a"), v.verify(REC, "b"))
    assert time.monotonic() - t0 >= 0.55


def test_from_settings_prefers_bundle(tmp_path: Path) -> None:
    bundle = tmp_path / "verify.mjs"
    bundle.write_text("")
    cfg = Settings(replay_verifier_bundle=bundle, replay_node_bin="nodex")
    v = ReplayVerifier.from_settings(cfg)
    assert v.command == ["nodex", str(bundle)]


_REAL_BUNDLE = Settings().replay_verifier_bundle


@pytest.mark.skipif(
    shutil.which("node") is None or not _REAL_BUNDLE.is_file(),
    reason="需先 pnpm --filter @creafly/simulator build:replay-verifier",
)
async def test_real_bundle_detects_hash_mismatch() -> None:
    levels = json.loads(Settings().levels_dir.joinpath("chapter1.json").read_text("utf-8"))
    level = (levels["levels"] if isinstance(levels, dict) else levels)[1]
    frame = {"lift": 1, "forward": 0, "right": 0, "yawDelta": 0, "wantsTakeoff": True}
    rec = {
        "v": 1,
        "levelId": level["id"],
        "level": level,
        "rngSeed": 7,
        "ticks": 30,
        "frames": [frame] * 30,
        "replayHash": "0",
    }
    v = ReplayVerifier.from_settings(Settings())
    reason = await v.verify(rec, "0")
    assert reason is not None and "重播 hash" in reason

    bad = {**rec, "ticks": 31}
    assert await v.verify(bad, "0") == "frames 與 ticks 不一致"
