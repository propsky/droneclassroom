"""一班多房（分房）測試 — 開分房 / 學生移房 / 整班廣播 / 關分房移回主房 / 重啟還原 / 權限。

需要真實 PostgreSQL（DATABASE_URL），沒設就 skip（分房只屬於持久化班級房；
記憶體房要多房直接多開即可，行為由 test_rooms.py 覆蓋）。
"""

import asyncio

from fastapi.testclient import TestClient

from tests.conftest import recv_until, settle
from tests.test_accounts import _email, _register, needs_db
from tests.test_rooms import Teacher as TeacherWS
from tests.test_rooms import _join, _rooms_by_code
from tests.test_teams import _open_team, _team_row, _teams_by_id, db_client

__all__ = ["db_client"]  # re-export fixture（pytest 由此解析）


def _first_student_id(t: TeacherWS) -> str:
    """讀 student_list 直到名冊非空（select 會先推一份空名冊）。"""
    for _ in range(20):
        lst = recv_until(t.ws, "student_list")
        if lst["students"]:
            return lst["students"][0]["id"]
    raise AssertionError("student_list 一直是空的")


def _create_sub(t: TeacherWS, team_id: int, name: str = "") -> str:
    """開分房，等到 room_list.selected 變成新分房碼（建完伺服器自動切過去）。"""
    t.send_json({"type": "room_create_sub", "teamId": team_id, "name": name})
    lst = t.room_list(
        lambda lst: any(
            r.get("teamId") == team_id and r.get("isMain") is False
            and r["code"] == lst["selected"]
            for r in lst["rooms"]
        )
    )
    t.selected = lst["selected"]
    return t.selected


@needs_db
def test_開分房_獨立碼_繼承班級設定_主房仍在(db_client: TestClient) -> None:
    token = _register(db_client, _email("subA"))["ticket"]
    with db_client.websocket_connect(f"/teacher?ticket={token}") as ws:
        t = TeacherWS(ws)
        main = t.create_room({"name": "三年二班", "maxStudents": 7})
        team_id = _rooms_by_code(t.room_list(lambda lst: main in _rooms_by_code(lst)))[main][
            "teamId"
        ]
        sub = _create_sub(t, team_id, "A 組")
        assert sub != main and len(sub) == 4
        rooms = _rooms_by_code(t.room_list(lambda lst: sub in _rooms_by_code(lst)))
        assert rooms[main]["isMain"] is True and rooms[main]["teamId"] == team_id
        assert rooms[sub]["isMain"] is False and rooms[sub]["teamId"] == team_id
        assert rooms[sub]["name"] == "A 組" and rooms[sub]["maxStudents"] == 7
        # 學生可直接用分房碼進（無密碼班級）
        with _join(db_client, sub, "小明") as (_s, resp):
            assert resp["type"] == "room_joined" and resp["room"]["code"] == sub


@needs_db
def test_移動學生_收到room_joined_關分房移回主房不斷線(db_client: TestClient) -> None:
    token = _register(db_client, _email("subB"))["ticket"]
    with db_client.websocket_connect(f"/teacher?ticket={token}") as ws:
        t = TeacherWS(ws)
        main = t.create_room({"name": "三年二班"})
        team_id = _rooms_by_code(t.room_list(lambda lst: main in _rooms_by_code(lst)))[main][
            "teamId"
        ]
        sub = _create_sub(t, team_id, "A 組")
        t.select(main)  # 開分房後作用房在分房 → 切回主房才看得到主房名冊
        with _join(db_client, main, "小明") as (s, resp):
            assert resp["room"]["code"] == main
            sid = _first_student_id(t)
            # 移到分房（來源 = 主房，明確帶 roomCode）→ 學生收到分房的 room_joined
            t.send_json(
                {
                    "type": "room_move_student",
                    "roomCode": main,
                    "studentId": sid,
                    "toRoomCode": sub,
                }
            )
            moved = recv_until(s, "room_joined")
            assert moved["room"]["code"] == sub and moved["room"]["isMain"] is False
            # 關分房 → 學生移回主房（不斷線）
            t.send_json({"type": "room_close", "roomCode": sub})
            back = recv_until(s, "room_joined")
            assert back["room"]["code"] == main
            lst = t.room_list(lambda lst: sub not in _rooms_by_code(lst))
            assert main in _rooms_by_code(lst)


