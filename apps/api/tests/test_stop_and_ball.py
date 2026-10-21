"""停止 / 智能停止測試。

- arena_stop / soccer_stop：倒數中或進行中皆可停，end 廣播 reason:'teacher_stop' 後回 idle
- 智能停止：老師在賽局中 broadcast load_level / race_start / reset_all →
  先收到 end（reason:'level_switch'）再收到關卡廣播（順序保證）
- 舊客戶端送 mode=ball：拒絕開賽，連線與後續 striker 開賽都還在

tick 相關流程全部用假時鐘（conftest.clock）＋ 手動 tick（conftest.tick），不 sleep。
"""

from fastapi.testclient import TestClient

from tests.conftest import FakeClock, recv_until, settle, teacher_connect, tick


def _register(ws, t, name: str) -> None:
    """學生註冊並消化老師端對應的名冊訊息。"""
    ws.receive_json()  # welcome
    recv_until(t, "student_list")
    ws.send_json({"type": "register", "name": name, "emoji": "🐱"})
    recv_until(t, "student_list")


def _join(ws, game: str) -> dict:
    """加入賽局並回傳收到的 *_state 快照。"""
    ws.send_json({"type": f"{game}_join"})
    return recv_until(ws, f"{game}_state")


def _countdown_to_go(client: TestClient, clock: FakeClock, ws, game: str) -> dict:
    """吃完 3-2-1 倒數（推進假時鐘＋手動 tick），回傳 *_go。"""
    assert recv_until(ws, f"{game}_countdown")["n"] == 3
    for _ in range(3):
        clock.advance(1000)
        tick(client)
    return recv_until(ws, f"{game}_go")


def _types_until(ws, msg_type: str) -> list[str]:
    """收訊息直到指定 type（含），回傳沿途的 type 序列（智能停止的順序斷言用）。"""
    seen: list[str] = []
    for _ in range(200):
        seen.append(ws.receive_json()["type"])
        if seen[-1] == msg_type:
            return seen
    raise AssertionError(f"200 則內沒收到 {msg_type}")


# ---------- 手動停止（arena_stop / soccer_stop）----------


def test_arena_stop_倒數中(client: TestClient, teacher_ticket: str, clock: FakeClock) -> None:
    """倒數中 arena_stop → arena_end reason:'teacher_stop'、回 idle、不會 GO。"""
    arena = client.app.state.arena
    with teacher_connect(client, teacher_ticket) as t:
        recv_until(t, "student_list")
        with client.websocket_connect("/") as s:
            _register(s, t, "小明")
            _join(s, "arena")
            t.send_json({"type": "arena_start", "durationSec": 40, "mode": "balloon"})
            assert recv_until(s, "arena_countdown")["n"] == 3

            t.send_json({"type": "arena_stop"})
            end = recv_until(s, "arena_end")
            assert end["reason"] == "teacher_stop"
            assert end["winner"] == "time"
            assert recv_until(t, "arena_end")["reason"] == "teacher_stop"  # 老師端也收到
            settle(client)
            assert arena.status == "idle"
            clock.advance(5000)
            tick(client)
            assert arena.status == "idle"  # 沒有 GO


def test_arena_stop_進行中含排行(
    client: TestClient, teacher_ticket: str, clock: FakeClock
) -> None:
    """進行中 arena_stop → arena_end 含當下排行、回 idle。"""
    arena = client.app.state.arena
    with teacher_connect(client, teacher_ticket) as t:
        recv_until(t, "student_list")
        with client.websocket_connect("/") as s:
            _register(s, t, "小明")
            _join(s, "arena")
            t.send_json({"type": "arena_start", "durationSec": 40, "mode": "balloon"})
            _countdown_to_go(client, clock, s, "arena")
            arena.players["g:小明"].score = 3  # 當下戰績

            t.send_json({"type": "arena_stop"})
            end = recv_until(s, "arena_end")
            assert end["reason"] == "teacher_stop"
            assert end["ranking"][0]["name"] == "小明"
            assert end["ranking"][0]["score"] == 3
            settle(client)
            assert arena.status == "idle"


def test_soccer_stop_倒數中(client: TestClient, teacher_ticket: str, clock: FakeClock) -> None:
    """倒數中 soccer_stop → soccer_end reason:'teacher_stop'（0:0 → draw）、回 idle。"""
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

            t.send_json({"type": "soccer_stop"})
            end = recv_until(s1, "soccer_end")
            assert end["reason"] == "teacher_stop"
            assert end["winner"] == "draw"
            settle(client)  # 等 handler 收尾（end 廣播後才回 idle）
            assert soccer.status == "idle"
            clock.advance(5000)
            tick(client)
            assert soccer.status == "idle"  # 沒有 GO


