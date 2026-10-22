"""教師派送：同房等待名單只在記憶體。不寫資料庫。"""

from fastapi.testclient import TestClient

from app.teacher_dispatch import ARENA_CAP, SOCCER_CAP, TeacherDispatch
from tests.conftest import recv_until, settle, teacher_connect


def test_上限常數與前端一致() -> None:
    assert TeacherDispatch.SOCCER_CAP == SOCCER_CAP == 6
    assert TeacherDispatch.ARENA_CAP == ARENA_CAP == 8
    assert TeacherDispatch.cap("soccer") == 6
    assert TeacherDispatch.cap("arena") == 8


def _register(ws, teacher, name: str) -> str:
    welcome = ws.receive_json()
    assert welcome["type"] == "welcome"
    my_id = welcome["id"]
    ws.send_json({"type": "register", "name": name, "emoji": "🐱"})
    for _ in range(30):
        listing = recv_until(teacher, "student_list")
        if any(s["id"] == my_id and s["name"] == name for s in listing["students"]):
            return my_id
    raise AssertionError(f"名冊裡沒有 {name}（{my_id}）")


def _between(ws, stop: str) -> list[dict]:
    seen: list[dict] = []
    for _ in range(40):
        msg = ws.receive_json()
        seen.append(msg)
        if msg["type"] == stop:
            return seen
    raise AssertionError(f"沒等到 {stop}")


def test_派送到等待_開始才進場_賽後回原關(
    client: TestClient, teacher_ticket: str
) -> None:
    with teacher_connect(client, teacher_ticket) as t:
        recv_until(t, "student_list")
        with client.websocket_connect("/") as s:
            sid = _register(s, t, "小明")
            s.send_json({"type": "progress", "levelId": "1-2"})
            recv_until(t, "student_update")
            t.send_json({"type": "dispatch_add", "activity": "soccer", "studentIds": [sid]})
            hold = recv_until(s, "dispatch_hold")
            assert hold == {"type": "dispatch_hold", "activity": "soccer", "title": "足球對戰"}
            gate = recv_until(s, "dispatch_gate")
            assert gate == {"type": "dispatch_gate", "locked": True}
            state = recv_until(t, "dispatch_state")
            assert state["phase"] == "waiting"
            assert state["cap"] == 6
            assert state["waiting"] == [{"id": sid, "name": "小明", "emoji": "🐱"}]

            # 還在等待時自己進場要被拒絕
            s.send_json({"type": "soccer_join"})
            s.send_json({"type": "ping", "t": 1})
            kinds = [m["type"] for m in _between(s, "pong")]
            assert "soccer_state" not in kinds

            t.send_json({"type": "soccer_start", "durationSec": 30})
            go = recv_until(s, "dispatch_go")
            assert go["activity"] == "soccer"
            assert any(p.record.id == sid for p in client.app.state.soccer.players.values())
            t.send_json({"type": "soccer_stop"})
            back = recv_until(s, "load_level")
            assert back == {"type": "load_level", "levelId": "1-2"}
            assert recv_until(s, "dispatch_release")["type"] == "dispatch_release"
            assert recv_until(s, "dispatch_gate") == {"type": "dispatch_gate", "locked": False}


def test_超過上限有提示且多出來的人不進名單(
    client: TestClient, teacher_ticket: str
) -> None:
    names = ["甲", "乙", "丙", "丁", "戊", "己", "庚"]
    with teacher_connect(client, teacher_ticket) as t:
        recv_until(t, "student_list")
        with (
            client.websocket_connect("/") as w0,
            client.websocket_connect("/") as w1,
            client.websocket_connect("/") as w2,
            client.websocket_connect("/") as w3,
            client.websocket_connect("/") as w4,
            client.websocket_connect("/") as w5,
            client.websocket_connect("/") as w6,
        ):
            sockets = [w0, w1, w2, w3, w4, w5, w6]
            ids = [_register(ws, t, name) for ws, name in zip(sockets, names, strict=True)]
            t.send_json({"type": "dispatch_add", "activity": "soccer", "studentIds": ids})
            state = recv_until(t, "dispatch_state")
            assert state["cap"] == 6
            assert len(state["waiting"]) == 6
            assert state["notice"] == "足球對戰最多 6 人。未派送：庚。"
            assert "庚" not in {row["name"] for row in state["waiting"]}
            # 第 7 位沒有看板
            sockets[6].send_json({"type": "ping", "t": 1})
            kinds = [m["type"] for m in _between(sockets[6], "pong")]
            assert "dispatch_hold" not in kinds


