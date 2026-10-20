"""大亂鬥時間到：結算停留、凍結位置、名次、老師再來一輪或切關才解凍。

含遲到加入與斷線重連。不碰足球。
"""

from fastapi.testclient import TestClient

from app.games.arena import ArenaRanking
from tests.conftest import FakeClock, recv_until, settle, teacher_connect, tick
from tests.test_arena import _countdown_to_go, _gkey, _join_arena, _register


def _to_time_up(client: TestClient, clock: FakeClock, student, teacher) -> dict:
    """把進行中的比賽快轉到時間到，回傳學生收到的 arena_end。"""
    clock.advance(120_000)
    tick(client)
    end = recv_until(student, "arena_end")
    assert recv_until(teacher, "arena_end")["reason"] == "time_up"
    return end


def test_時間到凍結且不自動重開(client: TestClient, teacher_ticket: str, clock: FakeClock) -> None:
    """搶氣球、格線：時間到停在 ended，位置回報丟掉，再 tick 也不會自己開下一場。"""
    arena = client.app.state.arena
    with teacher_connect(client, teacher_ticket) as t:
        recv_until(t, "student_list")
        with client.websocket_connect("/") as s:
            _register(s, t, "小明")
            _join_arena(s)
            t.send_json(
                {
                    "type": "arena_start",
                    "durationSec": 30,
                    "mode": "balloon",
                    "field": "grid",
                }
            )
            _countdown_to_go(client, clock, s)
            s.send_json({"type": "arena_pos", "x": 4, "y": 2, "z": -3, "yaw": 0.2})
            settle(client)
            assert arena.players[_gkey("小明")].x == 4

            end = _to_time_up(client, clock, s, t)
            assert end["reason"] == "time_up"
            assert end["winner"] == "time"
            assert arena.holding_results() is True
            assert arena.status == "ended"

            s.send_json({"type": "arena_pos", "x": 18, "y": 9, "z": 18, "yaw": 1})
            s.send_json({"type": "arena_pop", "id": 0})
            settle(client)
            assert arena.players[_gkey("小明")].x == 4
            assert arena.players[_gkey("小明")].z == -3
            assert arena.players[_gkey("小明")].score == 0

            tick(client)
            assert arena.status == "ended"
            assert arena.holding_results() is True

            t.send_json({"type": "arena_state_req"})
            snap = recv_until(t, "arena_state")
            assert snap["status"] == "ended"
            assert snap["field"] == "grid"
            assert snap["result"]["reason"] == "time_up"
            assert snap["result"]["ranking"][0]["name"] == "小明"


def test_鬼抓人遊樂場同分名次(client: TestClient, teacher_ticket: str, clock: FakeClock) -> None:
    """鬼抓人、遊樂場：名次走 ArenaRanking（抓捕數、被抓次數、代號）。"""
    arena = client.app.state.arena
    with teacher_connect(client, teacher_ticket) as t:
        recv_until(t, "student_list")
        with client.websocket_connect("/") as s1, client.websocket_connect("/") as s2:
            _register(s1, t, "小明")
            _register(s2, t, "小華")
            _join_arena(s1)
            _join_arena(s2)
            t.send_json(
                {
                    "type": "arena_start",
                    "durationSec": 30,
                    "mode": "tag",
                    "field": "playground",
                    "ghostCount": 1,
                }
            )
            _countdown_to_go(client, clock, s1)
            ming = arena.players[_gkey("小明")]
            hua = arena.players[_gkey("小華")]
            ming.score = 0
            ming.caught_count = 4
            ming.role = "runner"
            hua.score = 0
            hua.caught_count = 1
            hua.role = "runner"

            end = _to_time_up(client, clock, s1, t)
            assert end["mode"] == "tag"
            assert [row["name"] for row in end["ranking"]] == ["小華", "小明"]
            expect = ArenaRanking.rank(end["ranking"])
            assert [row["id"] for row in end["ranking"]] == [row["id"] for row in expect]

            t.send_json({"type": "arena_state_req"})
            snap = recv_until(t, "arena_state")
            assert snap["field"] == "playground"
            assert snap["result"]["ranking"][0]["name"] == "小華"


