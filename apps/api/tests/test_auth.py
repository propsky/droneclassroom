"""教師認證（POST /auth/teacher + /teacher WS ticket）與 Origin 白名單測試。"""

import time

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.auth import (
    LOGIN_MAX_PER_MINUTE,
    WS_CLOSE_BAD_ORIGIN,
    WS_CLOSE_UNAUTHORIZED,
    TeacherAuth,
    generate_pin,
    origin_allowed,
)

TEACHER_PASSWORD = "test123"  # 與 conftest 的 client fixture 一致

# ---------- 登入 ----------


def test_登入成功_取得ticket與有效秒數(client: TestClient) -> None:
    r = client.post("/auth/teacher", json={"password": TEACHER_PASSWORD})
    assert r.status_code == 200
    body = r.json()
    assert body["expiresIn"] == 14400  # 預設 TICKET_TTL
    assert isinstance(body["ticket"], str) and "." in body["ticket"]


def test_登入失敗_密碼錯誤回401(client: TestClient) -> None:
    r = client.post("/auth/teacher", json={"password": "wrong"})
    assert r.status_code == 401


def test_登入限流_同IP每分鐘5次_第6次回429(client: TestClient) -> None:
    """前 5 次（不論對錯）照常處理，第 6 次起即使密碼正確也 429。"""
    for _ in range(LOGIN_MAX_PER_MINUTE):
        assert client.post("/auth/teacher", json={"password": "wrong"}).status_code == 401
    r = client.post("/auth/teacher", json={"password": TEACHER_PASSWORD})
    assert r.status_code == 429


# ---------- /teacher WS ticket ----------


def test_無ticket連teacher_收4401(client: TestClient) -> None:
    with client.websocket_connect("/teacher") as ws:
        with pytest.raises(WebSocketDisconnect) as exc:
            ws.receive_text()
        assert exc.value.code == WS_CLOSE_UNAUTHORIZED


def test_偽造ticket連teacher_收4401(client: TestClient) -> None:
    with client.websocket_connect("/teacher?ticket=MTc1MjAwMDAwMA.Zm9yZ2Vk") as ws:
        with pytest.raises(WebSocketDisconnect) as exc:
            ws.receive_text()
        assert exc.value.code == WS_CLOSE_UNAUTHORIZED


def test_過期ticket連teacher_收4401(client: TestClient) -> None:
    """用 server 的 secret 簽一張已過期的 ticket（簽章合法、時間不合法）。"""
    auth: TeacherAuth = client.app.state.auth
    expired = auth.issue_ticket(now=time.time() - auth.ttl - 10)
    with client.websocket_connect(f"/teacher?ticket={expired}") as ws:
        with pytest.raises(WebSocketDisconnect) as exc:
            ws.receive_text()
        assert exc.value.code == WS_CLOSE_UNAUTHORIZED


def test_有效ticket連teacher_收到student_list(client: TestClient, teacher_ticket: str) -> None:
    with client.websocket_connect(f"/teacher?ticket={teacher_ticket}") as ws:
        assert ws.receive_json() == {"type": "student_list", "students": []}


# ---------- Origin 白名單 ----------


def test_壞Origin_學生WS收4403(client: TestClient) -> None:
    headers = {"origin": "https://evil.example.com"}
    with client.websocket_connect("/", headers=headers) as ws:
        with pytest.raises(WebSocketDisconnect) as exc:
            ws.receive_text()
        assert exc.value.code == WS_CLOSE_BAD_ORIGIN


def test_壞Origin_老師WS收4403(client: TestClient, teacher_ticket: str) -> None:
    """Origin 檢查在 ticket 檢查之前：帶有效 ticket 也擋。"""
    headers = {"origin": "https://evil.example.com"}
    with client.websocket_connect(f"/teacher?ticket={teacher_ticket}", headers=headers) as ws:
        with pytest.raises(WebSocketDisconnect) as exc:
            ws.receive_text()
        assert exc.value.code == WS_CLOSE_BAD_ORIGIN


def test_壞Origin_登入回403(client: TestClient) -> None:
    r = client.post(
        "/auth/teacher",
        json={"password": TEACHER_PASSWORD},
        headers={"origin": "https://evil.example.com"},
    )
    assert r.status_code == 403


def test_無Origin_放行(client: TestClient) -> None:
    """curl / python 腳本等非瀏覽器工具沒有 Origin header → 一律放行。"""
    assert client.post("/auth/teacher", json={"password": TEACHER_PASSWORD}).status_code == 200
    with client.websocket_connect("/") as ws:  # TestClient 預設不帶 Origin
        assert ws.receive_json()["type"] == "welcome"


