"""重播驗證器（J-02）：非同步子進程、逾時、三態輸出解析、不阻塞事件迴圈、ws 判定流程。"""

import asyncio
import json
import shutil
import sys
import time
from contextlib import asynccontextmanager
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from app import ws as ws_mod
from app.config import Settings
from app.protocol import CompleteLevelMsg
from app.replay_verify import ReplayVerifier, VerifyOutcome
from app.roster import StudentRecord

REC = {"v": 2, "levelId": "1-1"}


def _stub(code: str, **kw: object) -> ReplayVerifier:
    """以 python -c 假冒驗證器（讀 stdin、印 RESULT）。"""
    return ReplayVerifier(command=[sys.executable, "-c", code], **kw)  # type: ignore[arg-type]


def _result(payload: dict, rc: int = 0) -> str:
    return (
        "import sys,json;sys.stdin.read();"
        f"print('RESULT '+json.dumps({payload!r}));sys.exit({rc})"
    )


async def test_unavailable_skips() -> None:
    assert (await ReplayVerifier(command=None).verify(REC, "abc")).status == "skipped"


async def test_missing_inputs_skip() -> None:
    v = _stub("raise SystemExit(9)")
    assert (await v.verify(None, "abc")).status == "skipped"
    assert (await v.verify(REC, None)).status == "skipped"


async def test_ok_result_passes() -> None:
    assert (await _stub(_result({"status": "ok"})).verify(REC, "abc")).status == "ok"


async def test_mismatch_returns_reason_even_with_nonzero_exit() -> None:
    v = _stub(_result({"status": "mismatch", "reason": "hash 不符"}, rc=1))
    assert await v.verify(REC, "abc") == VerifyOutcome("mismatch", "hash 不符")


async def test_unverifiable_passthrough() -> None:
    v = _stub(_result({"status": "unverifiable", "reason": "版本不同"}))
    assert await v.verify(REC, "abc") == VerifyOutcome("unverifiable", "版本不同")


async def test_legacy_ok_bool_output() -> None:
    v = _stub(_result({"ok": False, "reason": "舊"}, rc=1))
    assert await v.verify(REC, "abc") == VerifyOutcome("mismatch", "舊")


async def test_inputs_forwarded_to_verifier() -> None:
    code = (
        "import sys,json;d=json.load(sys.stdin);"
        "ok=d['levelId']=='1-4' and d['timeMs']==1234 and d['serverLevel']=={'id':'1-4'}"
        " and d['levelRecentlyEdited'] is True;"
        "print('RESULT '+json.dumps({'status':'ok' if ok else 'mismatch','reason':str(d)}))"
    )
    out = await _stub(code).verify(
        REC,
        "abc",
        level_id="1-4",
        time_ms=1234,
        server_level={"id": "1-4"},
        level_recently_edited=True,
    )
    assert out.status == "ok", out.reason


async def test_no_result_line_skips() -> None:
    v = _stub("import sys;sys.stdin.read();print('boom', file=sys.stderr);sys.exit(2)")
    assert (await v.verify(REC, "abc")).status == "skipped"


async def test_timeout_kills_and_skips() -> None:
    v = _stub("import time;time.sleep(30)", timeout_sec=0.3)
    t0 = time.monotonic()
    assert (await v.verify(REC, "abc")).status == "skipped"
    assert time.monotonic() - t0 < 5


async def test_does_not_block_event_loop() -> None:
    v = _stub(
        "import sys,time;sys.stdin.read();time.sleep(0.5);print('RESULT {\"status\": \"ok\"}')"
    )
    ticks = 0

    async def ticker() -> None:
        nonlocal ticks
        while True:
            await asyncio.sleep(0.02)
            ticks += 1

    task = asyncio.create_task(ticker())
    try:
        assert (await v.verify(REC, "abc")).status == "ok"
    finally:
        task.cancel()
    assert ticks >= 10


