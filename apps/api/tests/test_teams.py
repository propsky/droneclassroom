"""班級持久化（Room ↔ teams 表）測試 — 老師開房 = DB 班級：固定碼、關房保留、重開、改設定同步、
封存、擁有者隔離、學生用班級碼 + 密碼（argon2 雜湊）進房。

需要真實 PostgreSQL（DATABASE_URL），沒設就 skip；無 DB 的房間行為由 test_rooms.py 覆蓋
（零改變）。老師用唯一 email 註冊，結束時把 teams / sessions / audit / teachers 清乾淨。
"""

import asyncio
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, or_, select

from app.accounts import verify_password
from app.db.models import AuditEvent, Session, Teacher, Team
from app.db.session import create_engine, create_sessionmaker
from tests.conftest import FakeClock, recv_until, settle
from tests.test_accounts import (
    DATABASE_URL,
    EMAIL_DOMAIN,
    _email,
    _make_client,
    _register,
    needs_db,
)
from tests.test_rooms import Teacher as TeacherWS
from tests.test_rooms import _join, _rooms_by_code

# ---------- helpers ----------


async def _cleanup() -> None:
    """刪掉測試老師建的班級、稽核事件、session 與老師本人（FK 順序：audit → teams → …）。"""
    assert DATABASE_URL
    engine = create_engine(DATABASE_URL)
    maker = create_sessionmaker(engine)
    async with maker() as s:
        ids = (
            (await s.execute(select(Teacher.id).where(Teacher.email.like(f"%@{EMAIL_DOMAIN}"))))
            .scalars()
            .all()
        )
        team_ids = (
            (await s.execute(select(Team.id).where(Team.owner_teacher_id.in_(ids)))).scalars().all()
        )
        await s.execute(
            delete(AuditEvent).where(
                or_(AuditEvent.team_id.in_(team_ids), AuditEvent.actor_id.in_(ids))
            )
        )
        await s.execute(delete(Team).where(Team.id.in_(team_ids)))
        await s.execute(delete(Session).where(Session.principal_id.in_(ids)))
        await s.execute(delete(Teacher).where(Teacher.id.in_(ids)))
        await s.commit()
    await engine.dispose()


async def _team_row(team_id: int) -> Team | None:
    assert DATABASE_URL
    engine = create_engine(DATABASE_URL)
    maker = create_sessionmaker(engine)
    async with maker() as s:
        row = await s.get(Team, team_id)
    await engine.dispose()
    return row


async def _audit(event_type: str, team_id: int) -> list[AuditEvent]:
    assert DATABASE_URL
    engine = create_engine(DATABASE_URL)
    maker = create_sessionmaker(engine)
    async with maker() as s:
        rows = (
            (
                await s.execute(
                    select(AuditEvent)
                    .where(AuditEvent.event_type == event_type, AuditEvent.team_id == team_id)
                    .order_by(AuditEvent.id)
                )
            )
            .scalars()
            .all()
        )
    await engine.dispose()
    return list(rows)


@pytest.fixture
def db_client(tmp_path: Path) -> Iterator[TestClient]:
    """帶真實 DATABASE_URL 的 app；結束後清理測試資料。"""
    with _make_client(tmp_path) as c:
        yield c
    asyncio.run(_cleanup())


def _teams_by_id(lst: dict) -> dict[int, dict]:
    return {t["id"]: t for t in lst["teams"]}


def _fresh_room_list(t: TeacherWS) -> dict:
    """確定「前面送的訊息都處理完」後的房間列表：選預設房會依序回 名冊 / 賽局快照 / room_list，
    讀到 soccer_state 之後的那份 room_list 一定是新的（不會誤抓佇列裡較早的推送）。"""
    t.select("MAIN")
    recv_until(t.ws, "soccer_state")
    return recv_until(t.ws, "room_list")


def _open_team(t: TeacherWS, team_id: int, code: str) -> dict:
    """送 room_open_team，等到 room_list.selected 變成該班級碼（開完伺服器自動切過去）。"""
    t.send_json({"type": "room_open_team", "teamId": team_id})
    t.selected = code
    return t.room_list(lambda lst: lst["selected"] == code)


# ---------- 測試 ----------