@needs_db
def test_整班廣播allRooms_分房也收到_單房廣播不外洩(db_client: TestClient) -> None:
    token = _register(db_client, _email("subC"))["ticket"]
    with db_client.websocket_connect(f"/teacher?ticket={token}") as ws:
        t = TeacherWS(ws)
        main = t.create_room({"name": "三年二班"})
        team_id = _rooms_by_code(t.room_list(lambda lst: main in _rooms_by_code(lst)))[main][
            "teamId"
        ]
        sub = _create_sub(t, team_id)
        with _join(db_client, main, "小明") as (s_main, _), _join(db_client, sub, "小華") as (
            s_sub,
            _,
        ):
            # 單房廣播（作用房 = 主房）：只有主房收到
            t.send_json(
                {
                    "type": "broadcast",
                    "roomCode": main,
                    "payload": {"type": "show_message", "text": "只給主房"},
                }
            )
            assert recv_until(s_main, "show_message")["text"] == "只給主房"
            # 整班廣播：主房與分房都收到
            t.send_json(
                {
                    "type": "broadcast",
                    "roomCode": main,
                    "allRooms": True,
                    "payload": {"type": "show_message", "text": "整班都要看"},
                }
            )
            assert recv_until(s_main, "show_message")["text"] == "整班都要看"
            # 分房學生只該收到整班那則（單房那則不外洩）
            assert recv_until(s_sub, "show_message")["text"] == "整班都要看"


@needs_db
def test_分房持久化_關主房重開班級後還原(db_client: TestClient) -> None:
    token = _register(db_client, _email("subD"))["ticket"]
    with db_client.websocket_connect(f"/teacher?ticket={token}") as ws:
        t = TeacherWS(ws)
        main = t.create_room({"name": "三年二班"})
        team_id = _rooms_by_code(t.room_list(lambda lst: main in _rooms_by_code(lst)))[main][
            "teamId"
        ]
        sub = _create_sub(t, team_id, "A 組")
        # Team.settings 已寫入分房配置
        team = asyncio.run(_team_row(team_id))
        assert team is not None
        layout = team.settings.get("rooms")
        assert layout and layout["subs"] == [{"code": sub, "name": "A 組"}]
        # 關主房 → 分房一併卸載
        t.send_json({"type": "room_close", "roomCode": main})
        lst = t.room_list(
            lambda lst: main not in _rooms_by_code(lst) and sub not in _rooms_by_code(lst)
        )
        assert _teams_by_id(lst)[team_id]["open"] is False
        # 重開班級 → 主房與分房（同碼同名）一起回來
        lst = _open_team(t, team_id, main)
        rooms = _rooms_by_code(t.room_list(lambda lst: sub in _rooms_by_code(lst)))
        assert rooms[sub]["isMain"] is False and rooms[sub]["name"] == "A 組"
        assert rooms[sub]["teamId"] == team_id


@needs_db
def test_權限_非擁有者不可開分房或移動學生(db_client: TestClient) -> None:
    token_a = _register(db_client, _email("subE"))["ticket"]
    token_b = _register(db_client, _email("subF"))["ticket"]
    with db_client.websocket_connect(f"/teacher?ticket={token_a}") as ws_a:
        t_a = TeacherWS(ws_a)
        main = t_a.create_room({"name": "A 班"})
        team_id = _rooms_by_code(t_a.room_list(lambda lst: main in _rooms_by_code(lst)))[main][
            "teamId"
        ]
        with db_client.websocket_connect(f"/teacher?ticket={token_b}") as ws_b:
            t_b = TeacherWS(ws_b)
            # B 老師對 A 的班級開分房 → 被拒（房間數不變）
            t_b.send_json({"type": "room_create_sub", "teamId": team_id, "name": "偷開"})
            settle(db_client)
            lst = t_b.room_list()
            assert all(r.get("teamId") != team_id or r["code"] == main for r in lst["rooms"])
            # A 自己開分房後，B 嘗試把 A 房的學生移進去 → 被拒
            sub = _create_sub(t_a, team_id)
            t_a.select(main)  # 開分房後作用房在分房 → 切回主房才看得到主房名冊
            with _join(db_client, main, "小明") as (s, _):
                sid = _first_student_id(t_a)
                t_b.send_json(
                    {
                        "type": "room_move_student",
                        "roomCode": main,
                        "studentId": sid,
                        "toRoomCode": sub,
                    }
                )
                settle(db_client)
                # 學生仍在主房（roster 查詢伺服器狀態）
                room = db_client.app.state.rooms.get(main)
                assert room is not None and any(r.id == sid for r in room.roster.students)
