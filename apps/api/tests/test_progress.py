"""學生進度持久化測試 — complete_level 入庫（progress + audit）/ ack / dedupe / progress_sync。

需要真實 PostgreSQL（DATABASE_URL），沒設就 skip。端點會 commit，無法用 rollback 隔離 →
沿用 test_students 慣例：唯一 email 註冊老師、結束時清乾淨（progress 先刪，FK 指向 students）。
"""

import asyncio
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.db.models import AuditEvent, Progress
from app.db.session import create_engine, create_sessionmaker
from tests.db_cleanup import cleanup_test_teachers
from tests.test_accounts import (
    DATABASE_URL,
    EMAIL_DOMAIN,
    _bearer,
    _email,
    _make_client,
    _register,
    needs_db,
)
from tests.test_rooms import Teacher as TeacherWS
from tests.test_rooms import _rooms_by_code
from tests.test_students import _account_login, _create_students

# ---------- fixture 與 DB helpers ----------


async def _cleanup() -> None:
    """刪除測試資料（含 progress）。"""
    assert DATABASE_URL
    await cleanup_test_teachers(DATABASE_URL, email_domain=EMAIL_DOMAIN)


@pytest.fixture
def db_client(tmp_path: Path) -> Iterator[TestClient]:
    """帶真實 DATABASE_URL 的 app；結束後清理測試資料（含 progress）。"""
    with _make_client(tmp_path) as c:
        yield c
    asyncio.run(_cleanup())


async def _progress_row(student_id: int, level_id: str) -> Progress | None:
    assert DATABASE_URL
    engine = create_engine(DATABASE_URL)
    maker = create_sessionmaker(engine)
    async with maker() as s:
        row = await s.get(Progress, (student_id, level_id))
    await engine.dispose()
    return row


async def _audit_by_dedupe(key: str) -> AuditEvent | None:
    assert DATABASE_URL
    engine = create_engine(DATABASE_URL)
    maker = create_sessionmaker(engine)
    async with maker() as s:
        row = (
            await s.execute(select(AuditEvent).where(AuditEvent.dedupe_key == key))
        ).scalar_one_or_none()
    await engine.dispose()
    return row


def _setup_account_student(db_client: TestClient, tag: str) -> tuple[str, int, int, str]:
    """老師開班級房 + 建一位學生 + 學生碼登入；回 (房碼, team_id, student_id, 學生 token)。

    老師 WS 開完房即斷線 —— 房留在記憶體（測試 game_tick_interval=0 不會閒置自動關）。
    """
    ticket = _register(db_client, _email(tag))["ticket"]
    with db_client.websocket_connect(f"/teacher?ticket={ticket}") as ws:
        t = TeacherWS(ws)
        code = t.create_room({"name": "進度班"})
        team_id = _rooms_by_code(t.room_list(lambda lst: code in _rooms_by_code(lst)))[code][
            "teamId"
        ]
    body = _create_students(
        db_client, _bearer(ticket), team_id, [{"name": "小進"}], sendInvites=False
    )
    return code, team_id, body["created"][0]["id"], _account_login(db_client, code)


@contextmanager
def _account_ws(db_client: TestClient, token: str) -> Iterator[tuple]:
    """學生帳號模式進場；yield (ws, 進房後收到的 progress_sync)。"""
    with db_client.websocket_connect("/") as s:
        assert s.receive_json()["type"] == "welcome"
        s.send_json({"type": "register", "name": "x", "emoji": "x", "studentToken": token})
        assert s.receive_json()["type"] == "room_joined"
        sync = s.receive_json()
        assert sync["type"] == "progress_sync"
        yield s, sync


def _complete(s, level_id: str, time_ms: float, event_id: str, **extra) -> None:
    s.send_json({"type": "progress", "levelId": level_id})
    s.send_json(
        {
            "type": "complete_level",
            "levelId": level_id,
            "timeMs": time_ms,
            "clientEventId": event_id,
            **extra,
        }
    )


# ---------- 帳號學生：入庫 / ack / 更快更新 / dedupe / 重連同步 ----------


