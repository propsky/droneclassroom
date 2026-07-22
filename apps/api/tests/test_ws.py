"""WS 行為測試 — 對齊 apps/server（Node 版）的協定行為。

老師 WS 需帶有效 ticket（teacher_ticket fixture 先登入取得）。
"""

import json

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.ws import MAX_MESSAGES_PER_SEC, RateLimiter

# ---------- welcome ----------


def test_welcome_遞增配發id(client: TestClient) -> None:
    """學生連上（/ 或 /ws）立刻收到 welcome，id 為 s<n> 遞增。"""
    with client.websocket_connect("/") as ws1:
        assert ws1.receive_json() == {"type": "welcome", "id": "s1"}
        with client.websocket_connect("/ws") as ws2:
            assert ws2.receive_json() == {"type": "welcome", "id": "s2"}


# ---------- register → student_list ----------


def test_register_老師收到更新後的名冊(client: TestClient, teacher_ticket: str) -> None:
    with client.websocket_connect(f"/teacher?ticket={teacher_ticket}") as t:
        assert t.receive_json() == {"type": "student_list", "students": []}
        with client.websocket_connect("/") as s:
            s.receive_json()  # welcome

            # 學生連上（尚未註冊）→ 老師先收一次名冊
            lst = t.receive_json()
            assert lst["type"] == "student_list"
            assert lst["students"][0]["name"] == "?"

            s.send_json({"type": "register", "name": "小明", "emoji": "🐱"})
            lst = t.receive_json()
            assert lst == {
                "type": "student_list",
                "students": [
                    {
                        "id": "s1",
                        "name": "小明",
                        "emoji": "🐱",
                        "connected": True,
                        "level": None,
                        "time": None,
                        "suspect": False,
                    }
                ],
            }


def test_register_欄位型別不符整則丟棄(client: TestClient, teacher_ticket: str) -> None:
    """name 不是字串 → 丟棄；隨後合法 register 正常生效。"""
    with client.websocket_connect(f"/teacher?ticket={teacher_ticket}") as t:
        t.receive_json()
        with client.websocket_connect("/") as s:
            s.receive_json()
            t.receive_json()  # 連上的名冊

            s.send_json({"type": "register", "name": 123, "emoji": "🐱"})  # 丟棄
            s.send_json({"type": "register", "name": "小華", "emoji": "🐶"})
            lst = t.receive_json()
            assert [x["name"] for x in lst["students"]] == ["小華"]


# ---------- progress / complete_level → student_update ----------


def test_progress與complete_level_老師收student_update(
    client: TestClient, teacher_ticket: str
) -> None:
    with client.websocket_connect(f"/teacher?ticket={teacher_ticket}") as t:
        t.receive_json()
        with client.websocket_connect("/") as s:
            s.receive_json()
            t.receive_json()  # 連上
            s.send_json({"type": "register", "name": "小明", "emoji": "🐱"})
            t.receive_json()  # 註冊後名冊

            s.send_json({"type": "progress", "levelId": "1-2"})
            assert t.receive_json() == {
                "type": "student_update",
                "student": {
                    "id": "s1",
                    "name": "小明",
                    "emoji": "🐱",
                    "level": "1-2",
                    "time": None,
                    "suspect": False,
                },
            }

            s.send_json({"type": "complete_level", "levelId": "1-2", "timeMs": 31500})
            upd = t.receive_json()
            assert upd["type"] == "student_update"
            assert upd["student"]["level"] == "1-2"
            assert upd["student"]["time"] == 31500
            assert upd["student"]["suspect"] is False


# ---------- 同名重連 ----------


