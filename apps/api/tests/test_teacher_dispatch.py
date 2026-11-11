"""教師派送：同房等待名單只在記憶體。不寫資料庫。"""

from fastapi.testclient import TestClient

from app.teacher_dispatch import ARENA_CAP, SOCCER_CAP, TeacherDispatch
from tests.conftest import FakeClock, recv_until, settle, teacher_connect, tick


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


def test_足球派送立刻進場_開始只倒數_賽後回原關(
    client: TestClient, teacher_ticket: str
) -> None:
    with teacher_connect(client, teacher_ticket) as t:
        recv_until(t, "student_list")
        with client.websocket_connect("/") as s:
            sid = _register(s, t, "小明")
            s.send_json({"type": "progress", "levelId": "1-2"})
            recv_until(t, "student_update")
            t.send_json({"type": "dispatch_add", "activity": "soccer", "studentIds": [sid]})
            # 一派送伺服器就把他加進球場、分好隊，學生端跟著切畫面
            seen = _between(s, "dispatch_go")
            assert seen[-1] == {"type": "dispatch_go", "activity": "soccer"}
            assert "dispatch_hold" not in [m["type"] for m in seen]
            player = next(
                p for p in client.app.state.soccer.players.values() if p.record.id == sid
            )
            assert player.active and player.team in ("blue", "red")
            gate = recv_until(s, "dispatch_gate")
            assert gate == {"type": "dispatch_gate", "locked": True}
            state = recv_until(t, "dispatch_state")
            assert state["phase"] == "waiting"
            assert state["cap"] == 6
            assert state["waiting"] == [{"id": sid, "name": "小明", "emoji": "🐱"}]

            # 學生端進場後送的 soccer_join 不能被名單擋掉
            s.send_json({"type": "soccer_join"})
            s.send_json({"type": "ping", "t": 1})
            kinds = [m["type"] for m in _between(s, "pong")]
            assert "soccer_state" in kinds
            assert "dispatch_join_rejected" not in kinds

            # 開始：人已經在場上，不再送一次 dispatch_go，直接倒數
            t.send_json({"type": "soccer_start", "durationSec": 30})
            kinds = [m["type"] for m in _between(s, "soccer_countdown")]
            assert "dispatch_go" not in kinds
            assert recv_until(t, "dispatch_state")["phase"] == "live"
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
            assert "dispatch_go" not in kinds
            # 進場的 6 人自動平均成 3v3
            teams = [p.team for p in client.app.state.soccer.players.values() if p.active]
            assert sorted(teams) == ["blue", "blue", "blue", "red", "red", "red"]


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
            a.send_json({"type": "progress", "levelId": "2-1"})
            recv_until(t, "student_update")
            t.send_json(
                {"type": "dispatch_add", "activity": "soccer", "studentIds": [id_a, id_b]}
            )
            recv_until(a, "dispatch_go")
            recv_until(b, "dispatch_go")
            recv_until(t, "dispatch_state")
            t.send_json(
                {"type": "dispatch_cancel", "activity": "soccer", "studentIds": [id_a]}
            )
            # 被取消的人已經在球場上：退出球場、送回派送前那一關
            assert recv_until(a, "load_level") == {"type": "load_level", "levelId": "2-1"}
            assert recv_until(a, "dispatch_release")["type"] == "dispatch_release"
            state = recv_until(t, "dispatch_state")
            assert [row["id"] for row in state["waiting"]] == [id_b]
            soccer = client.app.state.soccer
            active = {p.record.id for p in soccer.players.values() if p.active}
            assert active == {id_b}


def test_老師離開時大亂鬥等待中的學生被放開(
    client: TestClient, teacher_ticket: str
) -> None:
    with client.websocket_connect("/") as s:
        with teacher_connect(client, teacher_ticket) as t:
            recv_until(t, "student_list")
            sid = _register(s, t, "小明")
            t.send_json({"type": "dispatch_add", "activity": "arena", "studentIds": [sid]})
            recv_until(s, "dispatch_hold")
        settle(client)
        assert recv_until(s, "dispatch_release")["type"] == "dispatch_release"
        assert recv_until(s, "dispatch_gate") == {"type": "dispatch_gate", "locked": False}


def test_老師重新整理_足球名單留著_人還在球場上(
    client: TestClient, teacher_ticket: str
) -> None:
    with client.websocket_connect("/") as s:
        with teacher_connect(client, teacher_ticket) as t:
            recv_until(t, "student_list")
            sid = _register(s, t, "小明")
            t.send_json({"type": "dispatch_add", "activity": "soccer", "studentIds": [sid]})
            recv_until(s, "dispatch_go")
        settle(client)
        with teacher_connect(client, teacher_ticket) as t2:
            recv_until(t2, "student_list")
            t2.send_json({"type": "soccer_state_req"})
            state = recv_until(t2, "soccer_state")
            assert [p["id"] for p in state["players"]] == [sid]
        s.send_json({"type": "ping", "t": 1})
        kinds = [m["type"] for m in _between(s, "pong")]
        assert "dispatch_release" not in kinds
        assert "load_level" not in kinds


