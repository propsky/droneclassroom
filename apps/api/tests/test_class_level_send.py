"""全班傳送到一般關卡、足球、大亂鬥。

活動目的地不結束「正在進行的那一場」，一般關卡仍先 end 再轉發 load_level。
"""

from fastapi.testclient import TestClient

from app.class_level_send import ClassLevelSend
from tests.conftest import FakeClock, recv_until, settle, teacher_connect, tick


def test_停止規則與前端活動id一致() -> None:
    ids = [item.id for item in ClassLevelSend.activities()]
    assert ids == [
        "activity:soccer-practice",
        "activity:soccer-match",
        "activity:arena:balloon:grid",
        "activity:arena:balloon:playground",
        "activity:arena:tag:grid",
        "activity:arena:tag:playground",
    ]
    assert ClassLevelSend.stops_arena("1-4") is True
    assert ClassLevelSend.stops_soccer("cl-3") is True
    assert ClassLevelSend.stops_soccer("activity:soccer-match") is False
    assert ClassLevelSend.stops_arena(" soccer-match ") is True
    assert ClassLevelSend.stops_arena("activity:arena:tag:playground") is False
    assert ClassLevelSend.stops_soccer("arena:balloon:grid") is True
    assert ClassLevelSend.stops_soccer("activity:soccer-practice") is True


def _register(ws, t, name: str) -> None:
    ws.receive_json()  # welcome
    recv_until(t, "student_list")
    ws.send_json({"type": "register", "name": name, "emoji": "🐱"})
    recv_until(t, "student_list")


def _join(ws, game: str) -> dict:
    ws.send_json({"type": f"{game}_join"})
    return recv_until(ws, f"{game}_state")


def _countdown_to_go(client: TestClient, clock: FakeClock, ws, game: str) -> dict:
    assert recv_until(ws, f"{game}_countdown")["n"] == 3
    for _ in range(3):
        clock.advance(1000)
        tick(client)
    return recv_until(ws, f"{game}_go")


def _until(ws, msg_type: str) -> tuple[list[str], dict]:
    seen: list[str] = []
    last: dict = {}
    for _ in range(200):
        last = ws.receive_json()
        seen.append(last["type"])
        if last["type"] == msg_type:
            return seen, last
    raise AssertionError(f"200 則內沒收到 {msg_type}")


def test_一般關卡在足球進行中仍先結束再轉發(
    client: TestClient, teacher_ticket: str, clock: FakeClock
) -> None:
    soccer = client.app.state.soccer
    with teacher_connect(client, teacher_ticket) as t:
        recv_until(t, "student_list")
        with client.websocket_connect("/") as s1, client.websocket_connect("/") as s2:
            _register(s1, t, "小明")
            _register(s2, t, "小華")
            _join(s1, "soccer")
            _join(s2, "soccer")
            t.send_json({"type": "soccer_start", "durationSec": 40})
            _countdown_to_go(client, clock, s1, "soccer")
            t.send_json(
                {"type": "broadcast", "payload": {"type": "load_level", "levelId": "2-3"}}
            )
            seen, msg = _until(s1, "load_level")
            assert "soccer_end" in seen
            assert seen.index("soccer_end") < seen.index("load_level")
            assert msg["levelId"] == "2-3"
            settle(client)
            assert soccer.status == "idle"


def test_送到足球對戰_進行中不結束_沒進場的人也收到(
    client: TestClient, teacher_ticket: str, clock: FakeClock
) -> None:
    soccer = client.app.state.soccer
    with teacher_connect(client, teacher_ticket) as t:
        recv_until(t, "student_list")
        with client.websocket_connect("/") as s1, client.websocket_connect("/") as s2:
            _register(s1, t, "小明")
            _register(s2, t, "小華")
            _join(s1, "soccer")
            t.send_json({"type": "soccer_start", "durationSec": 40})
            _countdown_to_go(client, clock, s1, "soccer")
            t.send_json(
                {
                    "type": "broadcast",
                    "payload": {"type": "load_level", "levelId": "activity:soccer-match"},
                }
            )
            seen, msg = _until(s1, "load_level")
            assert "soccer_end" not in seen
            assert msg["levelId"] == "activity:soccer-match"
            assert recv_until(s2, "load_level") == {
                "type": "load_level",
                "levelId": "activity:soccer-match",
            }
            settle(client)
            assert soccer.status == "running"


