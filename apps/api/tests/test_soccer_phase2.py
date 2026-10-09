"""F9A 階段二：穿環權威、假得分、搶跑、未返場、罰球、黃紅牌、墜機。"""

from fastapi.testclient import TestClient

from app.games.soccer_presets import F9A_A
from app.games.soccer_rules import shield_passes_ring
from tests.conftest import FakeClock, recv_until, settle, teacher_connect, tick
from tests.test_soccer import _countdown_to_go, _gkey, _join_soccer, _register, f9a_cross


def test_護罩整顆穿過才算_擦框與只到球心都不算() -> None:
    y, gz, z0, z1 = f9a_cross()
    kw = {
        "goal_z": gz,
        "goal_y": y,
        "goal_r": F9A_A.goal_r,
        "attack_sign": 1.0,
        "shield_r": F9A_A.shield_r,
    }
    assert shield_passes_ring((0, y, z0), (0, y, z1), **kw)
    # 球心到了門面，後緣還沒過
    assert not shield_passes_ring((0, y, z0), (0, y, gz), **kw)
    # 徑向大於淨空（內半徑 − 護罩），護罩擦到框
    graze = F9A_A.goal_r - F9A_A.shield_r + 0.05
    assert not shield_passes_ring((graze, y, z0), (graze, y, z1), **kw)
    # 往回穿，行進方向不對（機頭朝向不在這個函式裡）
    assert not shield_passes_ring((0, y, z1), (0, y, z0), **kw)


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

            y, gz, z0, z1 = f9a_cross()
            graze = F9A_A.goal_r - F9A_A.shield_r + 0.05
            # 人突然出現在圓環中心，沒有穿越段
            clock.advance(3000)
            s1.send_json({"type": "soccer_pos", "x": 0, "y": y, "z": gz, "yaw": 0})
            s1.send_json({"type": "soccer_goal"})
            settle(client)
            assert soccer.scores["blue"] == 0

            # 後緣沒過門面
            clock.advance(400)
            s1.send_json({"type": "soccer_pos", "x": 0, "y": y, "z": z0, "yaw": 0})
            settle(client)
            clock.advance(400)
            s1.send_json({"type": "soccer_pos", "x": 0, "y": y, "z": gz, "yaw": 0})
            s1.send_json({"type": "soccer_goal"})
            settle(client)
            assert soccer.scores["blue"] == 0

            # 擦框
            clock.advance(400)
            s1.send_json({"type": "soccer_pos", "x": graze, "y": y, "z": z0, "yaw": 0})
            settle(client)
            clock.advance(400)
            s1.send_json({"type": "soccer_pos", "x": graze, "y": y, "z": z1, "yaw": 0})
            s1.send_json({"type": "soccer_goal"})
            settle(client)
            assert soccer.scores["blue"] == 0

            # 反向穿過
            clock.advance(400)
            s1.send_json({"type": "soccer_pos", "x": 0, "y": y, "z": z1, "yaw": 0})
            settle(client)
            clock.advance(400)
            s1.send_json({"type": "soccer_pos", "x": 0, "y": y, "z": z0, "yaw": 0})
            s1.send_json({"type": "soccer_goal"})
            settle(client)
            assert soccer.scores["blue"] == 0

            # 合法整顆穿過
            clock.advance(400)
            s1.send_json({"type": "soccer_pos", "x": 0, "y": y, "z": z1, "yaw": 0})
            s1.send_json({"type": "soccer_goal"})
            settle(client)
            assert soccer.scores["blue"] == 1
            assert soccer.players[_gkey("小明")].needs_return is True

            # 沒回半場又穿一次 → 不算分，改罰球
            clock.advance(400)
            s1.send_json({"type": "soccer_pos", "x": 0, "y": y, "z": z0, "yaw": 0})
            settle(client)
            clock.advance(400)
            s1.send_json({"type": "soccer_pos", "x": 0, "y": y, "z": z1, "yaw": 0})
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

            s1.send_json({"type": "soccer_pos", "x": 0, "y": 0.4, "z": -6.25, "yaw": 3.14})
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


def test_預設不因空中接近速度發牌(
    client: TestClient, teacher_ticket: str, clock: FakeClock
) -> None:
    """2026 F9A.9 沒有空中接近速度牌。快撞一記，兩台都不該有牌。"""
    soccer = client.app.state.soccer
    assert soccer.air_contact_cards is False
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
            assert soccer.players[_gkey("小華")].card is None
            assert soccer.players[_gkey("小明")].card is None
            assert soccer.players[_gkey("小華")].disabled is False