@needs_db
def test_班級生命週期_建房關房重開改設定封存_他人不可見(db_client: TestClient) -> None:
    token_a = _register(db_client, _email("teamA"))["ticket"]
    token_b = _register(db_client, _email("teamB"))["ticket"]
    with db_client.websocket_connect(f"/teacher?ticket={token_a}") as ws_a:
        t = TeacherWS(ws_a)
        # ----- room_create → DB 有 Team 列、room_list.teams 含它 open=true、code 相同 -----
        code = t.create_room({"name": "三年二班", "maxStudents": 5, "password": "abcd"})
        lst = t.room_list(lambda lst: code in _rooms_by_code(lst))
        room_info = _rooms_by_code(lst)[code]
        team_id = room_info["teamId"]
        assert isinstance(team_id, int)
        team = asyncio.run(_team_row(team_id))
        assert team is not None
        assert team.team_code == code and team.name == "三年二班" and team.max_students == 5
        assert team.locked is False and team.archived_at is None
        assert team.join_password_hash and verify_password(team.join_password_hash, "abcd")
        teams = _teams_by_id(lst)
        assert teams[team_id]["code"] == code and teams[team_id]["open"] is True
        assert teams[team_id]["hasPassword"] is True and teams[team_id]["name"] == "三年二班"
        assert room_info["hasPassword"] is True
        created = asyncio.run(_audit("team.created", team_id))
        assert len(created) == 1 and created[0].payload["team_code"] == code
        assert "password" not in created[0].payload

        # ----- room_close → 記憶體卸載、Team 仍在、open=false -----
        t.send_json({"type": "room_close", "roomCode": code})
        lst = t.room_list(lambda lst: code not in _rooms_by_code(lst))
        assert lst["selected"] == "MAIN"
        assert _teams_by_id(lst)[team_id]["open"] is False
        assert asyncio.run(_team_row(team_id)).archived_at is None
        assert db_client.app.state.rooms.get(code) is None

        # ----- room_open_team → 回來、code 相同、設定從 Team 載入 -----
        lst = _open_team(t, team_id, code)
        rooms = _rooms_by_code(lst)
        assert rooms[code]["teamId"] == team_id and rooms[code]["name"] == "三年二班"
        assert rooms[code]["maxStudents"] == 5 and rooms[code]["hasPassword"] is True
        assert _teams_by_id(lst)[team_id]["open"] is True
        # 再開一次：已開著只切換，不會多一間
        lst = _open_team(t, team_id, code)
        assert len([r for r in lst["rooms"] if r["teamId"] == team_id]) == 1

        # ----- room_update 改名 / 鎖房 → DB 同步、audit team.updated + team.locked -----
        t.send_json(
            {
                "type": "room_update",
                "roomCode": code,
                "settings": {"name": "三年三班", "locked": True, "password": ""},
            }
        )
        lst = t.room_list(lambda lst: _rooms_by_code(lst)[code]["locked"] is True)
        assert _rooms_by_code(lst)[code]["name"] == "三年三班"
        assert _rooms_by_code(lst)[code]["hasPassword"] is False
        team = asyncio.run(_team_row(team_id))
        assert team.name == "三年三班" and team.locked is True and team.join_password_hash is None
        updated = asyncio.run(_audit("team.updated", team_id))
        assert len(updated) == 1
        assert updated[0].payload["before"]["name"] == "三年二班"
        assert updated[0].payload["after"] == {
            "name": "三年三班",
            "has_password": False,
            "max_students": 5,
            "locked": True,
        }
        assert len(asyncio.run(_audit("team.locked", team_id))) == 1
        assert _teams_by_id(lst)[team_id]["locked"] is True
        # 解鎖 → team.unlocked
        t.send_json({"type": "room_update", "roomCode": code, "settings": {"locked": False}})
        t.room_list(lambda lst: _rooms_by_code(lst)[code]["locked"] is False)
        assert len(asyncio.run(_audit("team.unlocked", team_id))) == 1
        assert asyncio.run(_team_row(team_id)).locked is False

        # ----- 另一位老師：看不到此班級、不能開 / 改 / 關 / 封存 -----
        with db_client.websocket_connect(f"/teacher?ticket={token_b}") as ws_b:
            tb = TeacherWS(ws_b)
            lst_b = _fresh_room_list(tb)
            assert team_id not in _teams_by_id(lst_b)
            # 房間列表是全域的（B 看得到 A 開著的房），但管理被忽略
            assert code in _rooms_by_code(lst_b)
            tb.send_json(
                {"type": "room_update", "roomCode": code, "settings": {"name": "被改了"}}
            )
            tb.send_json({"type": "room_close", "roomCode": code})
            tb.send_json({"type": "room_archive_team", "teamId": team_id})
            lst_b = _fresh_room_list(tb)
            assert _rooms_by_code(lst_b)[code]["name"] == "三年三班"
            assert asyncio.run(_team_row(team_id)).archived_at is None
            # A 關房後 B 也開不回來
            t.send_json({"type": "room_close", "roomCode": code})
            t.room_list(lambda lst: code not in _rooms_by_code(lst))
            tb.send_json({"type": "room_open_team", "teamId": team_id})
            lst_b = _fresh_room_list(tb)
            assert code not in _rooms_by_code(lst_b) and lst_b["selected"] == "MAIN"

        # ----- A 重開 → room_archive_team → 列表消失、房關閉、DB archived_at 非空 -----
        _open_team(t, team_id, code)
        t.send_json({"type": "room_archive_team", "teamId": team_id})
        lst = t.room_list(lambda lst: team_id not in _teams_by_id(lst))
        assert code not in _rooms_by_code(lst) and lst["selected"] == "MAIN"
        team = asyncio.run(_team_row(team_id))
        assert team.archived_at is not None
        assert len(asyncio.run(_audit("team.archived", team_id))) == 1
        # 封存後開不回來
        t.send_json({"type": "room_open_team", "teamId": team_id})
        lst = _fresh_room_list(t)
        assert code not in _rooms_by_code(lst) and team_id not in _teams_by_id(lst)


