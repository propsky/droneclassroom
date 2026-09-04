"""老師帳號系統測試 — 註冊 / 登入 / DB session 滑動續期 / 登出 / 換密碼 / WS ticket。

需要真實 PostgreSQL（DATABASE_URL，環境變數或 apps/api/.env），沒設就 skip（無 DB 的 503
行為例外，用既有 client fixture）。端點會 commit，無法用 rollback 隔離 → 每個測試用唯一
email 前綴，結束時把建出的老師 / session / 稽核事件刪乾淨，不在 RDS 留垃圾。
"""

import asyncio
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from starlette.websockets import WebSocketDisconnect

from app.accounts import hash_password, token_hash, verify_password
from app.auth import WS_CLOSE_UNAUTHORIZED
from app.config import Settings
from app.db.models import AuditEvent, Session
from app.db.session import create_engine, create_sessionmaker
from app.main import create_app
from app.rest import DEV_TEACHER_EMAIL
from tests.conftest import teacher_connect
from tests.db_cleanup import cleanup_test_teachers

DATABASE_URL = Settings().database_url
needs_db = pytest.mark.skipif(not DATABASE_URL, reason="未設定 DATABASE_URL，略過真實資料庫測試")

EMAIL_DOMAIN = "accounts-test.invalid"
PASSWORD = "correct horse battery"


def _email(tag: str = "t") -> str:
    return f"{tag}-{uuid.uuid4().hex[:10]}@{EMAIL_DOMAIN}"


# ---------- 無 DB：帳號端點 503（既有無資料庫模式不壞）----------


def test_無資料庫_帳號端點回503(client: TestClient) -> None:
    body = {"email": "a@b.c", "password": "12345678", "name": "x"}
    assert client.post("/auth/teacher/register", json=body).status_code == 503
    assert client.post("/auth/teacher/login", json=body).status_code == 503
    auth = {"Authorization": "Bearer whatever"}
    assert client.get("/auth/teacher/me", headers=auth).status_code == 503
    assert client.post("/auth/teacher/logout", headers=auth).status_code == 503
    assert (
        client.post(
            "/auth/teacher/password",
            json={"currentPassword": "a", "newPassword": "b"},
            headers=auth,
        ).status_code
        == 503
    )


def test_密碼雜湊與比對() -> None:
    h = hash_password("s3cret-pass")
    assert h.startswith("$argon2id$")
    assert verify_password(h, "s3cret-pass")
    assert not verify_password(h, "wrong")
    assert not verify_password("not-a-hash", "s3cret-pass")


# ---------- 有 DB ----------


async def _cleanup(include_dev: bool = False) -> None:
    """刪掉測試建的老師及其 session / 稽核事件；include_dev 連免登入模式的 dev@local 一起清。"""
    assert DATABASE_URL
    await cleanup_test_teachers(DATABASE_URL, include_dev=include_dev, email_domain=EMAIL_DOMAIN)


@pytest.fixture
def db_client(tmp_path: Path) -> Iterator[TestClient]:
    """帶真實 DATABASE_URL 的 app；結束後清理測試資料。"""
    with _make_client(tmp_path) as c:
        yield c
    asyncio.run(_cleanup())


@contextmanager
def _make_client(tmp_path: Path, **overrides) -> Iterator[TestClient]:
    static_dir = tmp_path / "dist"
    static_dir.mkdir(exist_ok=True)
    settings = Settings(
        static_dir=static_dir,
        teacher_dist=tmp_path / "no-teacher-dist",
        teacher_password="test123",
        game_tick_interval=0,
        database_url=DATABASE_URL,
        **overrides,
    )
    with TestClient(create_app(settings)) as c:
        yield c


def _register(c: TestClient, email: str, password: str = PASSWORD, name: str = "王老師") -> dict:
    r = c.post(
        "/auth/teacher/register", json={"email": email, "password": password, "name": name}
    )
    assert r.status_code == 201, r.text
    return r.json()


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _session_row(token: str) -> Session:
    assert DATABASE_URL
    engine = create_engine(DATABASE_URL)
    maker = create_sessionmaker(engine)
    async with maker() as s:
        row = (
            await s.execute(select(Session).where(Session.token_hash == token_hash(token)))
        ).scalar_one()
    await engine.dispose()
    return row


async def _audit_events(event_type: str, actor_id: int | None = None) -> list[AuditEvent]:
    assert DATABASE_URL
    engine = create_engine(DATABASE_URL)
    maker = create_sessionmaker(engine)
    async with maker() as s:
        stmt = select(AuditEvent).where(AuditEvent.event_type == event_type)
        if actor_id is not None:
            stmt = stmt.where(AuditEvent.actor_id == actor_id)
        rows = (await s.execute(stmt)).scalars().all()
    await engine.dispose()
    return list(rows)