def test_教學選項開啟時接近速度仍發黃牌再紅牌(
    client: TestClient, teacher_ticket: str, clock: FakeClock
) -> None:
    soccer = client.app.state.soccer
    soccer.air_contact_cards = True
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
            warn = recv_until(s2, "soccer_warning")
            assert warn["reason"] == "contact"
            assert warn["count"] == 1
            assert soccer.players[_gkey("小華")].card is None
            assert soccer.players[_gkey("小華")].disabled is False

            # 分開時要先 tick，接觸鎖才會放開；同理由第二次警告升黃牌，本局出場
            clock.advance(400)
            s2.send_json({"type": "soccer_pos", "x": 0, "y": 1, "z": 1.2, "yaw": 0})
            tick(client)
            clock.advance(300)
            s2.send_json({"type": "soccer_pos", "x": 0, "y": 1, "z": 0.1, "yaw": 0})
            tick(client)
            card = recv_until(s2, "soccer_card")
            assert card["card"] == "yellow"
            assert soccer.players[_gkey("小華")].disabled is True
            assert soccer.players[_gkey("小華")].striker is False

            y, _gz, z0, z1 = f9a_cross()
            clock.advance(400)
            s2.send_json({"type": "soccer_pos", "x": 0, "y": y, "z": -z0, "yaw": 0})
            settle(client)
            clock.advance(400)
            s2.send_json({"type": "soccer_pos", "x": 0, "y": y, "z": -z1, "yaw": 0})
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
            safety = recv_until(s1, "soccer_safety")
            assert safety["reason"] == "crash"
            assert safety["by"] == "s1"
            assert soccer.players[_gkey("小明")].disabled is True
            assert soccer.players[_gkey("小明")].card is None
            assert soccer.players[_gkey("小明")].striker is False

            clock.advance(5_000)
            tick(client)
            assert soccer.status == "break"
            clock.advance(15_000)
            tick(client)
            assert soccer.status == "running"
            assert soccer.players[_gkey("小明")].disabled is False
            assert soccer.players[_gkey("小明")].striker is True


def test_得分後全員回半場_隊友沒回就再攻判罰球且不算分(
    client: TestClient, teacher_ticket: str, clock: FakeClock
) -> None:
    """F9A.8.4：得分隊任何一人沒回己方半場，前鋒再穿門 → 罰球，比分不加。"""
    soccer = client.app.state.soccer
    with teacher_connect(client, teacher_ticket) as t:
        recv_until(t, "student_list")
        with (
            client.websocket_connect("/") as s1,
            client.websocket_connect("/") as s2,
            client.websocket_connect("/") as s3,
        ):
            _register(s1, t, "小明")
            _register(s2, t, "小華")
            _register(s3, t, "小美")
            _join_soccer(s1)
            _join_soccer(s2)
            _join_soccer(s3)
            t.send_json({"type": "soccer_start", "durationSec": 40, "mode": "striker"})
            _countdown_to_go(client, clock, s1)

            y, _gz, z0, z1 = f9a_cross()
            # 藍隊防守先飛到對方半場
            clock.advance(3000)
            s3.send_json({"type": "soccer_pos", "x": 0.2, "y": 1, "z": 2, "yaw": 0})
            settle(client)

            clock.advance(400)
            s1.send_json({"type": "soccer_pos", "x": 0, "y": y, "z": z0, "yaw": 0})
            settle(client)
            clock.advance(400)
            s1.send_json({"type": "soccer_pos", "x": 0, "y": y, "z": z1, "yaw": 0})
            s1.send_json({"type": "soccer_goal"})
            settle(client)
            assert soccer.scores["blue"] == 1
            assert soccer.players[_gkey("小明")].needs_return is True
            assert soccer.players[_gkey("小美")].needs_return is True
            assert soccer.armed["blue"] is False

            # 前鋒回家，防守還在對方半場
            clock.advance(3000)
            s1.send_json({"type": "soccer_pos", "x": 0, "y": 1, "z": -1, "yaw": 0})
            tick(client)
            assert soccer.players[_gkey("小明")].needs_return is False
            assert soccer.armed["blue"] is False

            clock.advance(400)
            s1.send_json({"type": "soccer_pos", "x": 0, "y": y, "z": z0, "yaw": 0})
            settle(client)
            clock.advance(400)
            s1.send_json({"type": "soccer_pos", "x": 0, "y": y, "z": z1, "yaw": 0})
            settle(client)
            assert soccer.status == "penalty"
            assert soccer.penalty_reason == "no_return"
            assert soccer.scores["blue"] == 1


