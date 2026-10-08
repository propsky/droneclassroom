"""F9A 階段二：穿環權威、假得分、搶跑、未返場、罰球、黃紅牌、墜機。"""

from fastapi.testclient import TestClient

from app.games.soccer_rules import shield_passes_ring
from tests.conftest import FakeClock, recv_until, settle, teacher_connect, tick
from tests.test_soccer import _countdown_to_go, _gkey, _join_soccer, _register


def test_護罩整顆穿過才算_擦框與只到球心都不算() -> None:
    kw = {"goal_z": 5.0, "goal_y": 3.25, "goal_r": 0.35, "attack_sign": 1.0}
    assert shield_passes_ring((0, 3.25, 4.80), (0, 3.25, 5.16), **kw)
    # 球心到了門面，後緣還沒過
    assert not shield_passes_ring((0, 3.25, 4.80), (0, 3.25, 5.00), **kw)
    # 徑向 0.30 小於內半徑 0.35，但大於淨空 0.23，護罩擦到框
    assert not shield_passes_ring((0.30, 3.25, 4.80), (0.30, 3.25, 5.16), **kw)
    # 往回穿，行進方向不對（機頭朝向不在這個函式裡）
    assert not shield_passes_ring((0, 3.25, 5.16), (0, 3.25, 4.80), **kw)


def test_假得分與未返場罰球(
    client: TestClient, teacher_ticket: str, clock: FakeClock
) -> None:
    soccer = client.app.state.soccer
    with teacher_connect(client, teacher_ticket) as t:
        recv_until(t, "student_list")
        with client.websocket_connect("/") as s1, client.websocket_connect("/") as s2:
            _register(s1, t, "小明")
            _register(s2, t, "小華")
            _join_soccer(s1)
            _join_soccer(s2)
            t.send_json({"type": "soccer_start", "durationSec": 40, "mode": "striker"})
            _countdown_to_go(client, clock, s1)

            # 人突然出現在圓環中心，沒有穿越段
            clock.advance(3000)
            s1.send_json({"type": "soccer_pos", "x": 0, "y": 3.25, "z": 5, "yaw": 0})
            s1.send_json({"type": "soccer_goal"})
            settle(client)
            assert soccer.scores["blue"] == 0

            # 後緣沒過門面
            clock.advance(400)
            s1.send_json({"type": "soccer_pos", "x": 0, "y": 3.25, "z": 4.80, "yaw": 0})
            settle(client)
            clock.advance(400)
            s1.send_json({"type": "soccer_pos", "x": 0, "y": 3.25, "z": 5.00, "yaw": 0})
            s1.send_json({"type": "soccer_goal"})
            settle(client)
            assert soccer.scores["blue"] == 0

            # 擦框
            clock.advance(400)
            s1.send_json({"type": "soccer_pos", "x": 0.30, "y": 3.25, "z": 4.80, "yaw": 0})
            settle(client)
            clock.advance(400)
            s1.send_json({"type": "soccer_pos", "x": 0.30, "y": 3.25, "z": 5.16, "yaw": 0})
            s1.send_json({"type": "soccer_goal"})
            settle(client)
            assert soccer.scores["blue"] == 0

            # 反向穿過
            clock.advance(400)
            s1.send_json({"type": "soccer_pos", "x": 0, "y": 3.25, "z": 5.16, "yaw": 0})
            settle(client)
            clock.advance(400)
            s1.send_json({"type": "soccer_pos", "x": 0, "y": 3.25, "z": 4.80, "yaw": 0})
            s1.send_json({"type": "soccer_goal"})
            settle(client)
            assert soccer.scores["blue"] == 0

            # 合法整顆穿過
            clock.advance(400)
            s1.send_json({"type": "soccer_pos", "x": 0, "y": 3.25, "z": 5.16, "yaw": 0})
            s1.send_json({"type": "soccer_goal"})
            settle(client)
            assert soccer.scores["blue"] == 1
            assert soccer.players[_gkey("小明")].needs_return is True

            # 沒回半場又穿一次 → 不算分，改罰球
            clock.advance(400)
            s1.send_json({"type": "soccer_pos", "x": 0, "y": 3.25, "z": 4.80, "yaw": 0})
            settle(client)
            clock.advance(400)
            s1.send_json({"type": "soccer_pos", "x": 0, "y": 3.25, "z": 5.16, "yaw": 0})
            settle(client)
            assert soccer.scores["blue"] == 1
            assert soccer.status == "penalty"
            assert soccer.penalty_reason == "no_return"
            assert soccer.penalty_attack == "red"


