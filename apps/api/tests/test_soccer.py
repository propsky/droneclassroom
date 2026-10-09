"""足球賽局測試 — 分隊平衡、前鋒保證 / 遞補、進球驗證、半場重置、倒數取消、勝負。

tick 相關流程全部用假時鐘（conftest.clock）＋ 手動 tick（conftest.tick），不 sleep。
"""

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.games.soccer import SOCCER_BREAK_SEC, SOCCER_PK_MIN_ROUNDS, SoccerField
from app.games.soccer_presets import F9A_A, F9A_B
from app.games.soccer_rules import PENALTY_SEC
from tests.conftest import FakeClock, recv_until, settle, teacher_connect, tick


def f9a_cross() -> tuple[float, float, float, float]:
    """F9A-A 穿環用：(圓心高, 門面 z, 門前, 穿過後)。門前的後緣還沒過門面。"""
    gz = F9A_A.half_z - F9A_A.goal_inset
    y = F9A_A.goal_y
    z0 = gz - F9A_A.shield_r - 0.1
    z1 = gz + F9A_A.shield_r + 0.1
    return y, gz, z0, z1


def _gkey(name: str) -> str:
    return f"g:{name}"


def _register(ws, t, name: str) -> None:
    """學生註冊並消化老師端對應的名冊訊息。"""
    ws.receive_json()  # welcome
    recv_until(t, "student_list")
    ws.send_json({"type": "register", "name": name, "emoji": "🐱"})
    recv_until(t, "student_list")


def _join_soccer(ws) -> dict:
    """加入足球並回傳收到的 soccer_state 快照。"""
    ws.send_json({"type": "soccer_join"})
    return recv_until(ws, "soccer_state")


def _countdown_to_go(client: TestClient, clock: FakeClock, ws) -> dict:
    """吃完 3-2-1 倒數（推進假時鐘＋手動 tick），回傳 soccer_go。"""
    assert recv_until(ws, "soccer_countdown")["n"] == 3
    for _ in range(3):
        clock.advance(1000)
        tick(client)
    return recv_until(ws, "soccer_go")


def test_自動分隊平衡與前鋒保證(client: TestClient, teacher_ticket: str) -> None:
    """三人依序加入 → 藍紅人數差 ≤ 1；每隊第一人自動成為前鋒。"""
    soccer = client.app.state.soccer
    with teacher_connect(client, teacher_ticket) as t:
        recv_until(t, "student_list")
        with (
            client.websocket_connect("/") as s1,
            client.websocket_connect("/") as s2,
            client.websocket_connect("/") as s3,
        ):
            for ws, name in ((s1, "小明"), (s2, "小華"), (s3, "小美")):
                _register(ws, t, name)
                _join_soccer(ws)
            teams = {pid: p.team for pid, p in soccer.players.items()}
            assert teams == {_gkey("小明"): "blue", _gkey("小華"): "red", _gkey("小美"): "blue"}
            strikers = {pid for pid, p in soccer.players.items() if p.striker}
            assert strikers == {_gkey("小明"), _gkey("小華")}  # 每隊恰一前鋒（第一人）


def test_老師手動分隊與指定前鋒(client: TestClient, teacher_ticket: str) -> None:
    """soccer_set_team 換隊（原隊 / 新隊都重新確保前鋒）；soccer_set_striker 指定。"""
    soccer = client.app.state.soccer
    with teacher_connect(client, teacher_ticket) as t:
        recv_until(t, "student_list")
        with (
            client.websocket_connect("/") as s1,
            client.websocket_connect("/") as s2,
            client.websocket_connect("/") as s3,
        ):
            for ws, name in ((s1, "小明"), (s2, "小華"), (s3, "小美")):
                _register(ws, t, name)
                _join_soccer(ws)
            # s3（藍）→ 紅：藍剩 s1（前鋒不變）、紅 s2 仍前鋒、s3 非前鋒
            t.send_json({"type": "soccer_set_team", "studentId": "s3", "team": "red"})
            settle(client)
            assert soccer.players[_gkey("小美")].team == "red"
            assert soccer.players[_gkey("小美")].striker is False
            assert soccer.players[_gkey("小華")].striker is True
            # 指定 s3 為紅隊前鋒 → s2 卸下
            t.send_json({"type": "soccer_set_striker", "studentId": "s3"})
            settle(client)
            assert soccer.players[_gkey("小美")].striker is True
            assert soccer.players[_gkey("小華")].striker is False