def test_足球等待中老師切到一般關卡_名單清掉跟新關卡走(
    client: TestClient, teacher_ticket: str
) -> None:
    with teacher_connect(client, teacher_ticket) as t:
        recv_until(t, "student_list")
        with client.websocket_connect("/") as s:
            sid = _register(s, t, "小明")
            t.send_json({"type": "dispatch_add", "activity": "soccer", "studentIds": [sid]})
            recv_until(s, "dispatch_go")
            recv_until(t, "dispatch_state")
            t.send_json({"type": "broadcast", "payload": {"type": "load_level", "levelId": "1-3"}})
            assert recv_until(s, "dispatch_release")["type"] == "dispatch_release"
            assert recv_until(s, "load_level")["levelId"] == "1-3"
            state = recv_until(t, "dispatch_state")
            assert state["phase"] == "idle" and state["waiting"] == []
            assert not any(p.active for p in client.app.state.soccer.players.values())


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


def _arena_time_up(client: TestClient, t, s, sid: str, clock: FakeClock) -> None:  # noqa: ANN001
    """派送一人進大亂鬥、開賽、跑到時間到。"""
    t.send_json({"type": "dispatch_add", "activity": "arena", "studentIds": [sid]})
    recv_until(s, "dispatch_hold")
    t.send_json({"type": "arena_start", "durationSec": 30, "mode": "balloon"})
    recv_until(s, "dispatch_go")
    for _ in range(3):
        clock.advance(1000)
        tick(client)
    recv_until(s, "arena_go")
    clock.advance(31_000)
    tick(client)
    assert recv_until(s, "arena_end")["reason"] == "time_up"


def _kinds_until_pong(s) -> list[str]:  # noqa: ANN001
    s.send_json({"type": "ping", "t": 1})
    return [m["type"] for m in _between(s, "pong")]


def test_大亂鬥時間到_派送的學生留在結算畫面不被送走(
    client: TestClient, teacher_ticket: str, clock: FakeClock
) -> None:
    with teacher_connect(client, teacher_ticket) as t:
        recv_until(t, "student_list")
        with client.websocket_connect("/") as s:
            sid = _register(s, t, "小明")
            s.send_json({"type": "progress", "levelId": "1-2"})
            recv_until(t, "student_update")
            _arena_time_up(client, t, s, sid, clock)
            settle(client)
            kinds = _kinds_until_pong(s)
            assert "load_level" not in kinds
            assert "dispatch_release" not in kinds
            arena = client.app.state.arena
            assert arena.holding_results()
            assert any(p.record.id == sid and p.active for p in arena.players.values())


def test_大亂鬥結算中再來一輪_派送的學生還在場上(
    client: TestClient, teacher_ticket: str, clock: FakeClock
) -> None:
    with teacher_connect(client, teacher_ticket) as t:
        recv_until(t, "student_list")
        with client.websocket_connect("/") as s:
            sid = _register(s, t, "小明")
            _arena_time_up(client, t, s, sid, clock)
            t.send_json({"type": "arena_start", "durationSec": 30, "mode": "balloon"})
            assert recv_until(s, "arena_countdown")["n"] == 3
            arena = client.app.state.arena
            assert any(p.record.id == sid and p.active for p in arena.players.values())


def test_大亂鬥結算中老師切關_派送的學生跟新關卡走(
    client: TestClient, teacher_ticket: str, clock: FakeClock
) -> None:
    with teacher_connect(client, teacher_ticket) as t:
        recv_until(t, "student_list")
        with client.websocket_connect("/") as s:
            sid = _register(s, t, "小明")
            s.send_json({"type": "progress", "levelId": "1-2"})
            recv_until(t, "student_update")
            _arena_time_up(client, t, s, sid, clock)
            t.send_json({"type": "broadcast", "payload": {"type": "load_level", "levelId": "2-3"}})
            seen = _between(s, "load_level")
            # 切關＝跟著新關卡走：不另送原關卡，看板／活動鈕在轉發新關卡前就解鎖
            assert [m["levelId"] for m in seen if m["type"] == "load_level"] == ["2-3"]
            assert {"type": "dispatch_gate", "locked": False} in seen
            assert not client.app.state.arena.holding_results()


def test_大亂鬥結算中老師重置_派送的學生送回原關卡(
    client: TestClient, teacher_ticket: str, clock: FakeClock
) -> None:
    with teacher_connect(client, teacher_ticket) as t:
        recv_until(t, "student_list")
        with client.websocket_connect("/") as s:
            sid = _register(s, t, "小明")
            s.send_json({"type": "progress", "levelId": "1-2"})
            recv_until(t, "student_update")
            _arena_time_up(client, t, s, sid, clock)
            t.send_json({"type": "broadcast", "payload": {"type": "reset_all"}})
            assert recv_until(s, "load_level") == {"type": "load_level", "levelId": "1-2"}
            assert recv_until(s, "dispatch_release")["type"] == "dispatch_release"