def test_大亂鬥上限是8且可單人派送(client: TestClient, teacher_ticket: str) -> None:
    with teacher_connect(client, teacher_ticket) as t:
        recv_until(t, "student_list")
        with client.websocket_connect("/") as s:
            sid = _register(s, t, "小華")
            t.send_json({"type": "dispatch_add", "activity": "arena", "studentIds": [sid]})
            assert recv_until(s, "dispatch_hold")["title"] == "大亂鬥"
            state = recv_until(t, "dispatch_state")
            assert state["activity"] == "arena"
            assert state["cap"] == 8
            assert state["phase"] == "waiting"
            t.send_json(
                {
                    "type": "arena_start",
                    "durationSec": 30,
                    "mode": "balloon",
                    "field": "playground",
                }
            )
            go = recv_until(s, "dispatch_go")
            assert go["activity"] == "arena"
            assert go["arenaMode"] == "balloon"
            assert go["arenaField"] == "playground"
            assert recv_until(t, "dispatch_state")["phase"] == "live"
            t.send_json(
                {"type": "dispatch_add", "activity": "arena", "studentIds": [sid]}
            )
            denied = recv_until(t, "dispatch_state")
            assert denied["phase"] == "live"
            assert denied["notice"] == "比賽中不可追加。"


def test_取消一人_其餘留在名單(client: TestClient, teacher_ticket: str) -> None:
    with teacher_connect(client, teacher_ticket) as t:
        recv_until(t, "student_list")
        with client.websocket_connect("/") as a, client.websocket_connect("/") as b:
            id_a = _register(a, t, "小明")
            id_b = _register(b, t, "小華")
            t.send_json(
                {"type": "dispatch_add", "activity": "soccer", "studentIds": [id_a, id_b]}
            )
            recv_until(a, "dispatch_hold")
            recv_until(b, "dispatch_hold")
            recv_until(t, "dispatch_state")
            t.send_json(
                {"type": "dispatch_cancel", "activity": "soccer", "studentIds": [id_a]}
            )
            assert recv_until(a, "dispatch_release")["type"] == "dispatch_release"
            state = recv_until(t, "dispatch_state")
            assert [row["id"] for row in state["waiting"]] == [id_b]


def test_老師離開時等待中的學生被放開(
    client: TestClient, teacher_ticket: str
) -> None:
    with client.websocket_connect("/") as s:
        with teacher_connect(client, teacher_ticket) as t:
            recv_until(t, "student_list")
            sid = _register(s, t, "小明")
            t.send_json({"type": "dispatch_add", "activity": "soccer", "studentIds": [sid]})
            recv_until(s, "dispatch_hold")
        settle(client)
        assert recv_until(s, "dispatch_release")["type"] == "dispatch_release"
        assert recv_until(s, "dispatch_gate") == {"type": "dispatch_gate", "locked": False}


def test_學生斷線重連仍在等待名單且看板上得回來(
    client: TestClient, teacher_ticket: str
) -> None:
    with teacher_connect(client, teacher_ticket) as t:
        recv_until(t, "student_list")
        with client.websocket_connect("/") as first:
            sid = _register(first, t, "小明")
            t.send_json({"type": "dispatch_add", "activity": "arena", "studentIds": [sid]})
            recv_until(first, "dispatch_hold")
            recv_until(t, "dispatch_state")
        with client.websocket_connect("/") as second:
            new_id = _register(second, t, "小明")
            assert new_id != sid
            hold = recv_until(second, "dispatch_hold")
            assert hold["activity"] == "arena"
            state = recv_until(t, "dispatch_state")
            assert state["waiting"][0]["id"] == new_id
            assert state["waiting"][0]["name"] == "小明"
