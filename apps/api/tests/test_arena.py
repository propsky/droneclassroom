"""大亂鬥賽局測試 — join→start→倒數→pop→重生→時間到 end、tag 抓捕、倒數中 reset 取消。

tick 相關流程全部用假時鐘（conftest.clock）＋ 手動 tick（conftest.tick），不 sleep。
"""

import math

from fastapi.testclient import TestClient

from tests.conftest import FakeClock, recv_until, settle, tick


def _register(ws, t, name: str) -> None:
    """學生註冊並消化老師端對應的名冊訊息。"""
    ws.receive_json()  # welcome
    recv_until(t, "student_list")  # 連上的名冊
    ws.send_json({"type": "register", "name": name, "emoji": "🐱"})
    recv_until(t, "student_list")  # 註冊後名冊


def _join_arena(ws) -> dict:
    """加入大亂鬥並回傳收到的 arena_state 快照。"""
    ws.send_json({"type": "arena_join"})
    return recv_until(ws, "arena_state")


def _countdown_to_go(client: TestClient, clock: FakeClock, ws) -> dict:
    """吃完 3-2-1 倒數（推進假時鐘＋手動 tick），回傳 arena_go。"""
    assert recv_until(ws, "arena_countdown")["n"] == 3
    clock.advance(1000)
    tick(client)
    assert recv_until(ws, "arena_countdown")["n"] == 2
    clock.advance(1000)
    tick(client)
    assert recv_until(ws, "arena_countdown")["n"] == 1
    clock.advance(1000)
    tick(client)
    return recv_until(ws, "arena_go")


def test_balloon完整流程(client: TestClient, teacher_ticket: str, clock: FakeClock) -> None:
    """join → start → 倒數 → 合法 pop / 超距 pop 丟棄 → 氣球重生 → 時間到 end。"""
    arena = client.app.state.arena
    with client.websocket_connect(f"/teacher?ticket={teacher_ticket}") as t:
        recv_until(t, "student_list")
        with client.websocket_connect("/") as s1, client.websocket_connect("/") as s2:
            _register(s1, t, "小明")
            _register(s2, t, "小華")
            _join_arena(s1)
            _join_arena(s2)

            t.send_json({"type": "arena_start", "durationSec": 40, "mode": "balloon"})
            snap = recv_until(s1, "arena_state")
            assert snap["status"] == "countdown"
            assert len(snap["balloons"]) == 50
            # 出生點散佈在圓上（2 人 → 半徑 9 + 2×0.6 = 10.2）
            spawn = snap["spawns"][0]
            assert math.hypot(spawn["x"], spawn["z"]) == round(10.2, 2)

            go = _countdown_to_go(client, clock, s1)
            assert go["endTime"] == int(clock.ms + 40_000)
            recv_until(s2, "arena_go")

            # 合法 pop：先回報貼近氣球 0 的位置
            b0 = snap["balloons"][0]
            s1.send_json(
                {"type": "arena_pos", "x": b0["x"], "y": b0["y"], "z": b0["z"], "yaw": 0}
            )
            s1.send_json({"type": "arena_pop", "id": 0})
            popped = recv_until(s1, "arena_balloon")
            assert popped == {"type": "arena_balloon", "id": 0, "alive": False}
            assert arena.players["s1"].score == 1  # 收到 arena_balloon = pop 已處理完

            # 超距 pop：挑一顆離目前位置 > 2.5 的氣球 → 丟棄 + strike，氣球不消
            far = next(
                b
                for b in snap["balloons"][1:]
                if math.dist((b0["x"], b0["y"], b0["z"]), (b["x"], b["y"], b["z"])) > 2.5
            )
            s1.send_json({"type": "arena_pop", "id": far["id"]})
            settle(client)
            assert arena.balloons[far["id"]].alive is True
            assert arena.players["s1"].strikes == 1
            assert arena.players["s1"].score == 1  # 分數沒被加

            # 氣球重生：2.5 秒後 tick → 廣播新位置
            clock.advance(2500)
            tick(client)
            reborn = recv_until(s1, "arena_balloon")
            assert reborn["id"] == 0 and reborn["alive"] is True and "x" in reborn

            # 時間到 → arena_end（學生與老師都收到）
            clock.advance(40_000)
            tick(client)
            end = recv_until(s1, "arena_end")
            assert end["winner"] == "time"
            assert end["ranking"][0]["name"] == "小明"
            assert recv_until(t, "arena_end")["winner"] == "time"
            assert arena.status == "ended"


