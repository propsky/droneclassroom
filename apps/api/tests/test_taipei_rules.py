"""臺北市 115 足球賽制：單場、先進球、扣分。F9A 不扣分、時間到仍進局間。"""

from fastapi.testclient import TestClient

from app.games.soccer_presets import F9A_A
from app.games.taipei_rules import TaipeiRules
from tests.conftest import FakeClock, recv_until, settle, teacher_connect, tick


class TestTaipeiRules:
    def test_淨分與先進球(self) -> None:
        assert TaipeiRules.winner(2, 1, "red") == "blue"
        assert TaipeiRules.winner(1, 1, "red") == "red"
        assert TaipeiRules.winner(0, 0, None) == "draw"
        assert TaipeiRules.net(3, 2) == 1

    def test_落地只看高度(self) -> None:
        assert TaipeiRules.landed(0.4) is True
        assert TaipeiRules.landed(0.55) is True
        assert TaipeiRules.landed(1.2) is False

    def test_停留在己方開口才算_旁邊飛過不算(self) -> None:
        gz = F9A_A.half_z - F9A_A.goal_inset
        kw = {
            "goal_z": -gz,
            "goal_y": F9A_A.goal_y,
            "goal_r": F9A_A.goal_r,
            "half_thick": F9A_A.goal_tube,
            "shield_r": F9A_A.shield_r,
        }
        assert TaipeiRules.inside_own_goal((0, F9A_A.goal_y, -gz), **kw)
        assert not TaipeiRules.inside_own_goal((0, F9A_A.goal_y, -gz + 2), **kw)
        assert not TaipeiRules.inside_own_goal((1.2, F9A_A.goal_y, -gz), **kw)

    def test_反向穿回才算_穿出去是烏龍不是這一條(self) -> None:
        y = F9A_A.goal_y
        gz = F9A_A.half_z - F9A_A.goal_inset
        kw = {
            "defend_goal_z": -gz,
            "goal_y": y,
            "goal_r": F9A_A.goal_r,
            "half_thick": F9A_A.goal_tube,
            "shield_r": F9A_A.shield_r,
        }
        inside = -gz + F9A_A.shield_r + 0.15
        outside = -gz - F9A_A.shield_r - 0.15
        assert TaipeiRules.reverse_through_own((0, y, outside), (0, y, inside), **kw)
        assert not TaipeiRules.reverse_through_own((0, y, inside), (0, y, outside), **kw)


def _start(t, sec: float, ruleset: str) -> None:
    t.send_json(
        {"type": "soccer_start", "durationSec": sec, "mode": "striker", "ruleset": ruleset}
    )


def _boot(client: TestClient, teacher_ticket: str, clock: FakeClock):
    soccer = client.app.state.soccer
    t_cm = teacher_connect(client, teacher_ticket)
    t = t_cm.__enter__()
    recv_until(t, "student_list")
    sockets = []
    entered = []
    try:
        for name in ("小明", "小華"):
            cm = client.websocket_connect("/")
            ws = cm.__enter__()
            sockets.append(cm)
            entered.append(ws)
            ws.receive_json()
            recv_until(t, "student_list")
            ws.send_json({"type": "register", "name": name, "emoji": "🐱"})
            recv_until(t, "student_list")
            ws.send_json({"type": "soccer_join"})
            recv_until(ws, "soccer_state")
        return soccer, t, t_cm, sockets, entered
    except Exception:
        for cm in sockets:
            cm.__exit__(None, None, None)
        t_cm.__exit__(None, None, None)
        raise


def test_時間到進入降落_十分鐘內結束且不進PK(
    client: TestClient, teacher_ticket: str, clock: FakeClock
) -> None:
    soccer, t, t_cm, sockets, entered = _boot(client, teacher_ticket, clock)
    try:
        _start(t, 6, "taipei")
        assert recv_until(entered[0], "soccer_countdown")["n"] == 3
        for _ in range(3):
            clock.advance(1000)
            tick(client)
        go = recv_until(entered[0], "soccer_go")
        assert go["match"]["ruleset"] == "taipei"
        assert go["match"]["phase"] == "period"
        clock.advance(6000)
        tick(client)
        phase = None
        for _ in range(6):
            msg = recv_until(entered[0], "soccer_scores")
            if msg["match"]["phase"] == "landing":
                phase = msg
                break
        assert phase is not None
        assert phase["status"] == "running"
        assert soccer.phase == "landing"
        clock.advance(10_000)
        tick(client)
        end = recv_until(entered[0], "soccer_end")
        assert end["reason"] == "taipei"
        assert end["winner"] == "draw"
        assert end["match"]["ruleset"] == "taipei"
        assert "pk" not in end["reason"]
    finally:
        for cm in sockets:
            cm.__exit__(None, None, None)
        t_cm.__exit__(None, None, None)


