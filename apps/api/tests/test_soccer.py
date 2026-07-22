"""足球賽局測試 — 分隊平衡、前鋒保證 / 遞補、進球驗證、半場重置、倒數取消、勝負。

tick 相關流程全部用假時鐘（conftest.clock）＋ 手動 tick（conftest.tick），不 sleep。
"""

from fastapi.testclient import TestClient

from tests.conftest import FakeClock, recv_until, settle, tick


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
    with client.websocket_connect(f"/teacher?ticket={teacher_ticket}") as t:
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
            assert teams == {"s1": "blue", "s2": "red", "s3": "blue"}
            strikers = {pid for pid, p in soccer.players.items() if p.striker}
            assert strikers == {"s1", "s2"}  # 每隊恰一前鋒（第一人）


def test_老師手動分隊與指定前鋒(client: TestClient, teacher_ticket: str) -> None:
    """soccer_set_team 換隊（原隊 / 新隊都重新確保前鋒）；soccer_set_striker 指定。"""
    soccer = client.app.state.soccer
    with client.websocket_connect(f"/teacher?ticket={teacher_ticket}") as t:
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
            assert soccer.players["s3"].team == "red"
            assert soccer.players["s3"].striker is False
            assert soccer.players["s2"].striker is True
            # 指定 s3 為紅隊前鋒 → s2 卸下
            t.send_json({"type": "soccer_set_striker", "studentId": "s3"})
            settle(client)
            assert soccer.players["s3"].striker is True
            assert soccer.players["s2"].striker is False


def test_striker模式進球驗證與半場重置與勝負(
    client: TestClient, teacher_ticket: str, clock: FakeClock
) -> None:
    """striker 模式（回歸保護）：前鋒 + armed + 位置在門環內才得分；
    進球後回自家半場恢復 armed；時間到判勝。場地常數依新設定換算（20×40、門高 4.5）。"""
    soccer = client.app.state.soccer
    with client.websocket_connect(f"/teacher?ticket={teacher_ticket}") as t:
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
            # 場地資料驅動下發（新常數：halfX=10、halfZ=20、goalY=4.5、goalR=3、ceil=15）
            assert go["field"] == {
                "halfX": 10.0,
                "halfZ": 20.0,
                "goalY": 4.5,
                "goalR": 3.0,
                "ceil": 15.0,
            }
            # 出生點：前鋒居中 x≈0、z = 站位端（±halfZ）× 0.85
            spawns = {sp["id"]: sp for sp in go["spawns"]}
            assert spawns["s1"] == {"id": "s1", "x": 0.0, "z": -17.0}  # 藍前鋒
            assert spawns["s2"] == {"id": "s2", "x": 0.0, "z": 17.0}  # 紅前鋒
            assert spawns["s3"]["x"] == -5.0  # 藍防守沿 x 排開（halfX×0.5）
            assert go["endTime"] == int(clock.ms + 40_000)

            # 藍隊前鋒飛到對方門環（attackGoalZ=+20, goalY=4.5）→ 進球
            s1.send_json({"type": "soccer_pos", "x": 0, "y": 4.5, "z": 20, "yaw": 0})
            s1.send_json({"type": "soccer_goal"})
            ok = recv_until(s1, "soccer_goal_ok")
            assert ok["team"] == "blue" and ok["scores"] == {"blue": 1, "red": 0}
            assert soccer.armed["blue"] is False
            # 消化進球後的 soccer_scores（armed=False），下面才能等到恢復 armed 的那則
            assert recv_until(s1, "soccer_scores")["armed"]["blue"] is False

            # 未 armed 再宣告 → 不算
            s1.send_json({"type": "soccer_goal"})
            settle(client)
            assert soccer.scores["blue"] == 1

            # 非前鋒在門環內宣告 → 不算
            clock.advance(3000)
            s3.send_json({"type": "soccer_pos", "x": 0, "y": 4.5, "z": 20, "yaw": 0})
            s3.send_json({"type": "soccer_goal"})
            settle(client)
            assert soccer.scores["blue"] == 1

            # 位置不在門環 → 不算（紅隊前鋒 armed 但人在原點）
            s2.send_json({"type": "soccer_goal"})
            settle(client)
            assert soccer.scores["red"] == 0

            # 半場重置：藍前鋒回自家半場（z<0）→ tick 恢復 armed
            clock.advance(3000)  # 拉開回報間隔，位移 ~25 單位不觸發超速（≈8.4 單位/秒）
            s1.send_json({"type": "soccer_pos", "x": 0, "y": 2, "z": -5, "yaw": 0})
            tick(client)
            assert soccer.armed["blue"] is True
            assert recv_until(s1, "soccer_scores")["armed"]["blue"] is True

            # 時間到 → 藍勝（老師端也收到）
            clock.advance(40_000)
            tick(client)
            end = recv_until(t, "soccer_end")
            assert end["winner"] == "blue" and end["scores"] == {"blue": 1, "red": 0}
            assert soccer.status == "done"  # 線上值沿用 legacy 'done'


def test_倒數中soccer_reset取消與重新分隊(
    client: TestClient, teacher_ticket: str, clock: FakeClock
) -> None:
    """soccer_reset 在倒數中 → 取消回 idle 不會 GO；clearTeams 交錯重新分隊。"""
    soccer = client.app.state.soccer
    with client.websocket_connect(f"/teacher?ticket={teacher_ticket}") as t:
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
    """前鋒斷線 → 同隊遞補；soccer_leave 後重新加入沿用原隊。

    連線順序決定 id：s_stay 先連（s1）、s_leave 後連（s2）。
    """
    soccer = client.app.state.soccer
    with client.websocket_connect(f"/teacher?ticket={teacher_ticket}") as t:
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
                assert soccer.players["s1"].team == "blue"
                assert soccer.players["s1"].striker is False
                assert soccer.players["s2"].striker is True
            # s2（前鋒）斷線 → 整筆移除、s1 遞補藍隊前鋒
            recv_until(t, "student_list")
            assert "s2" not in soccer.players
            assert soccer.players["s1"].striker is True

            # soccer_leave：隊伍保留，重新加入回原隊
            s_stay.send_json({"type": "soccer_leave"})
            settle(client)
            assert soccer.players["s1"].active is False
            s_stay.send_json({"type": "soccer_join"})
            recv_until(s_stay, "soccer_state")
            assert soccer.players["s1"].team == "blue"


def test_與大亂鬥互斥(client: TestClient, teacher_ticket: str) -> None:
    """soccer_join 會退出大亂鬥；arena_join 會退出足球（雙向互斥）。"""
    arena = client.app.state.arena
    soccer = client.app.state.soccer
    with client.websocket_connect(f"/teacher?ticket={teacher_ticket}") as t:
        recv_until(t, "student_list")
        with client.websocket_connect("/") as s:
            _register(s, t, "小明")
            s.send_json({"type": "arena_join"})
            recv_until(s, "arena_state")
            s.send_json({"type": "soccer_join"})
            recv_until(s, "soccer_state")
            assert arena.players["s1"].active is False
            assert soccer.players["s1"].active is True
            s.send_json({"type": "arena_join"})
            recv_until(s, "arena_state")
            assert soccer.players["s1"].active is False
            assert arena.players["s1"].active is True