def test_tag抓捕與respawn與勝負(client: TestClient, teacher_ticket: str, clock: FakeClock) -> None:
    """tag：GO 指派鬼 → 碰撞抓捕（stun + respawn + 鬼得分）→ 無敵不重複抓 → 鬼隊達標勝。"""
    arena = client.app.state.arena
    with client.websocket_connect(f"/teacher?ticket={teacher_ticket}") as t:
        recv_until(t, "student_list")
        with client.websocket_connect("/") as s1, client.websocket_connect("/") as s2:
            _register(s1, t, "小明")
            _register(s2, t, "小華")
            _join_arena(s1)
            _join_arena(s2)

            t.send_json(
                {"type": "arena_start", "durationSec": 60, "mode": "tag", "ghostCount": 1}
            )
            go = _countdown_to_go(client, clock, s1)
            roles = {p["id"]: p["role"] for p in go["players"]}
            assert sorted(roles.values()) == ["ghost", "runner"]
            ghost_id = next(i for i, r in roles.items() if r == "ghost")
            runner_id = next(i for i, r in roles.items() if r == "runner")
            runner_ws = s1 if runner_id == "s1" else s2

            # 兩人都在原點（距離 0 < 2.2）→ 第一個 tick 就抓到
            tick(client)
            caught = recv_until(runner_ws, "arena_caught")
            assert caught["id"] == runner_id and caught["by"] == ghost_id
            respawn = recv_until(runner_ws, "arena_respawn")
            assert respawn["stunMs"] == 3000 and respawn["invincibleMs"] == 2000
            assert arena.players[ghost_id].score == 1
            assert arena.players[runner_id].caught_count == 1

            # 暈眩 + 無敵（共 5 秒）內不會重複抓
            clock.advance(1000)
            tick(client)
            assert arena.players[ghost_id].score == 1

            # 無敵結束 → 再抓 2 次，總抓捕 3 ≥ 跑者 1 × 3 → 鬼隊勝
            clock.advance(4100)
            tick(client)
            assert arena.players[ghost_id].score == 2
            clock.advance(5100)
            tick(client)
            assert arena.players[ghost_id].score == 3
            clock.advance(60_000)
            tick(client)
            assert recv_until(t, "arena_end")["winner"] == "ghosts"


def test_tag時間到抓捕未達標_跑者勝(
    client: TestClient, teacher_ticket: str, clock: FakeClock
) -> None:
    """tag：時間到時總抓捕數未達門檻 → 跑者隊勝。"""
    with client.websocket_connect(f"/teacher?ticket={teacher_ticket}") as t:
        recv_until(t, "student_list")
        with client.websocket_connect("/") as s1, client.websocket_connect("/") as s2:
            _register(s1, t, "小明")
            _register(s2, t, "小華")
            _join_arena(s1)
            _join_arena(s2)
            t.send_json({"type": "arena_start", "durationSec": 60, "mode": "tag"})
            go = _countdown_to_go(client, clock, s1)
            runner_id = next(p["id"] for p in go["players"] if p["role"] == "runner")
            runner_ws = s1 if runner_id == "s1" else s2
            # 跑者立刻逃離原點（第一筆回報不測速），之後不再被抓
            runner_ws.send_json({"type": "arena_pos", "x": 20, "y": 5, "z": 20, "yaw": 0})
            tick(client)  # 距離 > 2.2 → 抓不到
            clock.advance(61_000)
            tick(client)
            assert recv_until(t, "arena_end")["winner"] == "runners"


def test_倒數中reset取消(client: TestClient, teacher_ticket: str, clock: FakeClock) -> None:
    """老師在 3-2-1 倒數中送 reset_all → 取消本場回 idle，之後不會 GO（legacy 沒做，補上）。"""
    arena = client.app.state.arena
    with client.websocket_connect(f"/teacher?ticket={teacher_ticket}") as t:
        recv_until(t, "student_list")
        with client.websocket_connect("/") as s:
            _register(s, t, "小明")
            _join_arena(s)
            t.send_json({"type": "arena_start", "durationSec": 40, "mode": "balloon"})
            assert recv_until(s, "arena_countdown")["n"] == 3

            t.send_json({"type": "broadcast", "payload": {"type": "reset_all"}})
            assert recv_until(s, "arena_state")["status"] == "idle"
            recv_until(s, "reset_all")  # reset_all 廣播照常送達學生

            clock.advance(5000)
            tick(client)
            assert arena.status == "idle"  # 沒有 GO


def test_老師state_req與leave斷線清理(client: TestClient, teacher_ticket: str) -> None:
    """arena_state_req 回快照；arena_leave 保留分數；斷線整筆移除。"""
    arena = client.app.state.arena
    with client.websocket_connect(f"/teacher?ticket={teacher_ticket}") as t:
        recv_until(t, "student_list")
        with client.websocket_connect("/") as s:
            _register(s, t, "小明")
            _join_arena(s)
            t.send_json({"type": "arena_state_req"})
            snap = recv_until(t, "arena_state")
            assert [p["name"] for p in snap["players"]] == ["小明"]

            arena.players["s1"].score = 7
            s.send_json({"type": "arena_leave"})
            settle(client)
            assert arena.players["s1"].active is False
            s.send_json({"type": "arena_join"})  # 重新加入 → 分數保留（legacy 行為）
            recv_until(s, "arena_state")
            assert arena.players["s1"].score == 7
        # 斷線 → 整筆移除
        recv_until(t, "student_list")
        assert "s1" not in arena.players