def test_同名register_舊連線被踢4000且繼承進度(client: TestClient, teacher_ticket: str) -> None:
    with client.websocket_connect(f"/teacher?ticket={teacher_ticket}") as t:
        t.receive_json()  # 空名冊
        with client.websocket_connect("/") as ws1:
            ws1.receive_json()  # welcome s1
            t.receive_json()
            ws1.send_json({"type": "register", "name": "小明", "emoji": "🐱"})
            t.receive_json()
            ws1.send_json({"type": "progress", "levelId": "1-3"})
            t.receive_json()  # student_update
            ws1.send_json({"type": "complete_level", "levelId": "1-3", "timeMs": 42000})
            t.receive_json()  # student_update

            with client.websocket_connect("/") as ws2:
                ws2.receive_json()  # welcome s2
                t.receive_json()
                ws2.send_json({"type": "register", "name": "小明", "emoji": "🐱"})

                # 舊連線被以 close code 4000 踢下線
                with pytest.raises(WebSocketDisconnect) as exc:
                    ws1.receive_text()
                assert exc.value.code == 4000

                # 老師名冊只剩一位小明，且繼承舊進度
                lst = t.receive_json()
                assert lst["students"] == [
                    {
                        "id": "s2",
                        "name": "小明",
                        "emoji": "🐱",
                        "connected": True,
                        "level": "1-3",
                        "time": 42000,
                        "suspect": False,
                    }
                ]


def test_斷線後同名重連_繼承保留的名冊進度(client: TestClient, teacher_ticket: str) -> None:
    """學生斷線 → connected: False 保留名冊；重連 register 繼承後移除舊列。"""
    with client.websocket_connect(f"/teacher?ticket={teacher_ticket}") as t:
        t.receive_json()
        with client.websocket_connect("/") as ws1:
            ws1.receive_json()
            t.receive_json()
            ws1.send_json({"type": "register", "name": "小明", "emoji": "🐱"})
            t.receive_json()
            ws1.send_json({"type": "progress", "levelId": "1-5"})
            t.receive_json()
            ws1.send_json({"type": "complete_level", "levelId": "1-5", "timeMs": 60000})
            t.receive_json()

        # 斷線：名冊保留、標記離線
        lst = t.receive_json()
        assert lst["students"] == [
            {
                "id": "s1",
                "name": "小明",
                "emoji": "🐱",
                "connected": False,
                "level": "1-5",
                "time": 60000,
                "suspect": False,
            }
        ]

        with client.websocket_connect("/") as ws2:
            ws2.receive_json()
            t.receive_json()
            ws2.send_json({"type": "register", "name": "小明", "emoji": "🐱"})
            lst = t.receive_json()
            assert lst["students"] == [
                {
                    "id": "s2",
                    "name": "小明",
                    "emoji": "🐱",
                    "connected": True,
                    "level": "1-5",
                    "time": 60000,
                    "suspect": False,
                }
            ]


def test_未註冊學生斷線_直接移出名冊(client: TestClient, teacher_ticket: str) -> None:
    with client.websocket_connect(f"/teacher?ticket={teacher_ticket}") as t:
        t.receive_json()
        with client.websocket_connect("/") as s:
            s.receive_json()
            assert len(t.receive_json()["students"]) == 1
        assert t.receive_json() == {"type": "student_list", "students": []}


# ---------- 老師 broadcast 白名單 ----------


def test_broadcast_合法payload轉發全體學生(client: TestClient, teacher_ticket: str) -> None:
    with client.websocket_connect("/") as s:
        s.receive_json()
        with client.websocket_connect(f"/teacher?ticket={teacher_ticket}") as t:
            t.receive_json()
            t.send_json({"type": "broadcast", "payload": {"type": "load_level", "levelId": "1-2"}})
            assert s.receive_json() == {"type": "load_level", "levelId": "1-2"}

            t.send_json({"type": "broadcast", "payload": {"type": "reset_all"}})
            assert s.receive_json() == {"type": "reset_all"}

            t.send_json({"type": "broadcast", "payload": {"type": "show_message", "text": "加油"}})
            assert s.receive_json() == {"type": "show_message", "text": "加油"}