@needs_db
def test_註冊即登入_me通_重複email回409(db_client: TestClient) -> None:
    email = _email("Reg")
    body = _register(db_client, email.upper())  # 大小寫混合 → 正規化小寫
    assert body["expiresIn"] == 30 * 24 * 3600
    assert body["me"]["email"] == email.lower()
    assert body["me"]["name"] == "王老師"
    assert body["me"]["role"] == "teacher"
    assert body["me"]["orgName"] == "預設單位"
    token = body["ticket"]
    # token 明文不落 DB，只存 sha256
    row = asyncio.run(_session_row(token))
    assert row.principal_type == "teacher" and row.principal_id == body["me"]["id"]

    r = db_client.get("/auth/teacher/me", headers=_bearer(token))
    assert r.status_code == 200
    assert r.json() == body["me"]
    # 無 / 錯 token → 401
    assert db_client.get("/auth/teacher/me").status_code == 401
    assert db_client.get("/auth/teacher/me", headers=_bearer("nope")).status_code == 401
    # 重複 email（大小寫不同也算）→ 409
    r = db_client.post(
        "/auth/teacher/register", json={"email": email, "password": PASSWORD, "name": "B"}
    )
    assert r.status_code == 409
    # 稽核
    assert len(asyncio.run(_audit_events("teacher.register", body["me"]["id"]))) == 1


@needs_db
def test_註冊_密碼太短或email格式錯回422(db_client: TestClient) -> None:
    r = db_client.post(
        "/auth/teacher/register", json={"email": _email(), "password": "1234567", "name": "x"}
    )
    assert r.status_code == 422
    r = db_client.post(
        "/auth/teacher/register", json={"email": "no-at-sign", "password": PASSWORD, "name": "x"}
    )
    assert r.status_code == 422


@needs_db
def test_登入_錯密碼401且有login_failed稽核_正確密碼成功(db_client: TestClient) -> None:
    email = _email("login")
    me = _register(db_client, email)["me"]
    r = db_client.post("/auth/teacher/login", json={"email": email, "password": "wrong-pass"})
    assert r.status_code == 401
    # 不存在的帳號同樣 401（防枚舉）
    r = db_client.post(
        "/auth/teacher/login", json={"email": _email("ghost"), "password": "wrong-pass"}
    )
    assert r.status_code == 401
    failed = asyncio.run(_audit_events("teacher.login_failed", me["id"]))
    assert len(failed) == 1 and failed[0].payload["email"] == email
    # 正確密碼（email 大小寫不同也可）→ 發新 session
    r = db_client.post("/auth/teacher/login", json={"email": email.upper(), "password": PASSWORD})
    assert r.status_code == 200
    assert r.json()["me"]["id"] == me["id"]
    assert db_client.get("/auth/teacher/me", headers=_bearer(r.json()["ticket"])).status_code == 200
    assert len(asyncio.run(_audit_events("teacher.login", me["id"]))) == 1


@needs_db
def test_me滑動延長_節流300秒內不寫(db_client: TestClient) -> None:
    token = _register(db_client, _email("touch"))["ticket"]
    before = asyncio.run(_session_row(token))
    assert db_client.get("/auth/teacher/me", headers=_bearer(token)).status_code == 200
    after = asyncio.run(_session_row(token))
    # 剛發出不到 300 秒：不寫 DB
    assert after.expires_at == before.expires_at and after.last_seen_at == before.last_seen_at


@needs_db
def test_me滑動延長_超過節流間隔就延長(tmp_path: Path) -> None:
    with _make_client(tmp_path, session_touch_interval_sec=0) as c:
        token = _register(c, _email("slide"))["ticket"]
        before = asyncio.run(_session_row(token))
        assert c.get("/auth/teacher/me", headers=_bearer(token)).status_code == 200
        after = asyncio.run(_session_row(token))
        assert after.expires_at >= before.expires_at
        assert after.last_seen_at >= before.last_seen_at
        if after.last_seen_at == before.last_seen_at:
            assert after.expires_at > before.expires_at
    asyncio.run(_cleanup())


