"""關卡鎖定（lock_level）行為測試 — 廣播 / 伺服器記憶 / 遲到者補送 / 老師同步。"""

from fastapi.testclient import TestClient

from tests.conftest import recv_until


def test_lock廣播到學生並回送老師(client: TestClient, teacher_ticket: str) -> None:
    with client.websocket_connect(f"/teacher?ticket={teacher_ticket}") as t:
        recv_until(t, "student_list")
        with client.websocket_connect("/") as s:
            recv_until(s, "welcome")
            t.send_json({"type": "broadcast", "payload": {"type": "lock_level", "locked": True}})
            # 學生收到鎖定；老師收到回送（開關 UI 以伺服器為準）
            assert recv_until(s, "lock_level") == {"type": "lock_level", "locked": True}
            assert recv_until(t, "lock_level") == {"type": "lock_level", "locked": True}


def test_鎖定中遲到學生連上補送鎖定與課程關卡(client: TestClient, teacher_ticket: str) -> None:
    with client.websocket_connect(f"/teacher?ticket={teacher_ticket}") as t:
        recv_until(t, "student_list")
        t.send_json({"type": "broadcast", "payload": {"type": "load_level", "levelId": "1-3"}})
        t.send_json({"type": "broadcast", "payload": {"type": "lock_level", "locked": True}})
        recv_until(t, "lock_level")
        # 遲到學生：welcome 後緊接收到 lock_level + load_level（跟上全班進度）
        with client.websocket_connect("/") as s:
            recv_until(s, "welcome")
            assert recv_until(s, "lock_level") == {"type": "lock_level", "locked": True}
            assert recv_until(s, "load_level") == {"type": "load_level", "levelId": "1-3"}


def test_解除鎖定後遲到學生不再補送(client: TestClient, teacher_ticket: str) -> None:
    with client.websocket_connect(f"/teacher?ticket={teacher_ticket}") as t:
        recv_until(t, "student_list")
        t.send_json({"type": "broadcast", "payload": {"type": "lock_level", "locked": True}})
        t.send_json({"type": "broadcast", "payload": {"type": "lock_level", "locked": False}})
        recv_until(t, "lock_level")
        with client.websocket_connect("/") as s:
            msg = s.receive_json()
            assert msg["type"] == "welcome"
            # 未鎖定 → 沒有補送；下一則應是別的訊息（不會是 lock_level / load_level）。
            # 送一則 register 逼出 student 流程，確認中間沒有插入鎖定訊息
            s.send_json({"type": "register", "name": "小遲", "emoji": "🐢"})
            nxt = recv_until(t, "student_list")
            assert nxt["type"] == "student_list"
            assert client.app.state.roster.level_locked is False


def test_lock_level欄位型別不符整則丟棄(client: TestClient, teacher_ticket: str) -> None:
    with client.websocket_connect(f"/teacher?ticket={teacher_ticket}") as t:
        recv_until(t, "student_list")
        with client.websocket_connect("/") as s:
            recv_until(s, "welcome")
            # locked 不是 bool → strict 驗證失敗，整則丟棄
            t.send_json({"type": "broadcast", "payload": {"type": "lock_level", "locked": "yes"}})
            # 隨後合法訊息照常生效
            t.send_json({"type": "broadcast", "payload": {"type": "lock_level", "locked": True}})
            assert recv_until(s, "lock_level") == {"type": "lock_level", "locked": True}
            assert client.app.state.roster.level_locked is True


def test_鎖定中老師重連收到鎖定狀態(client: TestClient, teacher_ticket: str) -> None:
    with client.websocket_connect(f"/teacher?ticket={teacher_ticket}") as t:
        recv_until(t, "student_list")
        t.send_json({"type": "broadcast", "payload": {"type": "lock_level", "locked": True}})
        recv_until(t, "lock_level")
    # 老師重整 / 換裝置重連 → 名冊後補送鎖定狀態，開關 UI 同步
    with client.websocket_connect(f"/teacher?ticket={teacher_ticket}") as t2:
        recv_until(t2, "student_list")
        assert recv_until(t2, "lock_level") == {"type": "lock_level", "locked": True}


def test_race_start也記住課程關卡(client: TestClient, teacher_ticket: str) -> None:
    with client.websocket_connect(f"/teacher?ticket={teacher_ticket}") as t:
        recv_until(t, "student_list")
        t.send_json({"type": "broadcast", "payload": {"type": "race_start", "levelId": "1-4"}})
        t.send_json({"type": "broadcast", "payload": {"type": "lock_level", "locked": True}})
        recv_until(t, "lock_level")
        with client.websocket_connect("/") as s:
            recv_until(s, "welcome")
            recv_until(s, "lock_level")
            assert recv_until(s, "load_level") == {"type": "load_level", "levelId": "1-4"}