async def test_concurrency_limited() -> None:
    v = _stub(
        "import sys,time;sys.stdin.read();time.sleep(0.3);print('RESULT {\"status\": \"ok\"}')",
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


# ---------- 真實 bundle（需先 pnpm --filter @creafly/simulator build:replay-verifier）----------

_REAL_BUNDLE = Settings().replay_verifier_bundle
needs_bundle = pytest.mark.skipif(
    shutil.which("node") is None or not _REAL_BUNDLE.is_file(),
    reason="需先 pnpm --filter @creafly/simulator build:replay-verifier",
)


def _chapter1_level(level_id: str) -> dict:
    data = json.loads(Settings().levels_dir.joinpath("chapter1.json").read_text("utf-8"))
    levels = data["levels"] if isinstance(data, dict) else data
    return next(lv for lv in levels if lv["id"] == level_id)


def _v2(level: dict, **over: Any) -> dict:
    rec = {
        "v": 2,
        "levelId": level["id"],
        "level": level,
        "simVersion": "dev",
        "rngSeed": 7,
        "startTick": 0,
        "mode": "manual",
        "initial": {
            "position": {"x": 0, "y": 0.4, "z": 0},
            "velocity": {"x": 0, "y": 0, "z": 0},
            "yaw": 0,
            "isFlying": False,
            "isGrounded": True,
            "frozen": False,
        },
        "ticks": 0,
        "frames": [],
        "actions": [],
        "multiTickFrames": [],
        "replayHash": "cbf29ce484222325",
    }
    rec.update(over)
    return rec


@needs_bundle
async def test_real_bundle_empty_recording_is_suspect() -> None:
    """原漏洞：空錄製 + 初始 hash 曾被判通過。"""
    level = _chapter1_level("1-6")
    v = ReplayVerifier.from_settings(Settings())
    out = await v.verify(_v2(level), "cbf29ce484222325", level_id="1-6", server_level=level)
    assert out.status == "mismatch"
    assert "未能過關" in (out.reason or "")


@needs_bundle
async def test_real_bundle_level_id_and_forged_level() -> None:
    level = _chapter1_level("1-6")
    v = ReplayVerifier.from_settings(Settings())
    out = await v.verify(_v2(level), "cbf29ce484222325", level_id="1-0")
    assert out == VerifyOutcome("mismatch", "錄製關卡與過關關卡不符")
    forged = _v2({**level, "balloons": []})
    out = await v.verify(forged, "x", level_id="1-6", server_level=level)
    assert out == VerifyOutcome("mismatch", "錄製關卡內容與伺服器不符")


@needs_bundle
async def test_real_bundle_legacy_v1_unverifiable() -> None:
    v = ReplayVerifier.from_settings(Settings())
    out = await v.verify({"v": 1, "levelId": "1-1"}, "x", level_id="1-1")
    assert out.status == "unverifiable"


@needs_bundle
async def test_real_bundle_bad_structure_is_suspect() -> None:
    level = _chapter1_level("1-1")
    v = ReplayVerifier.from_settings(Settings())
    out = await v.verify(_v2(level, ticks=3), "x", level_id="1-1", server_level=level)
    assert out == VerifyOutcome("mismatch", "frames 與 ticks 不一致")


# ---------- ws._replay_suspect_reason：伺服器端判定流程 ----------


class _FakeVerifier:
    def __init__(self, outcome: VerifyOutcome) -> None:
        self.outcome = outcome
        self.calls: list[dict] = []

    async def verify(self, rec: dict, h: str, **kw: Any) -> VerifyOutcome:
        self.calls.append({"rec": rec, "hash": h, **kw})
        return self.outcome


def _fake_ws(verifier: _FakeVerifier, *, enforce: bool = False) -> SimpleNamespace:
    @asynccontextmanager
    async def maker():  # noqa: ANN202
        yield object()

    state = SimpleNamespace(
        db_sessionmaker=maker,
        settings=Settings(replay_enforce=enforce),
        replay_verifier=verifier,
    )
    return SimpleNamespace(app=SimpleNamespace(state=state))


def _msg(**over: Any) -> CompleteLevelMsg:
    base = {"type": "complete_level", "levelId": "1-4", "timeMs": 30000.0}
    base.update(over)
    return CompleteLevelMsg(**base)


@pytest.fixture
def student() -> StudentRecord:
    rec = StudentRecord(id="s1", ws=None)
    rec.student_id = 42
    return rec


@pytest.fixture
def patched_db(monkeypatch: pytest.MonkeyPatch) -> dict:
    store: dict = {"rec": {"v": 2}, "level": ({"id": "1-4"}, False)}

    async def load_rec(_s: object, ref: str, sid: int) -> dict | None:
        return store["rec"] if ref == "ref-1" and sid == 42 else None

    async def load_level(_s: object, level_id: str, *, edit_grace_sec: int):  # noqa: ANN202
        return store["level"]

    monkeypatch.setattr(ws_mod, "load_replay_recording", load_rec)
    monkeypatch.setattr(ws_mod, "load_level_for_replay", load_level)
    return store


async def test_reason_uses_server_level_and_claims(student, patched_db) -> None:  # noqa: ANN001
    fv = _FakeVerifier(VerifyOutcome("ok"))
    msg = _msg(replayLogRef="ref-1", replayHash="h")
    assert await ws_mod._replay_suspect_reason(_fake_ws(fv), student, msg) is None
    call = fv.calls[0]
    assert call["level_id"] == "1-4" and call["time_ms"] == 30000.0
    assert call["server_level"] == {"id": "1-4"} and call["level_recently_edited"] is False


async def test_reason_mismatch_and_missing_log(student, patched_db) -> None:  # noqa: ANN001
    fv = _FakeVerifier(VerifyOutcome("mismatch", "重播 hash 不符"))
    ws = _fake_ws(fv)
    assert await ws_mod._replay_suspect_reason(
        ws, student, _msg(replayLogRef="ref-1", replayHash="h")
    ) == "重播 hash 不符"
    assert await ws_mod._replay_suspect_reason(
        ws, student, _msg(replayLogRef="nope", replayHash="h")
    ) == "找不到輸入錄製"


async def test_reason_unverifiable_only_flags_when_enforced(student, patched_db) -> None:  # noqa: ANN001
    fv = _FakeVerifier(VerifyOutcome("unverifiable", "前後端模擬版本不同"))
    msg = _msg(replayLogRef="ref-1", replayHash="h")
    assert await ws_mod._replay_suspect_reason(_fake_ws(fv), student, msg) is None
    assert (
        await ws_mod._replay_suspect_reason(_fake_ws(fv, enforce=True), student, msg)
        == "無法驗證：前後端模擬版本不同"
    )


async def test_reason_no_log_only_flags_when_enforced_and_online(student, patched_db) -> None:  # noqa: ANN001
    fv = _FakeVerifier(VerifyOutcome("ok"))
    assert await ws_mod._replay_suspect_reason(_fake_ws(fv), student, _msg()) is None
    enforced = _fake_ws(fv, enforce=True)
    assert await ws_mod._replay_suspect_reason(enforced, student, _msg()) == "未附輸入錄製"
    assert await ws_mod._replay_suspect_reason(enforced, student, _msg(offline=True)) is None


async def test_reason_guest_or_no_db_skips(patched_db) -> None:  # noqa: ANN001
    fv = _FakeVerifier(VerifyOutcome("mismatch", "x"))
    guest = StudentRecord(id="g", ws=None)
    assert await ws_mod._replay_suspect_reason(
        _fake_ws(fv, enforce=True), guest, _msg(replayLogRef="ref-1", replayHash="h")
    ) is None
    assert fv.calls == []