def test_遲到加入與重連仍凍結(client: TestClient, teacher_ticket: str, clock: FakeClock) -> None:
    """結算中才進場、以及斷線重連，都拿到結算，位置回報仍然無效。"""
    arena = client.app.state.arena
    with teacher_connect(client, teacher_ticket) as t:
        recv_until(t, "student_list")
        with client.websocket_connect("/") as s:
            _register(s, t, "小明")
            _join_arena(s)
            t.send_json({"type": "arena_start", "durationSec": 30, "mode": "balloon"})
            _countdown_to_go(client, clock, s)
            s.send_json({"type": "arena_pos", "x": 6, "y": 1, "z": 2, "yaw": 0})
            settle(client)
            held_x = arena.players[_gkey("小明")].x
            _to_time_up(client, clock, s, t)

            with client.websocket_connect("/") as late:
                _register(late, t, "小華")
                snap = _join_arena(late)
                assert snap["status"] == "ended"
                assert snap["result"]["reason"] == "time_up"
                assert {row["name"] for row in snap["result"]["ranking"]} >= {"小明", "小華"}
                late.send_json({"type": "arena_pos", "x": 10, "y": 3, "z": 10, "yaw": 0})
                settle(client)
                assert arena.players[_gkey("小華")].x == 0

        settle(client)
        assert arena.players[_gkey("小明")].disconnected is True
        with client.websocket_connect("/") as again:
            _register(again, t, "小明")
            snap = _join_arena(again)
            assert snap["result"]["winner"] == "time"
            resume = recv_until(again, "arena_resume")
            assert resume["x"] == held_x
            again.send_json({"type": "arena_pos", "x": 15, "y": 4, "z": -8, "yaw": 1})
            settle(client)
            assert arena.players[_gkey("小明")].x == held_x


def test_老師再來一輪或切關會解凍(
    client: TestClient, teacher_ticket: str, clock: FakeClock
) -> None:
    """再來一輪進入倒數並接受位置；切關先收回結算再轉發 load_level。"""
    arena = client.app.state.arena
    with teacher_connect(client, teacher_ticket) as t:
        recv_until(t, "student_list")
        with client.websocket_connect("/") as s:
            _register(s, t, "小明")
            _join_arena(s)
            t.send_json(
                {"type": "arena_start", "durationSec": 30, "mode": "balloon", "field": "grid"}
            )
            _countdown_to_go(client, clock, s)
            _to_time_up(client, clock, s, t)

            t.send_json(
                {
                    "type": "arena_start",
                    "durationSec": 30,
                    "mode": "tag",
                    "field": "playground",
                }
            )
            snap = recv_until(s, "arena_state")
            assert snap["status"] == "countdown"
            assert "result" not in snap
            assert arena.holding_results() is False
            s.send_json({"type": "arena_pos", "x": 3, "y": 1, "z": 3, "yaw": 0})
            settle(client)
            assert arena.players[_gkey("小明")].x == 3

            # 回到結算，再測切關
            _countdown_to_go(client, clock, s)
            _to_time_up(client, clock, s, t)
            t.send_json({"type": "broadcast", "payload": {"type": "load_level", "levelId": "1-2"}})
            released = recv_until(s, "arena_state")
            assert released["status"] == "idle"
            assert "result" not in released
            assert recv_until(s, "load_level") == {"type": "load_level", "levelId": "1-2"}
            assert arena.holding_results() is False
            s.send_json({"type": "arena_pos", "x": 8, "y": 2, "z": 1, "yaw": 0})
            settle(client)
            assert arena.players[_gkey("小明")].x == 8