def test_striker模式進球驗證與半場重置與勝負(
    client: TestClient, teacher_ticket: str, clock: FakeClock
) -> None:
    """striker 模式：前鋒 + 尚未鎖回場 + 位置在圓環內才得分；
    得分的那台回己方半場才解鎖；防守回半場不算。一節結束先進局間休息。"""
    soccer = client.app.state.soccer
    with teacher_connect(client, teacher_ticket) as t:
        recv_until(t, "student_list")
        with (
            client.websocket_connect("/") as s1,  # 藍隊前鋒
            client.websocket_connect("/") as s2,  # 紅隊前鋒
            client.websocket_connect("/") as s3,  # 藍隊防守
        ):
            for ws, name in ((s1, "小明"), (s2, "小華"), (s3, "小美")):
                _register(ws, t, name)
                _join_soccer(ws)

            t.send_json({"type": "soccer_start", "durationSec": 40, "mode": "striker"})
            go = _countdown_to_go(client, clock, s1)
            assert go["mode"] == "striker"
            assert go["ball"] is None  # striker 模式沒有共用球
            assert go["match"]["phase"] == "period" and go["match"]["period"] == 1
            # F9A-A：14×7×5、內半徑 0.30、管半徑 0.10、門面離底線 1.5m（goalZ=5.5）、護罩 0.20
            y, gz, _z0, _z1 = f9a_cross()
            assert go["field"] == soccer.field_payload()
            assert go["field"]["halfX"] == pytest.approx(3.5)
            assert go["field"]["halfZ"] == pytest.approx(7.0)
            assert go["field"]["ceil"] == pytest.approx(5.0)
            assert go["field"]["goalR"] == pytest.approx(0.30)
            assert go["field"]["goalTube"] == pytest.approx(0.10)
            assert go["field"]["goalY"] == pytest.approx(y)
            assert go["field"]["goalZ"] == pytest.approx(gz)
            assert go["field"]["shieldR"] == pytest.approx(0.20)
            # 起飛區進深 1.5m，中心 |z| = 7 - 0.75 = 6.25。兩人藍隊間距 = 球徑 0.40，前鋒靠中。
            spawns = {sp["id"]: sp for sp in go["spawns"]}
            assert go["field"]["startDepth"] == pytest.approx(1.5)
            assert go["field"]["startWidth"] == pytest.approx(0.8)  # 人數較多的藍隊 2 人 × 球徑
            assert spawns["s1"] == {"id": "s1", "x": -0.2, "z": -6.25}  # 藍前鋒
            assert spawns["s2"] == {"id": "s2", "x": 0.0, "z": 6.25}  # 紅前鋒
            assert spawns["s3"] == {"id": "s3", "x": 0.2, "z": -6.25}  # 藍防守，間距一顆球徑
            assert go["endTime"] == int(clock.ms + 40_000)

            # 底線 z=7，離門面 1.5m → 不算
            y, gz, z0, z1 = f9a_cross()
            s1.send_json({"type": "soccer_pos", "x": 0, "y": y, "z": 7, "yaw": 0})
            s1.send_json({"type": "soccer_goal"})
            settle(client)
            assert soccer.scores["blue"] == 0
            # 門面上但球心在環外（x=0.45 > 內半徑 0.30）→ 不算
            clock.advance(3000)
            s1.send_json({"type": "soccer_pos", "x": 0.45, "y": y, "z": gz, "yaw": 0})
            s1.send_json({"type": "soccer_goal"})
            settle(client)
            assert soccer.scores["blue"] == 0

            # 整顆護罩沿 +z 穿過：後緣過門面、球心在淨空半徑內才算
            clock.advance(3000)
            s1.send_json({"type": "soccer_pos", "x": 0, "y": y, "z": z0, "yaw": 0})
            settle(client)
            clock.advance(400)
            s1.send_json({"type": "soccer_pos", "x": 0, "y": y, "z": z1, "yaw": 0})
            s1.send_json({"type": "soccer_goal"})
            ok = recv_until(s1, "soccer_goal_ok")
            assert ok["team"] == "blue" and ok["scores"] == {"blue": 1, "red": 0}
            assert soccer.armed["blue"] is False
            assert soccer.players[_gkey("小明")].needs_return is True
            # 消化進球後的 soccer_scores（armed=False），下面才能等到恢復 armed 的那則
            assert recv_until(s1, "soccer_scores")["armed"]["blue"] is False

            # 未回半場再宣告 → 不算
            s1.send_json({"type": "soccer_goal"})
            settle(client)
            assert soccer.scores["blue"] == 1

            # 非前鋒在門環內宣告 → 不算
            clock.advance(3000)
            s3.send_json({"type": "soccer_pos", "x": 0, "y": y, "z": gz, "yaw": 0})
            s3.send_json({"type": "soccer_goal"})
            settle(client)
            assert soccer.scores["blue"] == 1

            # 防守回到藍隊半場，不能替攻擊手解鎖（這則比分仍是 armed=false）
            clock.advance(3000)
            s3.send_json({"type": "soccer_pos", "x": 0, "y": 1, "z": -1, "yaw": 0})
            tick(client)
            assert soccer.armed["blue"] is False
            assert recv_until(s1, "soccer_scores")["armed"]["blue"] is False

            # 位置不在門環 → 不算（紅隊前鋒 armed 但人在原點）
            s2.send_json({"type": "soccer_goal"})
            settle(client)
            assert soccer.scores["red"] == 0

            # 半場重置：得分的那台（藍前鋒）回自家半場（z<0）→ tick 恢復 armed
            clock.advance(3000)
            s1.send_json({"type": "soccer_pos", "x": 0, "y": 2, "z": -1, "yaw": 0})
            tick(client)
            assert soccer.armed["blue"] is True
            assert soccer.players[_gkey("小明")].needs_return is False
            assert recv_until(s1, "soccer_scores")["armed"]["blue"] is True

            # 時間到：藍贏下第 1 局，尚未兩勝 → 局間休息，本場還沒結束
            clock.advance(40_000)
            tick(client)
            assert soccer.status == "break"
            assert soccer.sets == {"blue": 1, "red": 0}
            assert soccer.phase == "break"
            assert soccer.winner is None