@needs_db
def test_帳號過關_入庫收ack_更快更新best_重送去重_重連progress_sync(db_client: TestClient) -> None:
    code, team_id, student_id, token = _setup_account_student(db_client, "prg")
    eid1, eid2 = str(uuid.uuid4()), str(uuid.uuid4())
    client_ts = 1_755_000_000_000
    with _account_ws(db_client, token) as (s, sync):
        assert sync["progress"] == {}  # 新生：空進度也下行（client 以此確認同步完成）
        # 首次過關 → progress 一列 + audit 雙時間戳 + 收 ack
        _complete(s, "1-1", 30000, eid1, clientTs=client_ts)
        assert s.receive_json() == {"type": "complete_ack", "clientEventId": eid1}
        row = asyncio.run(_progress_row(student_id, "1-1"))
        assert row is not None
        assert row.best_time_ms == 30000 and row.attempts == 1
        assert row.suspect is False
        assert row.first_completed_at is not None and row.last_completed_at is not None
        first_at = row.first_completed_at
        ev = asyncio.run(_audit_by_dedupe(eid1))
        assert ev is not None and ev.event_type == "level.completed"
        assert ev.student_id == student_id and ev.team_id == team_id
        assert ev.actor_type == "student" and ev.actor_id == student_id
        # 雙時間戳：occurred_at（DB now）之外，payload 留 client_ts 與 server_ts
        assert ev.occurred_at is not None
        assert ev.payload["client_ts"] == client_ts and ev.payload["server_ts"] > 0
        assert ev.payload["level_id"] == "1-1" and ev.payload["time_ms"] == 30000
        assert ev.payload["offline"] is False
        assert ev.payload["suspect"] is False and ev.payload["suspect_reasons"] == []
        # 再過同關更快 → best 更新、attempts=2、first_completed_at 不變
        _complete(s, "1-1", 20000, eid2)
        assert s.receive_json() == {"type": "complete_ack", "clientEventId": eid2}
        row = asyncio.run(_progress_row(student_id, "1-1"))
        assert row.best_time_ms == 20000 and row.attempts == 2
        assert row.first_completed_at == first_at
        # 重送第一筆（同 clientEventId）→ attempts 不變、best 不退步、仍回 ack
        _complete(s, "1-1", 30000, eid1, clientTs=client_ts)
        assert s.receive_json() == {"type": "complete_ack", "clientEventId": eid1}
        row = asyncio.run(_progress_row(student_id, "1-1"))
        assert row.best_time_ms == 20000 and row.attempts == 2
    # 重連進房：progress_sync 有成績、名冊帶歷史（老師看到延續的進度）
    with _account_ws(db_client, token) as (s, sync):
        assert sync["progress"] == {"1-1": {"bestTimeMs": 20000, "attempts": 2}}
        roster = db_client.app.state.rooms.get(code).roster
        rec = next(r for r in roster.students if r.student_id == student_id)
        assert rec.level == "1-1" and rec.time == 20000


@needs_db
def test_多關卡進度_新連線全量sync(db_client: TestClient) -> None:
    """模擬換裝置 / 伺服器重啟後重連：DB 進度完整下發。"""
    code, _, student_id, token = _setup_account_student(db_client, "prg2")
    eid1, eid2 = str(uuid.uuid4()), str(uuid.uuid4())
    with _account_ws(db_client, token) as (s, _):
        _complete(s, "1-1", 22000, eid1)
        assert s.receive_json()["type"] == "complete_ack"
        _complete(s, "1-2", 31000, eid2)
        assert s.receive_json()["type"] == "complete_ack"
    with _account_ws(db_client, token) as (s, sync):
        assert sync["progress"] == {
            "1-1": {"bestTimeMs": 22000, "attempts": 1},
            "1-2": {"bestTimeMs": 31000, "attempts": 1},
        }
        roster = db_client.app.state.rooms.get(code).roster
        rec = next(r for r in roster.students if r.student_id == student_id)
        assert rec.level in ("1-1", "1-2")


# ---------- 離線補傳：跳過對時規則、留痕；< 1 秒照標 ----------


@needs_db
def test_offline補傳_無progress前置不標suspect_短於1秒照標(db_client: TestClient) -> None:
    _, _, student_id, token = _setup_account_student(db_client, "off")
    eid1, eid2 = str(uuid.uuid4()), str(uuid.uuid4())
    with _account_ws(db_client, token) as (s, _):
        # 離線補傳沒有 progress 前置（無法對時是預期）→ 不標 suspect；payload 留 offline 痕跡
        s.send_json(
            {
                "type": "complete_level",
                "levelId": "1-1",
                "timeMs": 30000,
                "clientEventId": eid1,
                "clientTs": 1_755_000_000_000,
                "offline": True,
            }
        )
        assert s.receive_json() == {"type": "complete_ack", "clientEventId": eid1}
        row = asyncio.run(_progress_row(student_id, "1-1"))
        assert row is not None and row.suspect is False
        ev = asyncio.run(_audit_by_dedupe(eid1))
        assert ev.payload["offline"] is True
        assert ev.payload["suspect"] is False and ev.payload["suspect_reasons"] == []
        # offline 但宣稱 < 1 秒（與對時無關的規則）→ 照標
        s.send_json(
            {
                "type": "complete_level",
                "levelId": "1-2",
                "timeMs": 500,
                "clientEventId": eid2,
                "offline": True,
            }
        )
        assert s.receive_json() == {"type": "complete_ack", "clientEventId": eid2}
        row = asyncio.run(_progress_row(student_id, "1-2"))
        assert row is not None and row.suspect is True
        ev = asyncio.run(_audit_by_dedupe(eid2))
        assert ev.payload["offline"] is True and ev.payload["suspect"] is True
        assert len(ev.payload["suspect_reasons"]) == 1


# ---------- 訪客：行為與從前完全相同（不入庫、不回 ack）----------


@needs_db
def test_訪客過關_不入庫_不回ack(db_client: TestClient) -> None:
    eid = str(uuid.uuid4())
    with db_client.websocket_connect("/") as s:
        assert s.receive_json()["type"] == "welcome"
        s.send_json({"type": "register", "name": "小訪", "emoji": "🐱"})
        joined = s.receive_json()
        assert joined["type"] == "room_joined" and joined["room"]["code"] == "MAIN"
        _complete(s, "1-1", 30000, eid)
        # 哨兵：再 register 一次 → 下一則必是 room_joined（中間沒有 complete_ack / progress_sync）
        s.send_json({"type": "register", "name": "小訪", "emoji": "🐱"})
        assert s.receive_json()["type"] == "room_joined"
    assert asyncio.run(_audit_by_dedupe(eid)) is None  # 沒有稽核事件 = 沒走入庫路徑