@needs_db
def test_學生用班級碼與密碼進房_雜湊驗證_錯密碼拒絕(db_client: TestClient) -> None:
    token = _register(db_client, _email("teamPw"))["ticket"]
    with db_client.websocket_connect(f"/teacher?ticket={token}") as ws:
        t = TeacherWS(ws)
        code = t.create_room({"name": "密碼班", "password": "s3cret"})
        team_id = _rooms_by_code(t.room_list(lambda lst: code in _rooms_by_code(lst)))[code][
            "teamId"
        ]
        # 記憶體裡只有雜湊，沒有明文
        room = db_client.app.state.rooms.get(code)
        assert room.team_id == team_id and room.settings.password == ""
        assert room.settings.password_hash and room.settings.password_hash.startswith("$argon2")
        with _join(db_client, code, "小明", password="wrong") as (s1, resp):
            assert resp == {"type": "room_rejected", "reason": "bad_password"}
            s1.send_json(
                {"type": "register", "name": "小明", "emoji": "🐱", "roomPassword": "s3cret"}
            )
            joined = s1.receive_json()
            assert joined["type"] == "room_joined"
            assert joined["room"]["code"] == code and joined["room"]["teamId"] == team_id
        # 沒帶密碼也拒
        with _join(db_client, code, "小華") as (_, resp2):
            assert resp2 == {"type": "room_rejected", "reason": "bad_password"}
        # 關房再重開（設定從 DB 載回）→ 同一組密碼仍有效
        t.send_json({"type": "room_close", "roomCode": code})
        t.room_list(lambda lst: code not in _rooms_by_code(lst))
        _open_team(t, team_id, code)
        with _join(db_client, code, "小美", password="s3cret") as (_, resp3):
            assert resp3["type"] == "room_joined", resp3


@needs_db
def test_閒置自動關房_只卸載記憶體_班級保留(db_client: TestClient) -> None:
    token = _register(db_client, _email("teamIdle"))["ticket"]
    rooms = db_client.app.state.rooms
    clock = FakeClock()
    rooms.now_ms = clock
    idle_ms = db_client.app.state.settings.room_idle_close_sec * 1000
    with db_client.websocket_connect(f"/teacher?ticket={token}") as ws:
        t = TeacherWS(ws)
        code = t.create_room({"name": "閒置班"})
        team_id = _rooms_by_code(t.room_list(lambda lst: code in _rooms_by_code(lst)))[code][
            "teamId"
        ]
        db_client.portal.call(rooms.tick)  # 0 人 → 開始計閒置
        clock.advance(idle_ms)
        db_client.portal.call(rooms.tick)
        settle(db_client)
        assert rooms.get(code) is None
        lst = t.room_list(lambda lst: code not in _rooms_by_code(lst))
        assert _teams_by_id(lst)[team_id]["open"] is False
        assert asyncio.run(_team_row(team_id)).archived_at is None
        # 點開即回來
        assert _rooms_by_code(_open_team(t, team_id, code))[code]["teamId"] == team_id