def test_兩次警告升黃牌_兩張黃牌升紅牌(
    client: TestClient, teacher_ticket: str, clock: FakeClock
) -> None:
    soccer = client.app.state.soccer
    with teacher_connect(client, teacher_ticket) as t:
        recv_until(t, "student_list")
        with (
            client.websocket_connect("/") as s1,
            client.websocket_connect("/") as s2,
            client.websocket_connect("/") as s3,
        ):
            _register(s1, t, "小明")
            _register(s2, t, "小華")
            _register(s3, t, "小美")
            _join_soccer(s1)
            _join_soccer(s2)
            _join_soccer(s3)
            t.send_json({"type": "soccer_start", "durationSec": 40, "mode": "striker"})
            _countdown_to_go(client, clock, s1)
            ming = soccer.players[_gkey("小明")]
            mei = soccer.players[_gkey("小美")]

            t.send_json({"type": "soccer_warn", "studentId": ming.record.id, "reason": "conduct"})
            settle(client)
            assert soccer.warnings["blue"]["conduct"] == 1
            assert ming.card is None

            t.send_json({"type": "soccer_warn", "studentId": ming.record.id, "reason": "conduct"})
            card = recv_until(s1, "soccer_card")
            assert card["card"] == "yellow"
            assert recv_until(s3, "soccer_card")["card"] == "yellow"
            assert ming.disabled is True
            assert ming.ejected_match is False
            assert soccer.team_yellows["blue"] == 1

            t.send_json({"type": "soccer_warn", "studentId": mei.record.id, "reason": "conduct"})
            settle(client)
            t.send_json({"type": "soccer_warn", "studentId": mei.record.id, "reason": "conduct"})
            card2 = recv_until(s3, "soccer_card")
            assert card2["card"] == "red"
            assert mei.disabled is True
            assert mei.ejected_match is True
            assert soccer.team_yellows["blue"] == 2


def test_前鋒墜機可暫停換人每局一次(
    client: TestClient, teacher_ticket: str, clock: FakeClock
) -> None:
    soccer = client.app.state.soccer
    with teacher_connect(client, teacher_ticket) as t:
        recv_until(t, "student_list")
        with (
            client.websocket_connect("/") as s1,
            client.websocket_connect("/") as s2,
            client.websocket_connect("/") as s3,
        ):
            _register(s1, t, "小明")
            _register(s2, t, "小華")
            _register(s3, t, "小美")
            _join_soccer(s1)
            _join_soccer(s2)
            _join_soccer(s3)
            t.send_json({"type": "soccer_start", "durationSec": 40, "mode": "striker"})
            _countdown_to_go(client, clock, s1)

            s1.send_json({"type": "soccer_crash"})
            recv_until(s1, "soccer_safety")
            assert soccer.players[_gkey("小明")].striker is False

            mei_id = soccer.players[_gkey("小美")].record.id
            s3.send_json({"type": "soccer_timeout", "strikerId": mei_id})
            notice = recv_until(s3, "soccer_timeout")
            assert notice["strikerId"] == soccer.players[_gkey("小美")].record.id
            assert soccer.players[_gkey("小美")].striker is True
            assert soccer.timeout_used["blue"] is True

            s3.send_json({"type": "soccer_timeout"})
            settle(client)
            assert soccer.players[_gkey("小美")].striker is True


def test_F9A_B每隊最多3人() -> None:
    from app.games.soccer import SoccerField, SoccerGame, SoccerPlayer
    from app.games.soccer_presets import F9A_B
    from app.roster import Roster, StudentRecord

    roster = Roster(known_levels=frozenset())
    game = SoccerGame(roster, field=SoccerField.from_spec(F9A_B))
    game._active = lambda: [p for p in game.players.values() if p.active and not p.disconnected]  # type: ignore[method-assign]
    for i in range(7):
        rec = StudentRecord(id=f"s{i}", ws=None, name=f"生{i}", emoji="🐱")
        p = SoccerPlayer(record=rec, active=True)
        game.players[f"k{i}"] = p
        game._auto_assign_team(p)
    blue = sum(1 for p in game.players.values() if p.team == "blue")
    red = sum(1 for p in game.players.values() if p.team == "red")
    none = sum(1 for p in game.players.values() if p.team is None)
    assert blue == 3 and red == 3 and none == 1
    assert F9A_B.max_players == 3