def test_搶跑罰球後才開局(
    client: TestClient, teacher_ticket: str, clock: FakeClock
) -> None:
    soccer = client.app.state.soccer
    with teacher_connect(client, teacher_ticket) as t:
        recv_until(t, "student_list")
        with client.websocket_connect("/") as s1, client.websocket_connect("/") as s2:
            _register(s1, t, "小明")
            _register(s2, t, "小華")
            _join_soccer(s1)
            _join_soccer(s2)
            t.send_json({"type": "soccer_start", "durationSec": 40, "mode": "striker"})
            assert recv_until(s1, "soccer_countdown")["n"] == 3

            s1.send_json({"type": "soccer_pos", "x": 0, "y": 0.4, "z": -6.5, "yaw": 3.14})
            settle(client)
            clock.advance(500)
            s1.send_json({"type": "soccer_pos", "x": 0, "y": 1.2, "z": -4.0, "yaw": 3.14})
            foul = recv_until(s1, "soccer_foul")
            assert foul["reason"] == "false_start"
            assert soccer.status == "penalty"
            assert soccer.penalty_attack == "red"

            clock.advance(3000)
            tick(client)
            assert soccer.status == "penalty"  # 倒數不會在搶跑後直接 GO

            clock.advance(8000)
            tick(client)
            assert soccer.status == "running"
            assert recv_until(s1, "soccer_go")["match"]["period"] == 1


def test_碰撞黃牌再撞變紅牌且本局不能得分(
    client: TestClient, teacher_ticket: str, clock: FakeClock
) -> None:
    soccer = client.app.state.soccer
    with teacher_connect(client, teacher_ticket) as t:
        recv_until(t, "student_list")
        with client.websocket_connect("/") as s1, client.websocket_connect("/") as s2:
            _register(s1, t, "小明")
            _register(s2, t, "小華")
            _join_soccer(s1)
            _join_soccer(s2)
            t.send_json({"type": "soccer_start", "durationSec": 40, "mode": "striker"})
            _countdown_to_go(client, clock, s1)

            clock.advance(3000)
            s1.send_json({"type": "soccer_pos", "x": 0, "y": 1, "z": 0, "yaw": 0})
            s2.send_json({"type": "soccer_pos", "x": 0, "y": 1, "z": 1.2, "yaw": 0})
            settle(client)
            clock.advance(300)
            s1.send_json({"type": "soccer_pos", "x": 0, "y": 1, "z": 0, "yaw": 0})
            s2.send_json({"type": "soccer_pos", "x": 0, "y": 1, "z": 0.1, "yaw": 0})
            tick(client)
            card = recv_until(s2, "soccer_card")
            assert card["card"] == "yellow"
            assert card["by"] == "s2"
            assert soccer.players[_gkey("小華")].disabled is False

            # 分開時要先 tick，接觸鎖才會放開；再撞一次才升級紅牌
            clock.advance(400)
            s2.send_json({"type": "soccer_pos", "x": 0, "y": 1, "z": 1.2, "yaw": 0})
            tick(client)
            clock.advance(300)
            s2.send_json({"type": "soccer_pos", "x": 0, "y": 1, "z": 0.1, "yaw": 0})
            tick(client)
            card2 = recv_until(s2, "soccer_card")
            assert card2["card"] == "red"
            assert soccer.players[_gkey("小華")].disabled is True
            assert soccer.players[_gkey("小華")].striker is False

            clock.advance(400)
            s2.send_json({"type": "soccer_pos", "x": 0, "y": 3.25, "z": -4.8, "yaw": 0})
            settle(client)
            clock.advance(400)
            s2.send_json({"type": "soccer_pos", "x": 0, "y": 3.25, "z": -5.2, "yaw": 0})
            s2.send_json({"type": "soccer_goal"})
            settle(client)
            assert soccer.scores["red"] == 0


def test_墜機本局排除下一局恢復(
    client: TestClient, teacher_ticket: str, clock: FakeClock
) -> None:
    soccer = client.app.state.soccer
    with teacher_connect(client, teacher_ticket) as t:
        recv_until(t, "student_list")
        with client.websocket_connect("/") as s1, client.websocket_connect("/") as s2:
            _register(s1, t, "小明")
            _register(s2, t, "小華")
            _join_soccer(s1)
            _join_soccer(s2)
            t.send_json({"type": "soccer_start", "durationSec": 5, "mode": "striker"})
            _countdown_to_go(client, clock, s1)

            s1.send_json({"type": "soccer_crash"})
            settle(client)
            assert soccer.players[_gkey("小明")].disabled is True
            assert soccer.players[_gkey("小明")].card == "red"
            assert soccer.players[_gkey("小明")].striker is False

            clock.advance(5_000)
            tick(client)
            assert soccer.status == "break"
            clock.advance(15_000)
            tick(client)
            assert soccer.status == "running"
            assert soccer.players[_gkey("小明")].disabled is False
            assert soccer.players[_gkey("小明")].striker is True
