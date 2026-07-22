"""防作弊標記測試 — 四種觸發條件 + 正常不觸發 + 重新 register 清除。

標記不阻擋：complete_level 照常記錄，只是 student_update / student_list
會帶 suspect=True 供老師後台顯示。
"""

from fastapi.testclient import TestClient

from app.roster import Roster, StudentRecord


def _register(ws, t, name: str = "小明") -> None:
    """學生註冊並消化老師端對應的名冊訊息。"""
    ws.receive_json()  # welcome
    t.receive_json()  # 連上的名冊
    ws.send_json({"type": "register", "name": name, "emoji": "🐱"})
    t.receive_json()  # 註冊後名冊


def _student_record(client: TestClient) -> StudentRecord:
    roster: Roster = client.app.state.roster
    return roster._students[0]  # noqa: SLF001 — 測試直接讀名冊內部狀態


def test_正常完成_不標記(client: TestClient, teacher_ticket: str) -> None:
    with client.websocket_connect(f"/teacher?ticket={teacher_ticket}") as t:
        t.receive_json()
        with client.websocket_connect("/") as s:
            _register(s, t)
            s.send_json({"type": "progress", "levelId": "1-1"})
            t.receive_json()
            s.send_json({"type": "complete_level", "levelId": "1-1", "timeMs": 5000})
            upd = t.receive_json()
            assert upd["student"]["suspect"] is False


def test_沒有progress就complete_標記(client: TestClient, teacher_ticket: str) -> None:
    """正常 client 一定先發 progress；直接 complete = 偽造訊息。"""
    with client.websocket_connect(f"/teacher?ticket={teacher_ticket}") as t:
        t.receive_json()
        with client.websocket_connect("/") as s:
            _register(s, t)
            s.send_json({"type": "complete_level", "levelId": "1-1", "timeMs": 30000})
            upd = t.receive_json()
            assert upd["student"]["suspect"] is True


def test_用時小於1秒_標記(client: TestClient, teacher_ticket: str) -> None:
    with client.websocket_connect(f"/teacher?ticket={teacher_ticket}") as t:
        t.receive_json()
        with client.websocket_connect("/") as s:
            _register(s, t)
            s.send_json({"type": "progress", "levelId": "1-1"})
            t.receive_json()
            s.send_json({"type": "complete_level", "levelId": "1-1", "timeMs": 500})
            upd = t.receive_json()
            assert upd["student"]["suspect"] is True


def test_宣稱用時遠小於伺服器觀察_標記(client: TestClient, teacher_ticket: str) -> None:
    """把伺服器記的開始時間倒退 100 秒：宣稱 5 秒 < 100 秒的一半 - 2 秒 → 可疑。"""
    with client.websocket_connect(f"/teacher?ticket={teacher_ticket}") as t:
        t.receive_json()
        with client.websocket_connect("/") as s:
            _register(s, t)
            s.send_json({"type": "progress", "levelId": "1-1"})
            t.receive_json()
            _student_record(client).level_started_at["1-1"] -= 100.0
            s.send_json({"type": "complete_level", "levelId": "1-1", "timeMs": 5000})
            upd = t.receive_json()
            assert upd["student"]["suspect"] is True


def test_宣稱用時與伺服器觀察相符_不標記(client: TestClient, teacher_ticket: str) -> None:
    """觀察 100 秒、宣稱 100 秒（甚至 60 秒）都在容忍範圍內。"""
    with client.websocket_connect(f"/teacher?ticket={teacher_ticket}") as t:
        t.receive_json()
        with client.websocket_connect("/") as s:
            _register(s, t)
            s.send_json({"type": "progress", "levelId": "1-1"})
            t.receive_json()
            _student_record(client).level_started_at["1-1"] -= 100.0
            s.send_json({"type": "complete_level", "levelId": "1-1", "timeMs": 60000})
            upd = t.receive_json()
            assert upd["student"]["suspect"] is False


def test_未知關卡_標記(client: TestClient, teacher_ticket: str) -> None:
    with client.websocket_connect(f"/teacher?ticket={teacher_ticket}") as t:
        t.receive_json()
        with client.websocket_connect("/") as s:
            _register(s, t)
            s.send_json({"type": "progress", "levelId": "9-9"})
            t.receive_json()
            s.send_json({"type": "complete_level", "levelId": "9-9", "timeMs": 30000})
            upd = t.receive_json()
            assert upd["student"]["suspect"] is True


def test_標記不因重新register洗白(client: TestClient, teacher_ticket: str) -> None:
    """一旦 suspect 就跟著這個名字走：正常完成、重新 register、同名重連都不洗白
    （否則學生重整頁面即可清除標記）。清除只能靠老師人工處置後重啟伺服器。"""
    with client.websocket_connect(f"/teacher?ticket={teacher_ticket}") as t:
        t.receive_json()
        with client.websocket_connect("/") as s:
            _register(s, t)
            s.send_json({"type": "complete_level", "levelId": "1-1", "timeMs": 30000})
            assert t.receive_json()["student"]["suspect"] is True

            # 之後正常完成一關，標記仍在
            s.send_json({"type": "progress", "levelId": "1-2"})
            assert t.receive_json()["student"]["suspect"] is True
            s.send_json({"type": "complete_level", "levelId": "1-2", "timeMs": 20000})
            assert t.receive_json()["student"]["suspect"] is True

            # 同一連線重新 register → 標記仍在
            s.send_json({"type": "register", "name": "小明", "emoji": "🐱"})
            lst = t.receive_json()
            assert lst["students"][0]["suspect"] is True

        # 斷線後同名新連線（模擬重整頁面）→ 繼承標記
        with client.websocket_connect("/") as s2:
            s2.receive_json()
            s2.send_json({"type": "register", "name": "小明", "emoji": "🐱"})
            lst = t.receive_json()
            target = [x for x in lst["students"] if x["name"] == "小明"]
            assert target and target[0]["suspect"] is True