def test_同分先進球者勝且裁判扣分進淨分(
    client: TestClient, teacher_ticket: str, clock: FakeClock
) -> None:
    soccer, t, t_cm, sockets, entered = _boot(client, teacher_ticket, clock)
    try:
        _start(t, 30, "taipei")
        assert recv_until(entered[0], "soccer_countdown")["n"] == 3
        for _ in range(3):
            clock.advance(1000)
            tick(client)
        recv_until(entered[0], "soccer_go")
        blue = soccer.players["g:小明"]
        red = soccer.players["g:小華"]
        assert blue.team == "blue" and blue.striker
        assert red.team == "red" and red.striker
        blue.pending_cross = True
        blue.pending_cross_ms = clock.ms
        entered[0].send_json({"type": "soccer_goal"})
        settle(client)
        assert soccer.scores["blue"] == 1
        assert soccer.first_goal == "blue"
        red.pending_cross = True
        red.pending_cross_ms = clock.ms
        entered[1].send_json({"type": "soccer_goal"})
        settle(client)
        assert soccer.scores == {"blue": 1, "red": 1}
        t.send_json({"type": "soccer_warn", "studentId": "s2", "reason": "manual", "deduct": True})
        settle(client)
        assert soccer.deductions["red"] == 1
        clock.advance(30_000)
        tick(client)
        clock.advance(10_000)
        tick(client)
        end = recv_until(entered[0], "soccer_end")
        assert end["winner"] == "blue"
        assert end["match"]["deductions"]["red"] == 1
        assert end["match"]["netScores"]["blue"] == 1
        assert end["match"]["netScores"]["red"] == 0
        assert end["match"]["firstGoal"] == "blue"
    finally:
        for cm in sockets:
            cm.__exit__(None, None, None)
        t_cm.__exit__(None, None, None)


def test_停留己方球門滿一秒扣分_舊的f9a開賽仍扣分(
    client: TestClient, teacher_ticket: str, clock: FakeClock
) -> None:
    soccer, t, t_cm, sockets, entered = _boot(client, teacher_ticket, clock)
    try:
        _start(t, 40, "taipei")
        assert recv_until(entered[0], "soccer_countdown")["n"] == 3
        for _ in range(3):
            clock.advance(1000)
            tick(client)
        recv_until(entered[0], "soccer_go")
        blue = soccer.players["g:小明"]
        gz = soccer.field.goal_z
        blue.x, blue.y, blue.z = 0.0, soccer.field.goal_y, -gz
        tick(client)
        clock.advance(500)
        tick(client)
        clock.advance(500)
        tick(client)
        assert soccer.deductions["blue"] == 1
        # 還沒離開，再停著不應該每一秒都扣
        clock.advance(1000)
        tick(client)
        assert soccer.deductions["blue"] == 1

        t.send_json({"type": "soccer_reset", "clearTeams": False})
        settle(client)
        _start(t, 40, "f9a")
        assert recv_until(entered[0], "soccer_countdown")["n"] == 3
        for _ in range(3):
            clock.advance(1000)
            tick(client)
        recv_until(entered[0], "soccer_go")
        t.send_json({"type": "soccer_warn", "studentId": "s1", "reason": "conduct", "deduct": True})
        settle(client)
        assert soccer.deductions["blue"] == 1
        assert soccer.scores == {"blue": 0, "red": 0}
        assert soccer.ruleset == "taipei"
    finally:
        for cm in sockets:
            cm.__exit__(None, None, None)
        t_cm.__exit__(None, None, None)


def test_提前升空扣一次_結束未落地再扣(
    client: TestClient, teacher_ticket: str, clock: FakeClock
) -> None:
    soccer, t, t_cm, sockets, entered = _boot(client, teacher_ticket, clock)
    try:
        _start(t, 8, "taipei")
        assert recv_until(entered[0], "soccer_countdown")["n"] == 3
        blue = soccer.players["g:小明"]
        entered[0].send_json(
            {"type": "soccer_pos", "x": blue.spawn_x, "y": 0.4, "z": blue.spawn_z, "yaw": 0}
        )
        settle(client)
        entered[0].send_json(
            {"type": "soccer_pos", "x": blue.spawn_x, "y": 1.6, "z": blue.spawn_z, "yaw": 0}
        )
        settle(client)
        assert soccer.deductions["blue"] == 1
        entered[0].send_json(
            {"type": "soccer_pos", "x": blue.spawn_x, "y": 2.0, "z": blue.spawn_z, "yaw": 0}
        )
        settle(client)
        assert soccer.deductions["blue"] == 1
        for _ in range(3):
            clock.advance(1000)
            tick(client)
        recv_until(entered[0], "soccer_go")
        blue.y = 2.0
        clock.advance(8000)
        tick(client)
        clock.advance(10_000)
        tick(client)
        end = recv_until(entered[0], "soccer_end")
        assert end["match"]["deductions"]["blue"] >= 2
        assert end["winner"] == "red"
    finally:
        for cm in sockets:
            cm.__exit__(None, None, None)
        t_cm.__exit__(None, None, None)