def test_倒數中soccer_reset取消與重新分隊(
    client: TestClient, teacher_ticket: str, clock: FakeClock
) -> None:
    """soccer_reset 在倒數中 → 取消回 idle 不會 GO；clearTeams 交錯重新分隊。"""
    soccer = client.app.state.soccer
    with teacher_connect(client, teacher_ticket) as t:
        recv_until(t, "student_list")
        with client.websocket_connect("/") as s1, client.websocket_connect("/") as s2:
            _register(s1, t, "小明")
            _register(s2, t, "小華")
            _join_soccer(s1)
            _join_soccer(s2)
            t.send_json({"type": "soccer_start", "durationSec": 40})
            assert recv_until(s1, "soccer_countdown")["n"] == 3

            t.send_json({"type": "soccer_reset", "clearTeams": True})
            snap = recv_until(s1, "soccer_state")
            assert snap["status"] == "idle"
            clock.advance(5000)
            tick(client)
            assert soccer.status == "idle"  # 沒有 GO
            # clearTeams：交錯重新分隊、前鋒全清
            assert {p.team for p in soccer.players.values()} == {"blue", "red"}
            assert all(not p.striker for p in soccer.players.values())


def test_前鋒斷線遞補與離開保留隊伍(client: TestClient, teacher_ticket: str) -> None:
    """前鋒斷線 → 同隊連線者遞補；slot 保留；soccer_leave 後重新加入沿用原隊。

    連線順序決定 id：s_stay 先連（s1）、s_leave 後連（s2）。
    """
    soccer = client.app.state.soccer
    key_leave = "g:小華"
    key_stay = "g:小明"
    with teacher_connect(client, teacher_ticket) as t:
        recv_until(t, "student_list")
        with client.websocket_connect("/") as s_stay:  # id s1
            with client.websocket_connect("/") as s_leave:  # id s2
                _register(s_stay, t, "小明")
                _register(s_leave, t, "小華")
                _join_soccer(s_leave)  # 第一個加入 → 藍隊前鋒（s2）
                _join_soccer(s_stay)  # 自動平衡 → 紅隊（s1）
                # s1 改到藍隊當防守（藍隊前鋒仍是 s2）
                t.send_json({"type": "soccer_set_team", "studentId": "s1", "team": "blue"})
                settle(client)
                assert soccer.players[key_stay].team == "blue"
                assert soccer.players[key_stay].striker is False
                assert soccer.players[key_leave].striker is True
            # s2（前鋒）斷線 → slot 保留、s1 遞補藍隊前鋒
            recv_until(t, "student_list")
            assert key_leave in soccer.players
            assert soccer.players[key_leave].disconnected is True
            assert soccer.players[key_stay].striker is True

            # soccer_leave：隊伍保留，重新加入回原隊
            s_stay.send_json({"type": "soccer_leave"})
            settle(client)
            assert soccer.players[key_stay].active is False
            s_stay.send_json({"type": "soccer_join"})
            recv_until(s_stay, "soccer_state")
            assert soccer.players[key_stay].team == "blue"