@needs_db
def test_logout後_me回401(db_client: TestClient) -> None:
    body = _register(db_client, _email("logout"))
    token = body["ticket"]
    r = db_client.post("/auth/teacher/logout", headers=_bearer(token))
    assert r.status_code == 200 and r.json() == {"ok": True}
    assert db_client.get("/auth/teacher/me", headers=_bearer(token)).status_code == 401
    assert db_client.post("/auth/teacher/logout", headers=_bearer(token)).status_code == 401
    assert asyncio.run(_session_row(token)).revoked_at is not None
    assert len(asyncio.run(_audit_events("teacher.logout", body["me"]["id"]))) == 1


@needs_db
def test_換密碼_其他session失效_當前仍通(db_client: TestClient) -> None:
    email = _email("pw")
    body = _register(db_client, email)
    token_a = body["ticket"]
    token_b = db_client.post(
        "/auth/teacher/login", json={"email": email, "password": PASSWORD}
    ).json()["ticket"]
    # 舊密碼錯 → 401、什麼都不變
    r = db_client.post(
        "/auth/teacher/password",
        json={"currentPassword": "wrong", "newPassword": "new-password-123"},
        headers=_bearer(token_a),
    )
    assert r.status_code == 401
    assert db_client.get("/auth/teacher/me", headers=_bearer(token_b)).status_code == 200
    # 新密碼太短 → 422
    r = db_client.post(
        "/auth/teacher/password",
        json={"currentPassword": PASSWORD, "newPassword": "short"},
        headers=_bearer(token_a),
    )
    assert r.status_code == 422
    # 成功：B 失效、A 仍通
    r = db_client.post(
        "/auth/teacher/password",
        json={"currentPassword": PASSWORD, "newPassword": "new-password-123"},
        headers=_bearer(token_a),
    )
    assert r.status_code == 200
    assert db_client.get("/auth/teacher/me", headers=_bearer(token_b)).status_code == 401
    assert db_client.get("/auth/teacher/me", headers=_bearer(token_a)).status_code == 200
    # 新密碼可登入、舊密碼不行
    login = {"email": email, "password": PASSWORD}
    assert db_client.post("/auth/teacher/login", json=login).status_code == 401
    login["password"] = "new-password-123"
    assert db_client.post("/auth/teacher/login", json=login).status_code == 200
    events = asyncio.run(_audit_events("teacher.password_changed", body["me"]["id"]))
    assert len(events) == 1 and events[0].payload["revoked_sessions"] == 1


@needs_db
def test_WS_teacher_用DB_token連得上_revoke後4401(db_client: TestClient) -> None:
    token = _register(db_client, _email("ws"))["ticket"]
    with teacher_connect(db_client, token) as ws:
        assert ws.receive_json() == {"type": "student_list", "students": []}
    # 舊 HMAC ticket 在有 DB 時無效
    hmac_ticket = db_client.app.state.auth.issue_ticket()
    with db_client.websocket_connect(f"/teacher?ticket={hmac_ticket}") as ws:
        with pytest.raises(WebSocketDisconnect) as exc:
            ws.receive_text()
        assert exc.value.code == WS_CLOSE_UNAUTHORIZED
    # 登出（revoke）後同 token 連線被拒
    assert db_client.post("/auth/teacher/logout", headers=_bearer(token)).status_code == 200
    with db_client.websocket_connect(f"/teacher?ticket={token}") as ws:
        with pytest.raises(WebSocketDisconnect) as exc:
            ws.receive_text()
        assert exc.value.code == WS_CLOSE_UNAUTHORIZED


@needs_db
def test_有資料庫_舊PIN登入回410(db_client: TestClient) -> None:
    assert db_client.post("/auth/teacher", json={"password": "test123"}).status_code == 410


@needs_db
def test_免登入模式_有DB_任意帳密登入預設老師(tmp_path: Path) -> None:
    with _make_client(tmp_path, teacher_auth_disabled=True) as c:
        assert c.get("/api/info").json()["teacherAuthDisabled"] is True
        r = c.post("/auth/teacher/login", json={"email": "anyone@x.y", "password": "whatever"})
        assert r.status_code == 200, r.text
        me = r.json()["me"]
        assert me["email"] == DEV_TEACHER_EMAIL
        # 第二次登入拿到同一個老師（不重複建）
        r2 = c.post("/auth/teacher/login", json={"email": "", "password": ""})
        assert r2.status_code == 200 and r2.json()["me"]["id"] == me["id"]
        assert c.get("/auth/teacher/me", headers=_bearer(r.json()["ticket"])).json() == me
        with teacher_connect(c, r.json()["ticket"]) as ws:
            assert ws.receive_json()["type"] == "student_list"
    asyncio.run(_cleanup(include_dev=True))