def test_私有網段Origin_放行(client: TestClient) -> None:
    """教室場景：學生瀏覽器用 LAN IP 開頁面 → Origin 是私有網段，刻意放行。"""
    for origin in ("http://192.168.1.201:3000", "http://10.0.0.5:5173", "http://172.16.0.9"):
        with client.websocket_connect("/", headers={"origin": origin}) as ws:
            assert ws.receive_json()["type"] == "welcome"


def test_同Host的Origin_放行(client: TestClient) -> None:
    with client.websocket_connect("/", headers={"origin": "http://testserver:9999"}) as ws:
        assert ws.receive_json()["type"] == "welcome"


# ---------- 單元測試（不經 HTTP）----------


def test_origin_allowed_規則() -> None:
    empty = frozenset()
    assert origin_allowed(None, "example.com", empty)  # 無 Origin 放行
    assert origin_allowed("http://localhost:5173", "example.com", empty)
    assert origin_allowed("http://127.0.0.1", "example.com", empty)
    assert origin_allowed("http://192.168.0.2:3000", "example.com", empty)
    assert origin_allowed("https://example.com:8443", "example.com:443", empty)  # 同 host 忽略 port
    assert not origin_allowed("https://evil.com", "example.com", empty)
    assert not origin_allowed("http://8.8.8.8", "example.com", empty)  # 公網 IP 不放行
    # ALLOWED_ORIGINS：完整 origin 或 hostname 皆可
    allowed = frozenset({"https://class.example.com"})
    assert origin_allowed("https://class.example.com", "other.host", allowed)
    assert origin_allowed("https://ok.example.com", "other.host", frozenset({"ok.example.com"}))


def test_ticket_簽發與驗證() -> None:
    auth = TeacherAuth(password="pw", ttl=60)
    ticket = auth.issue_ticket()
    assert auth.verify_ticket(ticket)
    assert not auth.verify_ticket(ticket + "x")  # 竄改簽章
    assert not auth.verify_ticket("garbage")  # 格式不對
    assert not auth.verify_ticket("")
    assert not auth.verify_ticket(auth.issue_ticket(now=time.time() - 120))  # 過期
    # 不同啟動（不同 secret）簽的 ticket 無效 —— 重啟即全失效
    other = TeacherAuth(password="pw", ttl=60)
    assert not other.verify_ticket(ticket)


def test_登入限流_視窗過後重新計數() -> None:
    auth = TeacherAuth(password="pw", ttl=60)
    for _ in range(LOGIN_MAX_PER_MINUTE):
        assert auth.allow_login_attempt("1.2.3.4", now=100.0)
    assert not auth.allow_login_attempt("1.2.3.4", now=100.0)
    assert auth.allow_login_attempt("5.6.7.8", now=100.0)  # 不同 IP 不受影響
    assert auth.allow_login_attempt("1.2.3.4", now=161.0)  # 60 秒後視窗歸零


def test_generate_pin_為6位數字() -> None:
    for _ in range(20):
        pin = generate_pin()
        assert len(pin) == 6 and pin.isdigit()


# ---------- 前後分離：萬用子網域 Origin 與 CORS ----------


def test_origin萬用子網域(client: TestClient) -> None:
    """`*.網域` 白名單項目：任何層級子網域放行、裸網域與無關網域照規則。"""
    from app.auth import origin_allowed

    extra = frozenset({"droneclassroom.pages.dev", "*.droneclassroom.pages.dev"})
    assert origin_allowed("https://droneclassroom.pages.dev", "api.x.com", extra)
    assert origin_allowed("https://abc123.droneclassroom.pages.dev", "api.x.com", extra)
    assert not origin_allowed("https://evil.example.com", "api.x.com", extra)
    assert not origin_allowed("https://droneclassroom.pages.dev.evil.com", "api.x.com", extra)


def test_cors_headers_for_allowed_origin() -> None:
    """設定 ALLOWED_ORIGINS 後，白名單來源的 REST 請求要拿到 CORS 許可 header。"""
    from app.config import Settings
    from app.main import create_app

    app = create_app(
        Settings(
            teacher_password="pw",
            game_tick_interval=0,
            allowed_origins="droneclassroom.pages.dev,*.droneclassroom.pages.dev",
        )
    )
    with TestClient(app) as c:
        r = c.get("/api/info", headers={"Origin": "https://droneclassroom.pages.dev"})
        assert r.headers.get("access-control-allow-origin") == "https://droneclassroom.pages.dev"
        r2 = c.get("/api/info", headers={"Origin": "https://xyz.droneclassroom.pages.dev"})
        assert r2.headers.get("access-control-allow-origin") == "https://xyz.droneclassroom.pages.dev"
        r3 = c.get("/api/info", headers={"Origin": "https://evil.example.com"})
        assert "access-control-allow-origin" not in r3.headers