def test_與大亂鬥互斥(client: TestClient, teacher_ticket: str) -> None:
    """soccer_join 會退出大亂鬥；arena_join 會退出足球（雙向互斥）。"""
    arena = client.app.state.arena
    soccer = client.app.state.soccer
    with teacher_connect(client, teacher_ticket) as t:
        recv_until(t, "student_list")
        with client.websocket_connect("/") as s:
            _register(s, t, "小明")
            s.send_json({"type": "arena_join"})
            recv_until(s, "arena_state")
            s.send_json({"type": "soccer_join"})
            recv_until(s, "soccer_state")
            assert arena.players[_gkey("小明")].active is False
            assert soccer.players[_gkey("小明")].active is True
            s.send_json({"type": "arena_join"})
            recv_until(s, "arena_state")
            assert soccer.players[_gkey("小明")].active is False
            assert arena.players[_gkey("小明")].active is True


def _blue_goal(client: TestClient, clock: FakeClock, ws) -> None:
    """藍隊前鋒整顆護罩沿 +z 穿過對方圓環再宣告（兩筆位置，避免超速）。"""
    y, _gz, z0, z1 = f9a_cross()
    clock.advance(3000)
    ws.send_json({"type": "soccer_pos", "x": 0, "y": y, "z": z0, "yaw": 3.14})
    settle(client)
    clock.advance(400)
    ws.send_json({"type": "soccer_pos", "x": 0, "y": y, "z": z1, "yaw": 3.14})
    ws.send_json({"type": "soccer_goal"})
    settle(client)


def test_未帶mode預設striker(client: TestClient, teacher_ticket: str, clock: FakeClock) -> None:
    """soccer_start 不帶 mode → 前鋒穿門，沒有共用球。"""
    with teacher_connect(client, teacher_ticket) as t:
        recv_until(t, "student_list")
        with client.websocket_connect("/") as s1:
            _register(s1, t, "小明")
            _join_soccer(s1)
            t.send_json({"type": "soccer_start", "durationSec": 30})
            go = _countdown_to_go(client, clock, s1)
            assert go["mode"] == "striker"
            assert go["ball"] is None
            assert go["match"]["sets"] == {"blue": 0, "red": 0}


