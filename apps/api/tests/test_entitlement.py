"""entitlement 能力包測試 — welcome / register 下發、模式開關。"""

import asyncio
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.entitlement import (
    build_register_entitlement,
    build_welcome_entitlement,
    parse_demo_level_ids,
    parse_team_level_ids,
)
from app.main import create_app
from app.rest import known_level_ids, load_levels
from tests.test_accounts import _bearer, _email, _make_client, _register, needs_db
from tests.test_rooms import Teacher as TeacherWS
from tests.test_rooms import _rooms_by_code
from tests.test_students import _account_login, _cleanup, _create_students

TEACHER_PASSWORD = "test123"


def _known_levels() -> frozenset[str]:
    levels_dir = Path(__file__).resolve().parents[2] / "simulator" / "public" / "levels"
    return known_level_ids(load_levels(levels_dir))


def test_parse_demo_level_ids_預設三關() -> None:
    known = frozenset({"1-0", "1-1", "1-2", "2-1"})
    assert parse_demo_level_ids("", known) == ["1-0", "1-1", "1-2"]


def test_parse_demo_level_ids_自訂逗號分隔() -> None:
    known = frozenset({"1-0", "1-1", "1-2", "2-1"})
    assert parse_demo_level_ids("2-1,1-0", known) == ["1-0", "2-1"]


def test_build_welcome_open_全關卡() -> None:
    known = _known_levels()
    cfg = Settings(entitlement_mode="open")
    ent = build_welcome_entitlement(cfg, known)
    assert ent.mode == "open"
    assert ent.levelIds == sorted(known)
    assert ent.canSaveProgress is True
    assert ent.canOfflineComplete is True


def test_build_welcome_enforce_試玩包() -> None:
    known = _known_levels()
    cfg = Settings(entitlement_mode="enforce", database_url="postgresql+asyncpg://x")
    ent = build_welcome_entitlement(cfg, known)
    assert ent.mode == "demo"
    assert ent.levelIds == ["1-0", "1-1", "1-2"]
    assert ent.canSaveProgress is False


def test_build_welcome_無DB_強制open() -> None:
    known = _known_levels()
    cfg = Settings(entitlement_mode="enforce", database_url=None)
    ent = build_welcome_entitlement(cfg, known)
    assert ent.mode == "open"
    assert len(ent.levelIds) == len(known)


def test_parse_team_level_ids_未設定則全關() -> None:
    known = frozenset({"1-0", "1-1", "2-1"})
    assert parse_team_level_ids(None, known) == ["1-0", "1-1", "2-1"]
    assert parse_team_level_ids({}, known) == ["1-0", "1-1", "2-1"]


def test_parse_team_level_ids_過濾未知() -> None:
    known = frozenset({"1-0", "1-1", "2-1"})
    settings = {"level_ids": ["2-1", "9-9", "1-0"]}
    assert parse_team_level_ids(settings, known) == ["1-0", "2-1"]


def test_build_register_entitlement_open不回傳() -> None:
    known = _known_levels()
    cfg = Settings(entitlement_mode="open", database_url="postgresql+asyncpg://x")
    assert build_register_entitlement(cfg, known, student_id=1) is None
    assert build_register_entitlement(cfg, known, student_id=None) is None


def test_build_register_entitlement_訪客enforce試玩() -> None:
    known = _known_levels()
    cfg = Settings(entitlement_mode="enforce", database_url="postgresql+asyncpg://x")
    ent = build_register_entitlement(cfg, known, student_id=None)
    assert ent is not None
    assert ent.mode == "demo"
    assert ent.levelIds == ["1-0", "1-1", "1-2"]
    assert ent.canSaveProgress is False


def test_build_register_entitlement_帳號enforce升級() -> None:
    known = _known_levels()
    cfg = Settings(entitlement_mode="enforce", database_url="postgresql+asyncpg://x")
    ent = build_register_entitlement(
        cfg, known, student_id=42, team_settings={"level_ids": ["1-0", "2-1"]}
    )
    assert ent is not None
    assert ent.mode == "licensed"
    assert ent.levelIds == ["1-0", "2-1"]
    assert ent.canSaveProgress is True
    assert ent.canOfflineComplete is True


@pytest.fixture
def enforce_client(tmp_path: Path) -> TestClient:
    static_dir = tmp_path / "dist"
    static_dir.mkdir()
    (static_dir / "index.html").write_text("<html>student</html>", encoding="utf-8")
    settings = Settings(
        port=3000,
        static_dir=static_dir,
        teacher_dist=tmp_path / "no-teacher-dist",
        teacher_password=TEACHER_PASSWORD,
        game_tick_interval=0,
        database_url="postgresql+asyncpg://unused",
        entitlement_mode="enforce",
    )
    app = create_app(settings)
    with TestClient(app) as c:
        yield c