def test_soccer_stop_進行中依當下比分判勝(
    client: TestClient, teacher_ticket: str, clock: FakeClock
) -> None:
    """進行中 soccer_stop → winner 依當下比分（紅領先 → red）。"""
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
            soccer.scores["red"] = 2  # 當下比分

            t.send_json({"type": "soccer_stop"})
            end = recv_until(s1, "soccer_end")
            assert end["reason"] == "teacher_stop"
            assert end["winner"] == "red"
            assert end["scores"] == {"blue": 0, "red": 2}
            settle(client)
            assert soccer.status == "idle"


# ---------- 智能停止（老師在賽局中切關）----------


def test_智能停止_load_level_先end再轉發(
    client: TestClient, teacher_ticket: str, clock: FakeClock
) -> None:
    """arena 進行中收 load_level → 學生先收到 arena_end(level_switch) 再收到 load_level。"""
    arena = client.app.state.arena
    with teacher_connect(client, teacher_ticket) as t:
        recv_until(t, "student_list")
        with client.websocket_connect("/") as s:
            _register(s, t, "小明")
            _join(s, "arena")
            t.send_json({"type": "arena_start", "durationSec": 40, "mode": "balloon"})
            _countdown_to_go(client, clock, s, "arena")

            t.send_json(
                {"type": "broadcast", "payload": {"type": "load_level", "levelId": "1-2"}}
            )
            seen = _types_until(s, "load_level")
            assert "arena_end" in seen
            assert seen.index("arena_end") < seen.index("load_level")
            assert recv_until(t, "arena_end")["reason"] == "level_switch"
            settle(client)
            assert arena.status == "idle"


def test_智能停止_race_start_足球倒數中(
    client: TestClient, teacher_ticket: str, clock: FakeClock
) -> None:
    """soccer 倒數中收 race_start → 先 soccer_end(level_switch) 再 race_start。"""
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
                {"type": "broadcast", "payload": {"type": "race_start", "levelId": "1-3"}}
            )
            seen = _types_until(s1, "race_start")
            assert "soccer_end" in seen
            assert seen.index("soccer_end") < seen.index("race_start")
            settle(client)
            assert soccer.status == "idle"
            clock.advance(5000)
            tick(client)
            assert soccer.status == "idle"  # 倒數已取消，沒有 GO


def test_智能停止_reset_all(client: TestClient, teacher_ticket: str, clock: FakeClock) -> None:
    """arena 進行中收 reset_all → 先 arena_end(level_switch) 再 reset_all。"""
    with teacher_connect(client, teacher_ticket) as t:
        recv_until(t, "student_list")
        with client.websocket_connect("/") as s:
            _register(s, t, "小明")
            _join(s, "arena")
            t.send_json({"type": "arena_start", "durationSec": 40, "mode": "balloon"})
            _countdown_to_go(client, clock, s, "arena")

            t.send_json({"type": "broadcast", "payload": {"type": "reset_all"}})
            seen = _types_until(s, "reset_all")
            assert "arena_end" in seen
            assert seen.index("arena_end") < seen.index("reset_all")


def test_智能停止_賽局idle時不發end(client: TestClient, teacher_ticket: str) -> None:
    """兩個賽局都 idle 時切關 → 不多發 end，學生直接收到 load_level。"""
    with teacher_connect(client, teacher_ticket) as t:
        recv_until(t, "student_list")
        with client.websocket_connect("/") as s:
            _register(s, t, "小明")
            t.send_json(
                {"type": "broadcast", "payload": {"type": "load_level", "levelId": "1-1"}}
            )
            seen = _types_until(s, "load_level")
            assert "arena_end" not in seen
            assert "soccer_end" not in seen


def test_舊客戶端送ball模式被拒絕且不崩潰(
    client: TestClient, teacher_ticket: str, clock: FakeClock
) -> None:
    """mode=ball 不開賽、狀態維持 idle、連線還在；接著仍可開前鋒穿門。"""
    soccer = client.app.state.soccer
    with teacher_connect(client, teacher_ticket) as t:
        recv_until(t, "student_list")
        with client.websocket_connect("/") as s1:
            _register(s1, t, "小明")
            _join(s1, "soccer")
            t.send_json({"type": "soccer_start", "durationSec": 60, "mode": "ball"})
            settle(client)
            assert soccer.status == "idle"
            assert soccer.mode == "striker"

            t.send_json({"type": "soccer_start", "durationSec": 30, "mode": "striker"})
            go = _countdown_to_go(client, clock, s1, "soccer")
            assert go["mode"] == "striker"
            assert "ball" not in go
            assert soccer.status == "running"