def test_送到大亂鬥_進行中的大亂鬥不結束_足球會結束(
    client: TestClient, teacher_ticket: str, clock: FakeClock
) -> None:
    arena = client.app.state.arena
    with teacher_connect(client, teacher_ticket) as t:
        recv_until(t, "student_list")
        with client.websocket_connect("/") as s:
            _register(s, t, "小明")
            _join(s, "arena")
            t.send_json({"type": "arena_start", "durationSec": 40, "mode": "balloon"})
            _countdown_to_go(client, clock, s, "arena")
            t.send_json(
                {
                    "type": "broadcast",
                    "payload": {
                        "type": "load_level",
                        "levelId": "activity:arena:balloon:playground",
                    },
                }
            )
            seen, msg = _until(s, "load_level")
            assert "arena_end" not in seen
            assert msg["levelId"] == "activity:arena:balloon:playground"
            settle(client)
            assert arena.status == "running"


def test_送到大亂鬥會結束進行中的足球(
    client: TestClient, teacher_ticket: str, clock: FakeClock
) -> None:
    soccer = client.app.state.soccer
    with teacher_connect(client, teacher_ticket) as t:
        recv_until(t, "student_list")
        with client.websocket_connect("/") as s1, client.websocket_connect("/") as s2:
            _register(s1, t, "小華")
            _register(s2, t, "小美")
            _join(s1, "soccer")
            _join(s2, "soccer")
            t.send_json({"type": "soccer_start", "durationSec": 40})
            assert recv_until(s1, "soccer_countdown")["n"] == 3
            t.send_json(
                {
                    "type": "broadcast",
                    "payload": {"type": "load_level", "levelId": "arena:tag:grid"},
                }
            )
            seen, msg = _until(s1, "load_level")
            assert "soccer_end" in seen
            assert seen.index("soccer_end") < seen.index("load_level")
            assert msg["levelId"] == "arena:tag:grid"
            settle(client)
            assert soccer.status == "idle"


def test_無前綴別名與練習會結束足球_遲到學生補送(
    client: TestClient, teacher_ticket: str, clock: FakeClock
) -> None:
    soccer = client.app.state.soccer
    with teacher_connect(client, teacher_ticket) as t:
        recv_until(t, "student_list")
        with client.websocket_connect("/") as s1, client.websocket_connect("/") as s2:
            _register(s1, t, "小明")
            _register(s2, t, "小華")
            _join(s1, "soccer")
            _join(s2, "soccer")
            t.send_json({"type": "soccer_start", "durationSec": 40})
            assert recv_until(s1, "soccer_countdown")["n"] == 3
            t.send_json(
                {
                    "type": "broadcast",
                    "payload": {"type": "race_start", "levelId": "activity:soccer-practice"},
                }
            )
            seen, msg = _until(s1, "race_start")
            assert msg["levelId"] == "activity:soccer-practice"
            assert "soccer_end" in seen
            assert seen.index("soccer_end") < seen.index("race_start")
            settle(client)
            assert soccer.status == "idle"

        t.send_json(
            {
                "type": "broadcast",
                "payload": {"type": "load_level", "levelId": "activity:soccer-practice"},
            }
        )
        with client.websocket_connect("/") as late:
            assert late.receive_json()["type"] == "welcome"
            assert recv_until(late, "load_level") == {
                "type": "load_level",
                "levelId": "activity:soccer-practice",
            }