def test_非攻擊手進自家圓環犯規(
    client: TestClient, teacher_ticket: str, clock: FakeClock
) -> None:
    """防守飛進自家圓環記犯規；攻擊手進自家圓環不算；人還在裡面不重複記。"""
    soccer = client.app.state.soccer
    with teacher_connect(client, teacher_ticket) as t:
        recv_until(t, "student_list")
        with client.websocket_connect("/") as s1, client.websocket_connect("/") as s3:
            _register(s1, t, "小明")  # 藍前鋒
            _register(s3, t, "小美")  # 先加入會是紅？兩人：s1 藍、s3 紅
            _join_soccer(s1)
            _join_soccer(s3)
            # 把小美換到藍隊當防守
            t.send_json({"type": "soccer_set_team", "studentId": "s2", "team": "blue"})
            settle(client)
            assert soccer.players[_gkey("小美")].team == "blue"
            assert soccer.players[_gkey("小美")].striker is False
            t.send_json({"type": "soccer_start", "durationSec": 40, "mode": "striker"})
            _countdown_to_go(client, clock, s1)

            # 防守進入藍隊自家門 → 公告並改判 10 秒罰球
            y, gz, _z0, _z1 = f9a_cross()
            s3.send_json({"type": "soccer_pos", "x": 0, "y": y, "z": -gz, "yaw": 0})
            tick(client)
            foul = recv_until(s3, "soccer_foul")
            assert foul["reason"] == "own_ring" and foul["by"] == "s2"
            assert foul["team"] == "blue"
            assert soccer.foul_count == 1
            assert soccer.status == "penalty"
            assert soccer.scores == {"blue": 0, "red": 0}
            # 還在裡面 → 不重複
            tick(client)
            assert soccer.foul_count == 1

            # 攻擊手進自家圓環不是犯規
            clock.advance(3000)
            s1.send_json({"type": "soccer_pos", "x": 0, "y": y, "z": -gz, "yaw": 0})
            tick(client)
            assert soccer.foul_count == 1

            # 罰球時間到，回到進行中（節時鐘有暫停）
            clock.advance(10_000)
            tick(client)
            assert soccer.status == "running"

            # 防守離開再進入 → 再記一次，並再開一次罰球
            clock.advance(3000)
            s3.send_json({"type": "soccer_pos", "x": 0, "y": 1, "z": 0, "yaw": 0})
            tick(client)
            assert soccer.players[_gkey("小美")].in_own_ring is False
            clock.advance(3000)
            s3.send_json({"type": "soccer_pos", "x": 0, "y": y, "z": -gz, "yaw": 0})
            tick(client)
            assert soccer.foul_count == 2
            assert soccer.status == "penalty"


def test_三局兩勝與局間休息(
    client: TestClient, teacher_ticket: str, clock: FakeClock
) -> None:
    """連贏兩局就結束，中間有局間休息；休息中進球不算。"""
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

            _blue_goal(client, clock, s1)
            assert soccer.scores["blue"] == 1
            clock.advance(5_000)
            tick(client)
            assert soccer.status == "break" and soccer.sets == {"blue": 1, "red": 0}

            # 休息中穿環不算
            s1.send_json({"type": "soccer_goal"})
            settle(client)
            assert soccer.scores["blue"] == 1

            clock.advance(int(SOCCER_BREAK_SEC * 1000))
            tick(client)
            assert soccer.status == "running" and soccer.period == 2
            assert soccer.scores == {"blue": 0, "red": 0}
            assert soccer.players[_gkey("小明")].needs_return is False

            _blue_goal(client, clock, s1)
            clock.advance(5_000)
            tick(client)
            end = recv_until(t, "soccer_end")
            assert end["reason"] == "sets"
            assert end["winner"] == "blue"
            assert end["match"]["sets"] == {"blue": 2, "red": 0}
            assert soccer.status == "done"
            assert soccer.period == 2  # 兩勝即止，不打第三局


def _play_scoreless_period(client: TestClient, clock: FakeClock) -> None:
    clock.advance(5_000)
    tick(client)


def test_平手黃金進球(
    client: TestClient, teacher_ticket: str, clock: FakeClock
) -> None:
    """三節都沒人進球 → 黃金進球；先進球的隊直接贏。"""
    soccer = client.app.state.soccer
    with teacher_connect(client, teacher_ticket) as t:
        recv_until(t, "student_list")
        with client.websocket_connect("/") as s1, client.websocket_connect("/") as s2:
            _register(s1, t, "小明")
            _register(s2, t, "小華")
            _join_soccer(s1)
            _join_soccer(s2)
            t.send_json({
                "type": "soccer_start",
                "durationSec": 5,
                "mode": "striker",
                "tieBreak": "golden_then_pk",
            })
            _countdown_to_go(client, clock, s1)

            _play_scoreless_period(client, clock)
            assert soccer.status == "break"
            clock.advance(int(SOCCER_BREAK_SEC * 1000))
            tick(client)
            _play_scoreless_period(client, clock)
            assert soccer.status == "break" and soccer.sets == {"blue": 0, "red": 0}
            clock.advance(int(SOCCER_BREAK_SEC * 1000))
            tick(client)
            assert soccer.period == 3
            _play_scoreless_period(client, clock)
            assert soccer.status == "golden"
            assert soccer.scores == {"blue": 0, "red": 0}

            _blue_goal(client, clock, s1)
            end = recv_until(s1, "soccer_end")
            assert end["reason"] == "golden" and end["winner"] == "blue"
            assert soccer.status == "done"


