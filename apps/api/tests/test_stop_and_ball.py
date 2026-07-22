"""停止 / 智能停止 / 推球模式測試。

- arena_stop / soccer_stop：倒數中或進行中皆可停，end 廣播 reason:'teacher_stop' 後回 idle
- 智能停止：老師在賽局中 broadcast load_level / race_start / reset_all →
  先收到 end（reason:'level_switch'）再收到關卡廣播（順序保證）
- 推球模式（mode:'ball'，缺省）：伺服器模擬共用球 —— 推球位移、牆反彈、
  進球得分 / 烏龍歸對隊 / 球重置、client soccer_goal 上報忽略

tick 相關流程全部用假時鐘（conftest.clock）＋ 手動 tick（conftest.tick），不 sleep。
"""

from fastapi.testclient import TestClient

from app.games.soccer import BALL_RADIUS
from tests.conftest import FakeClock, recv_until, settle, tick


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


def _ball_until_moved(ws) -> dict:
    """收 soccer_ball 直到球離開中場（z≠0），回傳該球狀態。"""
    for _ in range(10):
        ball = recv_until(ws, "soccer_ball")["ball"]
        if ball["z"] != 0:
            return ball
    raise AssertionError("10 則 soccer_ball 內球都沒動")


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
    with client.websocket_connect(f"/teacher?ticket={teacher_ticket}") as t:
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
    with client.websocket_connect(f"/teacher?ticket={teacher_ticket}") as t:
        recv_until(t, "student_list")
        with client.websocket_connect("/") as s:
            _register(s, t, "小明")
            _join(s, "arena")
            t.send_json({"type": "arena_start", "durationSec": 40, "mode": "balloon"})
            _countdown_to_go(client, clock, s, "arena")
            arena.players["s1"].score = 3  # 當下戰績

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
    with client.websocket_connect(f"/teacher?ticket={teacher_ticket}") as t:
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
    with client.websocket_connect(f"/teacher?ticket={teacher_ticket}") as t:
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
            assert soccer.ball is None  # 停止後球收走


# ---------- 智能停止（老師在賽局中切關）----------


def test_智能停止_load_level_先end再轉發(
    client: TestClient, teacher_ticket: str, clock: FakeClock
) -> None:
    """arena 進行中收 load_level → 學生先收到 arena_end(level_switch) 再收到 load_level。"""
    arena = client.app.state.arena
    with client.websocket_connect(f"/teacher?ticket={teacher_ticket}") as t:
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
    with client.websocket_connect(f"/teacher?ticket={teacher_ticket}") as t:
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
    with client.websocket_connect(f"/teacher?ticket={teacher_ticket}") as t:
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
    with client.websocket_connect(f"/teacher?ticket={teacher_ticket}") as t:
        recv_until(t, "student_list")
        with client.websocket_connect("/") as s:
            _register(s, t, "小明")
            t.send_json(
                {"type": "broadcast", "payload": {"type": "load_level", "levelId": "1-1"}}
            )
            seen = _types_until(s, "load_level")
            assert "arena_end" not in seen
            assert "soccer_end" not in seen


# ---------- 推球模式（mode:'ball'，soccer_start 缺省）----------


def _start_ball_game(client: TestClient, teacher_ticket_ws, clock: FakeClock, s1, s2) -> dict:
    """開一場 ball 模式（缺省 mode）並吃完倒數，回傳 soccer_go。"""
    teacher_ticket_ws.send_json({"type": "soccer_start", "durationSec": 60})
    go = _countdown_to_go(client, clock, s1, "soccer")
    return go


def test_ball模式_開賽下發場地與球_推球位移與廣播(
    client: TestClient, teacher_ticket: str, clock: FakeClock
) -> None:
    """soccer_start 未帶 mode → 預設 ball；GO 下發 field/ball；貼近球 → 推球位移 + soccer_ball。"""
    soccer = client.app.state.soccer
    with client.websocket_connect(f"/teacher?ticket={teacher_ticket}") as t:
        recv_until(t, "student_list")
        with client.websocket_connect("/") as s1, client.websocket_connect("/") as s2:
            _register(s1, t, "小明")  # 藍隊
            _register(s2, t, "小華")  # 紅隊
            _join(s1, "soccer")
            _join(s2, "soccer")
            go = _start_ball_game(client, t, clock, s1, s2)
            assert go["mode"] == "ball"
            assert go["ball"] == {"x": 0.0, "y": 4.5, "z": 0.0, "r": BALL_RADIUS}
            assert go["field"]["halfZ"] == 20.0

            # 藍隊員從球後方貼近（距 1.0 < 球 1.2 + 機 0.65）→ 沿法線（+z）推
            s1.send_json({"type": "soccer_pos", "x": 0, "y": 4.5, "z": -1.0, "yaw": 0})
            tick(client)
            assert soccer.ball.z > 0  # 球被往 +z（紅隊門）推
            assert soccer.ball.last_touch is soccer.players["s1"]
            # GO 那個 tick 已廣播過一則球在中場（z=0）的 soccer_ball，收到推球後的那則為止
            ball_msg = _ball_until_moved(s1)
            assert ball_msg["z"] > 0 and ball_msg["r"] == BALL_RADIUS
            assert _ball_until_moved(t)["z"] > 0  # 老師端也收到


