"""位置級防作弊測試 — 邊界 clamp、超速 strike 累積 → suspect、pop 距離驗證。

（arena_pop 距離驗證的丟棄行為已在 test_arena 的完整流程覆蓋，這裡補 strike 累積面。）
"""

import math

from fastapi.testclient import TestClient

from app.games.base import SPEED_LIMIT, STRIKE_SUSPECT_LIMIT
from tests.conftest import FakeClock, recv_until, settle

# 模組層 sanity check：速度上限 = 12 單位/秒 × 1.5 裕度（門檻改了這裡會先叫）
assert SPEED_LIMIT == 18.0


def _register_and_join(ws, t, name: str, game: str) -> None:
    ws.receive_json()  # welcome
    recv_until(t, "student_list")
    ws.send_json({"type": "register", "name": name, "emoji": "🐱"})
    recv_until(t, "student_list")
    ws.send_json({"type": f"{game}_join"})
    recv_until(ws, f"{game}_state")


def test_arena座標clamp到場地邊界(client: TestClient, teacher_ticket: str) -> None:
    """超界座標不丟棄、用 clamp 值（x/z ±22、y 0~20）。"""
    arena = client.app.state.arena
    with client.websocket_connect(f"/teacher?ticket={teacher_ticket}") as t:
        recv_until(t, "student_list")
        with client.websocket_connect("/") as s:
            _register_and_join(s, t, "小明", "arena")
            s.send_json({"type": "arena_pos", "x": 100, "y": 50, "z": -100, "yaw": 1.5})
            settle(client)
            p = arena.players["s1"]
            assert (p.x, p.y, p.z, p.yaw) == (22.0, 20.0, -22.0, 1.5)


def test_soccer座標clamp到場地邊界(client: TestClient, teacher_ticket: str) -> None:
    """足球場地邊界隨設定換算（預設 x ±10、z ±20、y 0~15）。"""
    soccer = client.app.state.soccer
    f = soccer.field
    with client.websocket_connect(f"/teacher?ticket={teacher_ticket}") as t:
        recv_until(t, "student_list")
        with client.websocket_connect("/") as s:
            _register_and_join(s, t, "小明", "soccer")
            s.send_json({"type": "soccer_pos", "x": -100, "y": 99, "z": 100, "yaw": 0})
            settle(client)
            p = soccer.players["s1"]
            assert (p.x, p.y, p.z) == (-f.half_x, f.ceil, f.half_z) == (-10.0, 15.0, 20.0)


def test_超速回報忽略且strike累積標suspect(
    client: TestClient, teacher_ticket: str, clock: FakeClock
) -> None:
    """瞬移回報被忽略（位置不動）；累積 5 次 strike → roster 標 suspect、老師即時收到。"""
    arena = client.app.state.arena
    with client.websocket_connect(f"/teacher?ticket={teacher_ticket}") as t:
        recv_until(t, "student_list")
        with client.websocket_connect("/") as s:
            _register_and_join(s, t, "小明", "arena")
            # 第一筆回報不測速（基準點）
            s.send_json({"type": "arena_pos", "x": 0, "y": 0.4, "z": 0, "yaw": 0})
            settle(client)
            p = arena.players["s1"]
            assert p.last_pos_ms is not None

            # 連續 5 次「100ms 內瞬移 22 單位」（220 單位/秒 >> 18）→ 全部忽略 + strike
            for i in range(STRIKE_SUSPECT_LIMIT):
                clock.advance(100)
                s.send_json({"type": "arena_pos", "x": 22, "y": 0.4, "z": 0, "yaw": 0})
                settle(client)
                assert p.x == 0.0  # 更新被忽略，位置停在原點
                assert p.strikes == i + 1

            # 第 5 次觸發 suspect：老師立即收到 student_update
            upd = recv_until(t, "student_update")
            assert upd["student"]["name"] == "小明"
            assert upd["student"]["suspect"] is True

            # 正常速度的回報照常接受（不因 suspect 阻擋 —— 標記不阻擋）
            clock.advance(2000)
            s.send_json({"type": "arena_pos", "x": 5, "y": 0.4, "z": 0, "yaw": 0})
            settle(client)
            assert p.x == 5.0


def test_合法移動不記strike(client: TestClient, teacher_ticket: str, clock: FakeClock) -> None:
    """接近極速（9 單位/秒）但在上限（18）內的移動不觸發 strike。"""
    arena = client.app.state.arena
    with client.websocket_connect(f"/teacher?ticket={teacher_ticket}") as t:
        recv_until(t, "student_list")
        with client.websocket_connect("/") as s:
            _register_and_join(s, t, "小明", "arena")
            s.send_json({"type": "arena_pos", "x": 0, "y": 0.4, "z": 0, "yaw": 0})
            settle(client)
            x = 0.0
            for _ in range(10):
                clock.advance(100)
                x += 0.9  # 0.9 單位 / 100ms = 9 單位/秒（合法極速）
                s.send_json({"type": "arena_pos", "x": x, "y": 0.4, "z": 0, "yaw": 0})
                settle(client)  # 每筆在各自的（假）時間點被處理，dt 才是 100ms
            p = arena.players["s1"]
            assert p.strikes == 0
            assert p.x == x


def test_pop距離驗證strike(client: TestClient, teacher_ticket: str, clock: FakeClock) -> None:
    """沒回報過位置（原點）就宣稱戳到遠處氣球 → 丟棄 + strike，分數不變。"""
    arena = client.app.state.arena
    with client.websocket_connect(f"/teacher?ticket={teacher_ticket}") as t:
        recv_until(t, "student_list")
        with client.websocket_connect("/") as s:
            _register_and_join(s, t, "小明", "arena")
            t.send_json({"type": "arena_start", "durationSec": 30, "mode": "balloon"})
            snap = recv_until(s, "arena_state")
            for _ in range(3):
                clock.advance(1000)
                client.portal.call(arena.tick)
            recv_until(s, "arena_go")
            far = next(
                b
                for b in snap["balloons"]
                if math.dist((0, 0.4, 0), (b["x"], b["y"], b["z"])) > 2.5
            )
            s.send_json({"type": "arena_pop", "id": far["id"]})
            settle(client)
            p = arena.players["s1"]
            assert p.strikes == 1
            assert p.score == 0
            assert arena.balloons[far["id"]].alive is True