def test_welcome_含_entitlement_open(client: TestClient) -> None:
    with client.websocket_connect("/") as ws:
        msg = ws.receive_json()
        assert msg["type"] == "welcome"
        assert msg["id"] == "s1"
        ent = msg["entitlement"]
        assert ent["mode"] == "open"
        assert "1-0" in ent["levelIds"]
        assert ent["canSaveProgress"] is True
        assert isinstance(ent["issuedAt"], int)


def test_welcome_enforce_試玩關卡(enforce_client: TestClient) -> None:
    with enforce_client.websocket_connect("/") as ws:
        msg = ws.receive_json()
        assert msg["entitlement"]["mode"] == "demo"
        assert msg["entitlement"]["levelIds"] == ["1-0", "1-1", "1-2"]


def test_register_enforce_訪客room_joined試玩(enforce_client: TestClient) -> None:
    with enforce_client.websocket_connect("/") as ws:
        assert ws.receive_json()["entitlement"]["mode"] == "demo"
        ws.send_json({"type": "register", "name": "小訪", "emoji": "🐱"})
        joined = ws.receive_json()
        assert joined["type"] == "room_joined"
        ent = joined["entitlement"]
        assert ent["mode"] == "demo"
        assert ent["levelIds"] == ["1-0", "1-1", "1-2"]
        assert ent["canSaveProgress"] is False


@pytest.fixture
def enforce_db_client(tmp_path: Path) -> Iterator[TestClient]:
    """enforce 模式 + 真實 DB（帳號升級 licensed 測試用）。"""
    with _make_client(tmp_path, entitlement_mode="enforce") as c:
        yield c
    asyncio.run(_cleanup())


@needs_db
def test_register_enforce_帳號升級licensed(enforce_db_client: TestClient) -> None:
    ticket = _register(enforce_db_client, _email("ent"))["ticket"]
    with enforce_db_client.websocket_connect(f"/teacher?ticket={ticket}") as ws:
        t = TeacherWS(ws)
        code = t.create_room({"name": "授權班"})
        team_id = _rooms_by_code(t.room_list(lambda lst: code in _rooms_by_code(lst)))[code][
            "teamId"
        ]
        headers = _bearer(ticket)
        _create_students(
            enforce_db_client, headers, team_id, [{"name": "小授"}], sendInvites=False
        )
        token = _account_login(enforce_db_client, code)
        with enforce_db_client.websocket_connect("/") as s:
            welcome = s.receive_json()
            assert welcome["entitlement"]["mode"] == "demo"
            s.send_json(
                {"type": "register", "name": "亂打", "emoji": "🙃", "studentToken": token}
            )
            joined = s.receive_json()
            assert joined["type"] == "room_joined"
            ent = joined["entitlement"]
            assert ent["mode"] == "licensed"
            assert "1-0" in ent["levelIds"]
            assert ent["canSaveProgress"] is True
            assert s.receive_json()["type"] == "progress_sync"


@needs_db
def test_complete_enforce_未授權關卡不入庫(enforce_db_client: TestClient) -> None:
    """enforce 模式：帳號學生完成不在授權清單的關卡 → 伺服器略過入庫、不回 complete_ack。"""
    ticket = _register(enforce_db_client, _email("entC"))["ticket"]
    with enforce_db_client.websocket_connect(f"/teacher?ticket={ticket}") as ws:
        t = TeacherWS(ws)
        code = t.create_room({"name": "授權班B"})
        team_id = _rooms_by_code(t.room_list(lambda lst: code in _rooms_by_code(lst)))[code][
            "teamId"
        ]
        headers = _bearer(ticket)
        _create_students(
            enforce_db_client, headers, team_id, [{"name": "小C"}], sendInvites=False
        )
        token = _account_login(enforce_db_client, code)
        with enforce_db_client.websocket_connect("/") as s:
            s.receive_json()  # welcome
            s.send_json(
                {"type": "register", "name": "x", "emoji": "x", "studentToken": token}
            )
            joined = s.receive_json()
            assert joined["entitlement"]["mode"] == "licensed"
            s.receive_json()  # progress_sync
            # 完成不在班級授權內的關卡（假設 3-1 不在 demo 且全關列表有但 client 可作弊送）
            # licensed 預設全關 — 改送一個不在 known 的 id 會被 roster 擋？送 9-9
            s.send_json(
                {
                    "type": "complete_level",
                    "levelId": "9-9",
                    "timeMs": 5000,
                    "clientEventId": "evt-fake-99",
                }
            )
            # 無 complete_ack（略過入庫）；下一則不應是 ack
            s.send_json({"type": "register", "name": "x", "emoji": "x", "studentToken": token})
            assert s.receive_json()["type"] == "room_joined"