def test_broadcast_非法payload丟棄不轉發(client: TestClient, teacher_ticket: str) -> None:
    with client.websocket_connect("/") as s:
        s.receive_json()
        with client.websocket_connect(f"/teacher?ticket={teacher_ticket}") as t:
            t.receive_json()
            # payload.type 不在白名單 → 丟棄
            t.send_json({"type": "broadcast", "payload": {"type": "evil_exec", "code": "rm -rf"}})
            # 欄位型別不符（mode 非 manual/program）→ 丟棄
            t.send_json({"type": "broadcast", "payload": {"type": "set_mode", "mode": "hack"}})
            # 未知外層 type → 丟棄
            t.send_json({"type": "not_a_thing"})

            # 學生收到的下一則必須是後續這則合法廣播（前面全被丟棄）
            t.send_json({"type": "broadcast", "payload": {"type": "set_mode", "mode": "program"}})
            assert s.receive_json() == {"type": "set_mode", "mode": "program"}


# ---------- guards ----------


def test_超過4KB的訊息丟棄(client: TestClient, teacher_ticket: str) -> None:
    with client.websocket_connect(f"/teacher?ticket={teacher_ticket}") as t:
        t.receive_json()
        with client.websocket_connect("/") as s:
            s.receive_json()
            t.receive_json()

            big = json.dumps({"type": "register", "name": "X" * 5000, "emoji": "🐱"})
            assert len(big.encode()) > 4096
            s.send_text(big)  # 超過 4KB → 丟棄

            s.send_json({"type": "register", "name": "小華", "emoji": "🐶"})
            lst = t.receive_json()
            assert [x["name"] for x in lst["students"]] == ["小華"]


def test_非JSON與非法賽局訊息忽略不斷線(client: TestClient, teacher_ticket: str) -> None:
    with client.websocket_connect(f"/teacher?ticket={teacher_ticket}") as t:
        t.receive_json()
        with client.websocket_connect("/") as s:
            s.receive_json()
            t.receive_json()
            s.send_text("not json {{{")  # 非 JSON → 丟棄
            # 型別不符 → 丟棄
            s.send_json({"type": "arena_pos", "x": "瞬移", "y": 2, "z": 3, "yaw": 0})
            # 未加入足球 → 忽略
            s.send_json({"type": "soccer_pos", "x": 1, "y": 2, "z": 3, "yaw": 0})
            s.send_json({"type": "register", "name": "小明", "emoji": "🐱"})
            lst = t.receive_json()
            assert [x["name"] for x in lst["students"]] == ["小明"]


def test_速率限制_固定視窗每秒60則() -> None:
    """RateLimiter 單元測試（注入時間，不依賴實際時鐘）。"""
    rl = RateLimiter()
    allowed = [rl.allow(now=10.0) for _ in range(MAX_MESSAGES_PER_SEC + 10)]
    assert allowed.count(True) == MAX_MESSAGES_PER_SEC
    assert allowed[MAX_MESSAGES_PER_SEC] is False
    # 下一秒視窗歸零
    assert rl.allow(now=11.0) is True


def test_未知WS路徑_關閉1008(client: TestClient) -> None:
    with client.websocket_connect("/nope") as ws:
        with pytest.raises(WebSocketDisconnect) as exc:
            ws.receive_text()
        assert exc.value.code == 1008


# ---------- 靜態檔 ----------


def test_teacher頁面_回HTML且no_store(client: TestClient) -> None:
    r = client.get("/teacher")
    assert r.status_code == 200
    assert "<html" in r.text.lower() or "<!doctype" in r.text.lower()
    assert r.headers["cache-control"] == "no-store, no-cache, must-revalidate"


def test_首頁_服務static_dir的index(client: TestClient) -> None:
    r = client.get("/")
    assert r.status_code == 200
    assert "student" in r.text
    assert r.headers["cache-control"] == "no-store, no-cache, must-revalidate"


def test_路徑穿越_不得逃出static_dir(client: TestClient) -> None:
    r = client.get("/%2e%2e/%2e%2e/pyproject.toml")
    assert r.status_code == 404