def test_ball模式_牆反彈(client: TestClient, teacher_ticket: str, clock: FakeClock) -> None:
    """球衝向側牆 → 位置 clamp 在 halfX - r、法向速度反向 ×0.7。"""
    soccer = client.app.state.soccer
    with client.websocket_connect(f"/teacher?ticket={teacher_ticket}") as t:
        recv_until(t, "student_list")
        with client.websocket_connect("/") as s1, client.websocket_connect("/") as s2:
            _register(s1, t, "小明")
            _register(s2, t, "小華")
            _join(s1, "soccer")
            _join(s2, "soccer")
            _start_ball_game(client, t, clock, s1, s2)

            soccer.ball.x, soccer.ball.vx = -8.5, -10.0  # 直衝 -x 牆
            tick(client)  # x: -8.5 - 0.8 = -9.3 → 超出 -(10 - 1.2) → 反彈
            assert soccer.ball.x == -(10.0 - BALL_RADIUS)
            assert soccer.ball.vx > 0  # 反向且衰減


def test_ball模式_進球烏龍與重置(
    client: TestClient, teacher_ticket: str, clock: FakeClock
) -> None:
    """球心過門面且在門環內 → 攻方得分；守方最後觸球 = 烏龍（own=true 得分仍歸對隊）；
    進球後球重置中場、進球隊 armed=false。"""
    soccer = client.app.state.soccer
    with client.websocket_connect(f"/teacher?ticket={teacher_ticket}") as t:
        recv_until(t, "student_list")
        with client.websocket_connect("/") as s1, client.websocket_connect("/") as s2:
            _register(s1, t, "小明")  # 藍隊
            _register(s2, t, "小華")  # 紅隊
            _join(s1, "soccer")
            _join(s2, "soccer")
            _start_ball_game(client, t, clock, s1, s2)

            # 藍隊員最後觸球、球飛進 +z 門（藍隊攻門）→ 藍得分、非烏龍
            ball = soccer.ball
            ball.last_touch = soccer.players["s1"]
            ball.x, ball.y, ball.z, ball.vz = 0.0, 4.5, 19.5, 10.0
            tick(client)  # z: 19.5 + 0.8 = 20.3 ≥ 20 且在門環內
            ok = recv_until(s1, "soccer_goal_ok")
            assert ok["team"] == "blue" and ok["own"] is False
            assert ok["by"] == "s1" and ok["scores"] == {"blue": 1, "red": 0}
            assert soccer.armed["blue"] is False  # 進球隊退回（過中線恢復）
            # 球重置中場（懸浮高度）、速度歸零、清最後觸球者
            b = soccer.ball
            assert (b.x, b.y, b.z) == (0.0, 4.5, 0.0)
            assert (b.vx, b.vy, b.vz) == (0.0, 0.0, 0.0)
            assert b.last_touch is None

            # 藍隊員把球推進自家（-z）門 → 烏龍球：得分歸紅隊、own=true、by=觸球者
            b.last_touch = soccer.players["s1"]
            b.x, b.y, b.z, b.vz = 0.0, 4.5, -19.5, -10.0
            tick(client)
            ok = recv_until(s1, "soccer_goal_ok")
            assert ok["team"] == "red" and ok["own"] is True
            assert ok["by"] == "s1" and ok["scores"] == {"blue": 1, "red": 1}


def test_ball模式_門環外撞端牆反彈不進球(
    client: TestClient, teacher_ticket: str, clock: FakeClock
) -> None:
    """球撞端牆但不在門環半徑內 → 反彈、不得分。"""
    soccer = client.app.state.soccer
    with client.websocket_connect(f"/teacher?ticket={teacher_ticket}") as t:
        recv_until(t, "student_list")
        with client.websocket_connect("/") as s1, client.websocket_connect("/") as s2:
            _register(s1, t, "小明")
            _register(s2, t, "小華")
            _join(s1, "soccer")
            _join(s2, "soccer")
            _start_ball_game(client, t, clock, s1, s2)

            ball = soccer.ball
            ball.last_touch = soccer.players["s1"]
            ball.x, ball.y, ball.z, ball.vz = 8.0, 4.5, 19.5, 10.0  # x=8 在門環（r=3）外
            tick(client)
            assert soccer.scores == {"blue": 0, "red": 0}  # 沒進球
            assert soccer.ball.z == 20.0 - BALL_RADIUS  # 端牆反彈
            assert soccer.ball.vz < 0


def test_ball模式_client進球上報忽略(
    client: TestClient, teacher_ticket: str, clock: FakeClock
) -> None:
    """ball 模式下 client 的 soccer_goal 一律忽略（進門由伺服器球物理判定）。"""
    soccer = client.app.state.soccer
    with client.websocket_connect(f"/teacher?ticket={teacher_ticket}") as t:
        recv_until(t, "student_list")
        with client.websocket_connect("/") as s1, client.websocket_connect("/") as s2:
            _register(s1, t, "小明")  # 藍隊前鋒
            _register(s2, t, "小華")
            _join(s1, "soccer")
            _join(s2, "soccer")
            _start_ball_game(client, t, clock, s1, s2)

            # 藍前鋒人在對方門環內宣告進球（striker 模式會算）→ ball 模式忽略
            s1.send_json({"type": "soccer_pos", "x": 0, "y": 4.5, "z": 20, "yaw": 0})
            s1.send_json({"type": "soccer_goal"})
            settle(client)
            assert soccer.scores == {"blue": 0, "red": 0}