def test_平手預設先PK再黃金(
    client: TestClient, teacher_ticket: str, clock: FakeClock
) -> None:
    """預設照 WDSC：三局打完局數相同先各罰 3 球。藍隊三輪都進、紅隊沒進 → 藍勝，不進黃金。"""
    soccer = client.app.state.soccer
    soccer._rng.seed(1)
    with teacher_connect(client, teacher_ticket) as t:
        recv_until(t, "student_list")
        with client.websocket_connect("/") as s1, client.websocket_connect("/") as s2:
            _register(s1, t, "小明")  # 藍前鋒
            _register(s2, t, "小華")  # 紅前鋒
            _join_soccer(s1)
            _join_soccer(s2)
            t.send_json({"type": "soccer_start", "durationSec": 5, "mode": "striker"})
            _countdown_to_go(client, clock, s1)
            for i in range(3):
                _play_scoreless_period(client, clock)
                if i < 2:
                    clock.advance(int(SOCCER_BREAK_SEC * 1000))
                    tick(client)
            assert soccer.status == "pk"
            assert soccer.pk_round == 1
            assert soccer.pk_first in ("blue", "red")
            assert soccer.pk_turn == soccer.pk_first
            assert soccer.pk_defender_id in ("s1", "s2")
            assert soccer.end_time == int(clock.ms + PENALTY_SEC * 1000)
            sockets = {"blue": s1, "red": s2}
            sign = {"blue": 1, "red": -1}

            for rnd in range(1, SOCCER_PK_MIN_ROUNDS + 1):
                first = soccer.pk_first
                assert soccer.pk_turn == first
                assert soccer.pk_shooter_id == ("s1" if first == "blue" else "s2")
                y, gz, z0, z1 = f9a_cross()
                shooter = sockets[first]
                clock.advance(400)
                shooter.send_json(
                    {"type": "soccer_pos", "x": 0, "y": y, "z": sign[first] * z0, "yaw": 0}
                )
                settle(client)
                clock.advance(400)
                shooter.send_json(
                    {"type": "soccer_pos", "x": 0, "y": y, "z": sign[first] * z1, "yaw": 0}
                )
                shooter.send_json({"type": "soccer_goal"})
                settle(client)
                assert soccer.pk_scores[first] == rnd
                other = "red" if first == "blue" else "blue"
                assert soccer.pk_turn == other
                clock.advance(int(PENALTY_SEC * 1000))
                tick(client)
            end = recv_until(t, "soccer_end")
            assert end["reason"] == "pk"
            assert end["winner"] == soccer.pk_first
            assert soccer.status == "done"
            assert gz > 0


def test_尺寸只在F9A預設_B組可切換() -> None:
    """F9A-A／F9A-B 的數字只從 soccer_presets 來，dataclass 不再自帶一份。"""
    a = SoccerField.from_spec(F9A_A)
    assert a.goal_r == pytest.approx(0.30)
    assert a.goal_tube == pytest.approx(0.10)
    assert a.goal_r + a.goal_tube * 2 == pytest.approx(0.50)
    assert a.goal_inset == pytest.approx(1.5)
    assert a.goal_z == pytest.approx(5.5)
    assert a.goal_y == pytest.approx(3.30)
    assert a.shield_r == pytest.approx(0.20)
    assert (a.half_x * 2, a.half_z * 2, a.ceil) == (7, 14, 5)

    b = SoccerField.from_settings(Settings(soccer_class="F9A-B"))
    assert (b.half_z * 2, b.half_x * 2, b.ceil) == (6, 3, 3)
    assert b.goal_r == pytest.approx(F9A_B.goal_r) == pytest.approx(0.20)
    assert b.goal_r + b.goal_tube * 2 == pytest.approx(0.35)
    assert F9A_B.thickness_max == pytest.approx(0.10)
    assert b.goal_inset == pytest.approx(1.0)
    assert b.goal_z == pytest.approx(2.0)
    assert b.goal_y == pytest.approx(2.20)
    assert b.shield_r == pytest.approx(0.10)
    assert b.start_depth == pytest.approx(1.0)
    assert b.max_players == 3
    assert a.start_depth == pytest.approx(1.5)
    assert a.max_players == 5
    assert a.start_width(2) == pytest.approx(0.8)
    assert "shieldR" in b.payload()
    assert b.payload()["startDepth"] == pytest.approx(1.0)
