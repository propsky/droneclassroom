"""學生帳號系統測試 — 老師建名單 / 邀請信、學生登入 / 邀請 accept / me、WS 帳號模式進場。

需要真實 PostgreSQL（DATABASE_URL），沒設就 skip（無 DB 的 503 行為例外，用既有 client
fixture）。端點會 commit，無法用 rollback 隔離 → 老師用唯一 email 註冊、班級碼隨機產生，
結束時把 audit / sessions / students / teams / teachers 清乾淨，不在 RDS 留垃圾。

寄信一律不真寄：預設停用模式（MAIL_FROM 未設）驗證 invitesSent=false 與 log 連結格式；
需要拿邀請 token 的測試把 app.state.mailer 換成 FakeMailer（記錄信件內容供解析）。
"""

import asyncio
import logging
import re
import secrets
import uuid
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from starlette.websockets import WebSocketDisconnect

from app.config import Settings
from app.db.models import Session, Student, Team
from app.db.session import create_engine, create_sessionmaker
from app.protocol import WS_CLOSE_KICKED
from tests.conftest import recv_until
from tests.db_cleanup import cleanup_test_teachers
from tests.test_accounts import (
    DATABASE_URL,
    EMAIL_DOMAIN,
    _bearer,
    _email,
    _make_client,
    _register,
    needs_db,
)
from tests.test_rooms import Teacher as TeacherWS
from tests.test_rooms import _rooms_by_code

STUDENT_EMAIL_DOMAIN = "students-test.invalid"
INVITE_LINK_RE = re.compile(r"\?invite=([\w\-~.]+)")

# ---------- helpers ----------


def _student_email(tag: str = "s") -> str:
    return f"{tag}-{uuid.uuid4().hex[:10]}@{STUDENT_EMAIL_DOMAIN}"


class FakeMailer:
    """假寄信器：記錄每封信、回 True（fail=True 模擬 SES 掛掉），永遠不真寄。"""

    def __init__(self, fail: bool = False) -> None:
        self.enabled = True
        self.fail = fail
        self.sent: list[dict] = []

    async def send(self, *, to: str, subject: str, html: str, text: str) -> bool:
        if self.fail:
            return False
        self.sent.append({"to": to, "subject": subject, "html": html, "text": text})
        return True

    def last_invite_token(self) -> str:
        """最後一封信 html 裡的邀請 token。"""
        m = INVITE_LINK_RE.search(self.sent[-1]["html"])
        assert m, self.sent[-1]["html"]
        return m.group(1)


async def _cleanup() -> None:
    """刪掉測試建的老師 / 班級 / 學生與其 session / 稽核事件。"""
    assert DATABASE_URL
    await cleanup_test_teachers(DATABASE_URL, email_domain=EMAIL_DOMAIN)


@pytest.fixture
def db_client(tmp_path: Path) -> Iterator[TestClient]:
    """帶真實 DATABASE_URL 的 app；結束後清理測試資料。"""
    with _make_client(tmp_path) as c:
        yield c
    asyncio.run(_cleanup())


async def _insert_team(me: dict, name: str = "三年二班") -> tuple[int, str]:
    """直接插一個班級列（REST 測試不需要走 WS 開房流程）；回 (team_id, team_code)。"""
    assert DATABASE_URL
    engine = create_engine(DATABASE_URL)
    maker = create_sessionmaker(engine)
    code = "".join(secrets.choice("ABCDEFGHJKLMNPQRSTUVWXYZ23456789") for _ in range(6))
    async with maker() as s:
        team = Team(
            org_id=me["orgId"], owner_teacher_id=me["id"], name=name, team_code=code
        )
        s.add(team)
        await s.commit()
        team_id = team.id
    await engine.dispose()
    return team_id, code


async def _student_row(student_id: int) -> Student | None:
    assert DATABASE_URL
    engine = create_engine(DATABASE_URL)
    maker = create_sessionmaker(engine)
    async with maker() as s:
        row = await s.get(Student, student_id)
    await engine.dispose()
    return row


async def _active_sessions(student_id: int) -> int:
    """該生未撤銷的 session 數（auth + invite）。"""
    assert DATABASE_URL
    engine = create_engine(DATABASE_URL)
    maker = create_sessionmaker(engine)
    async with maker() as s:
        rows = (
            (
                await s.execute(
                    select(Session).where(
                        Session.principal_type == "student",
                        Session.principal_id == student_id,
                        Session.revoked_at.is_(None),
                    )
                )
            )
            .scalars()
            .all()
        )
    await engine.dispose()
    return len(rows)


def _setup_team(c: TestClient) -> tuple[dict, int, str]:
    """老師註冊 + 插一個班級；回 (auth headers, team_id, team_code)。"""
    body = _register(c, _email("stu"))
    headers = _bearer(body["ticket"])
    team_id, team_code = asyncio.run(_insert_team(body["me"]))
    return headers, team_id, team_code


def _create_students(
    c: TestClient, headers: dict, team_id: int, students: list[dict], **extra
) -> dict:
    r = c.post(
        f"/api/teams/{team_id}/students",
        json={"students": students, **extra},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    return r.json()


# ---------- 無 DB：503（既有無資料庫模式不壞）----------


def test_無資料庫_學生端點回503(client: TestClient) -> None:
    assert client.post("/auth/student/login", json={"teamCode": "X", "studentCode": "01"}).status_code == 503  # noqa: E501
    assert client.get("/auth/student/invite/whatever").status_code == 503
    assert (
        client.post(
            "/auth/student/invite/accept", json={"inviteToken": "x", "password": "12345678"}
        ).status_code
        == 503
    )
    assert client.get("/auth/student/me", headers=_bearer("x")).status_code == 503
    assert client.get("/api/teams/1/students", headers=_bearer("x")).status_code == 503


def test_無資料庫_WS帶studentToken_退回訪客照舊進預設房(client: TestClient) -> None:
    """無 DB 模式 studentToken 無從解析 → 訪客路徑（既有流程零改變）。"""
    with client.websocket_connect("/") as ws:
        assert ws.receive_json()["type"] == "welcome"
        ws.send_json(
            {"type": "register", "name": "小明", "emoji": "🐱", "studentToken": "garbage"}
        )
        joined = ws.receive_json()
        assert joined["type"] == "room_joined" and joined["room"]["code"] == "MAIN"


# ---------- 老師建名單 ----------


@needs_db
def test_批次建學生_流水碼從01起_第二批接續(db_client: TestClient) -> None:
    headers, team_id, _ = _setup_team(db_client)
    body = _create_students(
        db_client,
        headers,
        team_id,
        [{"name": "小明"}, {"name": "小華", "emoji": "🦊"}],
        sendInvites=False,
    )
    codes = [s["studentCode"] for s in body["created"]]
    assert codes == ["01", "02"]
    assert body["created"][0]["emoji"] == "🙂"  # 預設頭像
    assert body["created"][1]["emoji"] == "🦊"
    assert all(s["inviteStatus"] == "none" and s["status"] == "active" for s in body["created"])
    assert body["invitesSent"] == {}
    # 第二批接續流水碼
    body2 = _create_students(db_client, headers, team_id, [{"name": "小美"}], sendInvites=False)
    assert body2["created"][0]["studentCode"] == "03"
    # 全列
    r = db_client.get(f"/api/teams/{team_id}/students", headers=headers)
    assert r.status_code == 200
    assert [s["studentCode"] for s in r.json()["students"]] == ["01", "02", "03"]
    # 別人的班 404
    other_headers = _bearer(_register(db_client, _email("other"))["ticket"])
    assert (
        db_client.get(f"/api/teams/{team_id}/students", headers=other_headers).status_code == 404
    )


@needs_db
def test_班內重複email_409整批回滾並指出哪列(db_client: TestClient) -> None:
    headers, team_id, _ = _setup_team(db_client)
    email = _student_email("dup")
    _create_students(db_client, headers, team_id, [{"name": "既有", "email": email}])
    # 第 2 列撞既有 email（大小寫不同也算）→ 409、整批不建（第 1 列也回滾）
    r = db_client.post(
        f"/api/teams/{team_id}/students",
        json={"students": [{"name": "新人"}, {"name": "撞號", "email": email.upper()}]},
        headers=headers,
    )
    assert r.status_code == 409
    assert "第 2 列" in r.json()["detail"]
    # 同一批內互撞也一樣
    e2 = _student_email("dup2")
    r = db_client.post(
        f"/api/teams/{team_id}/students",
        json={"students": [{"name": "甲", "email": e2}, {"name": "乙", "email": e2}]},
        headers=headers,
    )
    assert r.status_code == 409 and "第 2 列" in r.json()["detail"]
    lst = db_client.get(f"/api/teams/{team_id}/students", headers=headers).json()["students"]
    assert [s["name"] for s in lst] == ["既有"]  # 只有最初那位


# ---------- 學生登入 / me ----------


@needs_db
def test_無email學生_班級碼加學生碼登入_me通(db_client: TestClient) -> None:
    headers, team_id, team_code = _setup_team(db_client)
    _create_students(db_client, headers, team_id, [{"name": "小碼"}], sendInvites=False)
    cfg: Settings = db_client.app.state.settings
    # 學生碼 '1' 也認得（zfill 成 '01'）；班級碼小寫也認得
    r = db_client.post(
        "/auth/student/login", json={"teamCode": team_code.lower(), "studentCode": "1"}
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["expiresIn"] == cfg.student_session_ttl_sec == 90 * 24 * 3600
    me = body["me"]
    assert me["name"] == "小碼" and me["teamId"] == team_id
    assert me["teamCode"] == team_code and me["studentCode"] == "01"
    r = db_client.get("/auth/student/me", headers=_bearer(body["token"]))
    assert r.status_code == 200 and r.json() == me
    # 錯學生碼 → 401 統一訊息；老師 token 打學生 me → 401
    assert (
        db_client.post(
            "/auth/student/login", json={"teamCode": team_code, "studentCode": "99"}
        ).status_code
        == 401
    )
    assert db_client.get("/auth/student/me", headers=headers).status_code == 401


# ---------- 邀請流程 ----------


@needs_db
def test_邀請_資訊_accept設密碼即登入_token用後失效(db_client: TestClient) -> None:
    mailer = FakeMailer()
    db_client.app.state.mailer = mailer
    headers, team_id, team_code = _setup_team(db_client)
    email = _student_email("inv")
    body = _create_students(db_client, headers, team_id, [{"name": "小邀", "email": email}])
    assert body["invitesSent"] == {email: True}
    assert body["created"][0]["inviteStatus"] == "sent"
    assert mailer.sent[0]["to"] == email and "邀請" in mailer.sent[0]["subject"]
    token = mailer.last_invite_token()
    # 設密碼頁載入：查邀請對象
    r = db_client.get(f"/auth/student/invite/{token}")
    assert r.status_code == 200
    assert r.json() == {"name": "小邀", "teamName": "三年二班", "email": email}
    # 密碼太短 → 422（token 不消耗）
    r = db_client.post(
        "/auth/student/invite/accept", json={"inviteToken": token, "password": "short"}
    )
    assert r.status_code == 422
    # 設密碼 → 完成即登入
    r = db_client.post(
        "/auth/student/invite/accept", json={"inviteToken": token, "password": "kid-pass-123"}
    )
    assert r.status_code == 200, r.text
    me = r.json()["me"]
    assert me["name"] == "小邀" and me["teamCode"] == team_code
    assert db_client.get("/auth/student/me", headers=_bearer(r.json()["token"])).json() == me
    # token 用後失效：資訊 404、再 accept 404
    assert db_client.get(f"/auth/student/invite/{token}").status_code == 404
    assert (
        db_client.post(
            "/auth/student/invite/accept", json={"inviteToken": token, "password": "kid-pass-123"}
        ).status_code
        == 404
    )
    # 清單上狀態變 accepted
    lst = db_client.get(f"/api/teams/{team_id}/students", headers=headers).json()["students"]
    assert lst[0]["inviteStatus"] == "accepted"


@needs_db
def test_accepted學生_用碼登入需密碼_email登入也通(db_client: TestClient) -> None:
    mailer = FakeMailer()
    db_client.app.state.mailer = mailer
    headers, team_id, team_code = _setup_team(db_client)
    email = _student_email("pw")
    _create_students(db_client, headers, team_id, [{"name": "小密", "email": email}])
    token = mailer.last_invite_token()
    assert (
        db_client.post(
            "/auth/student/invite/accept", json={"inviteToken": token, "password": "kid-pass-123"}
        ).status_code
        == 200
    )
    # 已設密碼：只憑班級碼 + 學生碼 → 401 password_required（前端據此展開密碼欄）
    login = {"teamCode": team_code, "studentCode": "01"}
    r = db_client.post("/auth/student/login", json=login)
    assert r.status_code == 401 and r.json()["detail"] == "password_required"
    # 帶了密碼但錯 → 統一訊息（不透露是密碼錯）
    r = db_client.post("/auth/student/login", json={**login, "password": "wrong-pass"})
    assert r.status_code == 401 and r.json()["detail"] != "password_required"
    # 本測試登入次數多，重置同 IP 限流（限流本身由 test_auth 覆蓋）
    db_client.app.state.auth._attempts.clear()  # noqa: SLF001
    # 帶密碼 → 通
    r = db_client.post("/auth/student/login", json={**login, "password": "kid-pass-123"})
    assert r.status_code == 200 and r.json()["me"]["name"] == "小密"
    # email + 密碼 → 通
    r = db_client.post("/auth/student/login", json={"email": email, "password": "kid-pass-123"})
    assert r.status_code == 200 and r.json()["me"]["studentCode"] == "01"


@needs_db
def test_reinvite_舊token失效_新token有效(db_client: TestClient) -> None:
    mailer = FakeMailer()
    db_client.app.state.mailer = mailer
    headers, team_id, _ = _setup_team(db_client)
    email = _student_email("re")
    body = _create_students(db_client, headers, team_id, [{"name": "小重", "email": email}])
    student_id = body["created"][0]["id"]
    old_token = mailer.last_invite_token()
    r = db_client.post(f"/api/students/{student_id}/reinvite", headers=headers)
    assert r.status_code == 200 and r.json() == {"sent": True}
    new_token = mailer.last_invite_token()
    assert new_token != old_token
    assert db_client.get(f"/auth/student/invite/{old_token}").status_code == 404
    assert db_client.get(f"/auth/student/invite/{new_token}").status_code == 200
    # 沒 email 的學生不能 reinvite
    body2 = _create_students(db_client, headers, team_id, [{"name": "無信"}], sendInvites=False)
    r = db_client.post(f"/api/students/{body2['created'][0]['id']}/reinvite", headers=headers)
    assert r.status_code == 400


@needs_db
def test_寄信停用_invitesSent_false_狀態留none_log有連結(
    db_client: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    """預設停用模式（MAIL_FROM 未設）：不真寄、不擋建立；連結印在 log（開發拿邀請的途徑）。"""
    headers, team_id, _ = _setup_team(db_client)
    email = _student_email("off")
    cfg: Settings = db_client.app.state.settings
    with caplog.at_level(logging.INFO, logger="creafly.api.students"):
        body = _create_students(db_client, headers, team_id, [{"name": "小停", "email": email}])
    assert body["invitesSent"] == {email: False}
    assert body["created"][0]["inviteStatus"] == "none"
    # log 裡的連結格式正確、token 有效（停用模式下拿邀請連結的唯一途徑）
    m = INVITE_LINK_RE.search(caplog.text)
    assert m is not None and f"{cfg.public_student_url}/?invite=" in caplog.text
    assert db_client.get(f"/auth/student/invite/{m.group(1)}").status_code == 200


# ---------- 移除學生 ----------


@needs_db
def test_removed學生_登入401_session全撤(db_client: TestClient) -> None:
    headers, team_id, team_code = _setup_team(db_client)
    body = _create_students(db_client, headers, team_id, [{"name": "小除"}], sendInvites=False)
    student_id = body["created"][0]["id"]
    login = {"teamCode": team_code, "studentCode": "01"}
    token = db_client.post("/auth/student/login", json=login).json()["token"]
    assert asyncio.run(_active_sessions(student_id)) == 1
    r = db_client.delete(f"/api/students/{student_id}", headers=headers)
    assert r.status_code == 204
    # 既有 session 全撤、重新登入也 401
    assert db_client.get("/auth/student/me", headers=_bearer(token)).status_code == 401
    assert db_client.post("/auth/student/login", json=login).status_code == 401
    assert asyncio.run(_active_sessions(student_id)) == 0
    assert asyncio.run(_student_row(student_id)).status == "removed"
    # 全列仍看得到（前端自己篩）
    lst = db_client.get(f"/api/teams/{team_id}/students", headers=headers).json()["students"]
    assert lst[0]["status"] == "removed"


# ---------- WS 帳號模式進場 ----------


def _account_login(c: TestClient, team_code: str, code: str = "01") -> str:
    r = c.post("/auth/student/login", json={"teamCode": team_code, "studentCode": code})
    assert r.status_code == 200, r.text
    return r.json()["token"]


@needs_db
def test_WS_studentToken進房_自動進班級房免密碼_名冊帶studentId(db_client: TestClient) -> None:
    ticket = _register(db_client, _email("wsA"))["ticket"]
    with db_client.websocket_connect(f"/teacher?ticket={ticket}") as ws:
        t = TeacherWS(ws)
        code = t.create_room({"name": "帳號班", "password": "s3cret"})  # 有房間密碼
        team_id = _rooms_by_code(t.room_list(lambda lst: code in _rooms_by_code(lst)))[code][
            "teamId"
        ]
        headers = _bearer(ticket)
        body = _create_students(db_client, headers, team_id, [{"name": "小帳"}], sendInvites=False)
        student_id = body["created"][0]["id"]
        token = _account_login(db_client, code)
        # 學生連上（不帶 ?room=）→ register 帶 studentToken：
        # 名字 / emoji 以 DB 為準、自動進班級房、免房間密碼
        with db_client.websocket_connect("/") as s:
            assert s.receive_json()["type"] == "welcome"
            s.send_json(
                {"type": "register", "name": "亂打", "emoji": "🙃", "studentToken": token}
            )
            joined = s.receive_json()
            assert joined["type"] == "room_joined", joined
            assert joined["room"]["code"] == code and joined["room"]["teamId"] == team_id
            # 帳號模式進房後下行歷史進度（新生 = 空；內容正確性見 test_progress.py）
            assert s.receive_json() == {"type": "progress_sync", "progress": {}}
            # 老師名冊：DB 名字 + studentId
            lst = recv_until(t.ws, "student_list")
            while [x["name"] for x in lst["students"]] != ["小帳"]:
                lst = recv_until(t.ws, "student_list")
            assert lst["students"][0]["studentId"] == student_id
            assert lst["students"][0]["emoji"] == "🙂"
            # 移除學生 → 在線被踢（close 4001）
            assert (
                db_client.delete(f"/api/students/{student_id}", headers=headers).status_code
                == 204
            )
            assert s.receive_json() == {"type": "room_closed", "reason": "kicked"}
            with pytest.raises(WebSocketDisconnect) as exc:
                s.receive_text()
            assert exc.value.code == WS_CLOSE_KICKED


@needs_db
def test_WS_房沒開_room_rejected_closed_開房後可進(db_client: TestClient) -> None:
    ticket = _register(db_client, _email("wsB"))["ticket"]
    with db_client.websocket_connect(f"/teacher?ticket={ticket}") as ws:
        t = TeacherWS(ws)
        code = t.create_room({"name": "下課班"})
        team_id = _rooms_by_code(t.room_list(lambda lst: code in _rooms_by_code(lst)))[code][
            "teamId"
        ]
        headers = _bearer(ticket)
        _create_students(db_client, headers, team_id, [{"name": "小等"}], sendInvites=False)
        token = _account_login(db_client, code)
        # 關房（班級卸載）→ 學生帳號模式進場被拒 closed（不斷線）
        t.send_json({"type": "room_close", "roomCode": code})
        t.room_list(lambda lst: code not in _rooms_by_code(lst))
        with db_client.websocket_connect("/") as s:
            assert s.receive_json()["type"] == "welcome"
            reg = {"type": "register", "name": "x", "emoji": "x", "studentToken": token}
            s.send_json(reg)
            assert s.receive_json() == {"type": "room_rejected", "reason": "closed"}
            # 老師開房 → 同一條連線再 register 就進得來（跟實體課一致：老師開門才進教室）
            t.send_json({"type": "room_open_team", "teamId": team_id})
            t.room_list(lambda lst: code in _rooms_by_code(lst))
            s.send_json(reg)
            joined = s.receive_json()
            assert joined["type"] == "room_joined" and joined["room"]["code"] == code


@needs_db
def test_WS_token無效_退回訪客路徑照舊(db_client: TestClient) -> None:
    with db_client.websocket_connect("/") as s:
        assert s.receive_json()["type"] == "welcome"
        s.send_json(
            {"type": "register", "name": "小訪", "emoji": "🐱", "studentToken": "not-a-token"}
        )
        joined = s.receive_json()
        assert joined["type"] == "room_joined" and joined["room"]["code"] == "MAIN"
    # removed 學生的舊 token 也一樣退回訪客（resolve 會擋掉非 active）


@needs_db
def test_學生登出撤銷session(db_client: TestClient) -> None:
    headers, team_id, team_code = _setup_team(db_client)
    created = db_client.post(
        f"/api/teams/{team_id}/students",
        json={"students": [{"name": "登出測", "emoji": "🐸"}], "sendInvites": False},
        headers=headers,
    ).json()["created"][0]
    login = db_client.post(
        "/auth/student/login",
        json={"teamCode": team_code, "studentCode": created["studentCode"]},
    )
    assert login.status_code == 200
    token = login.json()["token"]
    assert db_client.get("/auth/student/me", headers=_bearer(token)).status_code == 200
    assert db_client.post("/auth/student/logout", headers=_bearer(token)).status_code == 200
    assert db_client.get("/auth/student/me", headers=_bearer(token)).status_code == 401


@needs_db
def test_同email不重複建帳_沒email走班級碼_登入不掃多帳號(db_client: TestClient) -> None:
    """一人一帳：已註冊的 email 只加成員；沒 email 仍用班級碼；重複列不靠試密碼登入。"""
    from sqlalchemy import func, select, text

    from app.accounts import hash_password
    from app.db.session import create_engine, create_sessionmaker

    headers, team_id, team_code = _setup_team(db_client)
    no_mail = _create_students(
        db_client, headers, team_id, [{"name": "小碼"}], sendInvites=False
    )
    assert no_mail["created"][0]["accountKind"] == "code"
    assert no_mail["joined"] == []
    assert no_mail["noticesSent"] == {}
    login = db_client.post(
        "/auth/student/login",
        json={"teamCode": team_code, "studentCode": no_mail["created"][0]["studentCode"]},
    )
    assert login.status_code == 200, login.text

    email = _student_email("one")
    reg = db_client.post(
        "/auth/student/register",
        json={"name": "小註", "email": email, "password": "kid-pass-123"},
    )
    assert reg.status_code == 201, reg.text
    sid = reg.json()["me"]["id"]
    mailer = FakeMailer()
    db_client.app.state.mailer = mailer
    added = _create_students(
        db_client, headers, team_id, [{"name": "名單上的名字", "email": email}]
    )
    # 已有帳號：老師不能直接掛進班，只寄信請本人用班級碼加入
    assert added["created"] == [] and added["joined"] == []
    assert added["pendingJoin"] == [email]
    assert added["noticesSent"][email] is True
    assert "邀請你加入" in mailer.sent[-1]["subject"]
    assert team_code in mailer.sent[-1]["text"]
    assert "invite=" not in mailer.sent[-1]["html"]
    listed_a = db_client.get(f"/api/teams/{team_id}/students", headers=headers).json()
    assert sid not in {row["id"] for row in listed_a["students"]}
    again = db_client.post(
        "/auth/student/register",
        json={"name": "另一個", "email": email.upper(), "password": "kid-pass-123"},
    )
    assert again.status_code == 409
    me = db_client.get("/auth/teacher/me", headers=headers).json()
    team_b, code_b = asyncio.run(_insert_team(me, "另一班"))
    added_b = _create_students(
        db_client, headers, team_b, [{"name": "乙", "email": email}]
    )
    assert added_b["created"] == [] and added_b["pendingJoin"] == [email]
    # 本人登入後自己用班級碼加入，才成為成員（linked）
    token = reg.json()["token"]
    joined = db_client.post(
        "/auth/student/teams/join", json={"teamCode": code_b}, headers=_bearer(token)
    )
    assert joined.status_code == 200, joined.text
    listed = db_client.get(f"/api/teams/{team_b}/students", headers=headers).json()["students"]
    assert listed[0]["accountKind"] == "linked"
    assert listed[0]["id"] == sid
    fresh = _student_email("new")
    created = _create_students(db_client, headers, team_id, [{"name": "新同學", "email": fresh}])
    assert created["joined"] == []
    assert created["created"][0]["accountKind"] == "pending_password"
    assert "邀請" in mailer.sent[-1]["subject"]

    db_client.app.state.auth._attempts.clear()  # noqa: SLF001
    ok = db_client.post(
        "/auth/student/login", json={"email": email, "password": "kid-pass-123"}
    )
    assert ok.status_code == 200 and ok.json()["me"]["id"] == sid

    async def _plant_duplicate() -> None:
        assert DATABASE_URL
        engine = create_engine(DATABASE_URL)
        maker = create_sessionmaker(engine)
        async with maker() as s:
            await s.execute(text("DROP INDEX IF EXISTS uq_students_lower_email"))
            s.add(
                Student(
                    name="影子帳號",
                    email=email,
                    password_hash=hash_password("other-pass-123"),
                    invite_status="accepted",
                    team_id=team_b,
                    student_code="77",
                )
            )
            await s.commit()
        await engine.dispose()

    async def _drop_duplicate() -> None:
        assert DATABASE_URL
        engine = create_engine(DATABASE_URL)
        maker = create_sessionmaker(engine)
        async with maker() as s:
            rows = (
                (
                    await s.execute(
                        select(Student).where(
                            func.lower(Student.email) == email, Student.name == "影子帳號"
                        )
                    )
                )
                .scalars()
                .all()
            )
            for row in rows:
                await s.delete(row)
            await s.execute(
                text(
                    "UPDATE students SET email = NULL "
                    "WHERE lower(email) = :email AND name = '影子帳號'"
                ),
                {"email": email},
            )
            await s.commit()
            dupes = (
                await s.execute(
                    text(
                        "SELECT lower(email) FROM students WHERE email IS NOT NULL "
                        "GROUP BY lower(email) HAVING count(*) > 1"
                    )
                )
            ).all()
            if not dupes:
                await s.execute(
                    text(
                        "CREATE UNIQUE INDEX IF NOT EXISTS uq_students_lower_email "
                        "ON students (lower(email)) WHERE email IS NOT NULL"
                    )
                )
                await s.commit()
        await engine.dispose()

    try:
        asyncio.run(_plant_duplicate())
        db_client.app.state.auth._attempts.clear()  # noqa: SLF001
        for password in ("kid-pass-123", "other-pass-123"):
            denied = db_client.post(
                "/auth/student/login", json={"email": email, "password": password}
            )
            assert denied.status_code == 401, password
    finally:
        asyncio.run(_drop_duplicate())


# ---------- 老師不能把別人的帳號掛進自己班 ----------


async def _set_student_status(student_id: int, status: str) -> None:
    assert DATABASE_URL
    engine = create_engine(DATABASE_URL)
    maker = create_sessionmaker(engine)
    async with maker() as s:
        row = await s.get(Student, student_id)
        assert row is not None
        row.status = status
        await s.commit()
    await engine.dispose()


@needs_db
def test_他班老師輸入未設密碼學生的email_不能掛班也不能冒用登入(db_client: TestClient) -> None:
    mailer = FakeMailer()
    db_client.app.state.mailer = mailer
    headers_a, team_a, _code_a = _setup_team(db_client)
    email = _student_email("victim")
    victim = _create_students(db_client, headers_a, team_a, [{"name": "小受", "email": email}])
    victim_id = victim["created"][0]["id"]
    invite_token = mailer.last_invite_token()  # A 班寄出的設密碼邀請，學生還沒點

    headers_b, team_b, code_b = _setup_team(db_client)  # 另一位老師
    added = _create_students(db_client, headers_b, team_b, [{"name": "冒名", "email": email}])
    assert added["joined"] == [] and added["pendingJoin"] == [email]
    assert "小受" not in str(added)  # 不洩漏對方帳號的名字
    listed = db_client.get(f"/api/teams/{team_b}/students", headers=headers_b).json()
    assert victim_id not in {row["id"] for row in listed["students"]}
    # 用 B 班班級碼 + 任何學生碼都登入不了這個帳號
    db_client.app.state.auth._attempts.clear()  # noqa: SLF001
    for code in ("01", "02"):
        r = db_client.post("/auth/student/login", json={"teamCode": code_b, "studentCode": code})
        assert r.status_code in (401, 404)
    # A 班的邀請沒被撤銷，學生仍能設密碼
    assert db_client.get(f"/auth/student/invite/{invite_token}").status_code == 200


@needs_db
def test_平台停用的帳號_老師加名單不會重新啟用(db_client: TestClient) -> None:
    headers, team_id, _code = _setup_team(db_client)
    email = _student_email("off")
    reg = db_client.post(
        "/auth/student/register",
        json={"name": "停用", "email": email, "password": "kid-pass-123"},
    )
    sid = reg.json()["me"]["id"]
    asyncio.run(_set_student_status(sid, "disabled"))
    r = db_client.post(
        f"/api/teams/{team_id}/students",
        json={"students": [{"name": "停用", "email": email}], "sendInvites": False},
        headers=headers,
    )
    assert r.status_code == 409 and "停用" in r.json()["detail"]
    assert asyncio.run(_student_row(sid)).status == "disabled"


@needs_db
def test_本班建立後移出的學生_老師可以加回(db_client: TestClient) -> None:
    headers, team_id, _code = _setup_team(db_client)
    email = _student_email("back")
    body = _create_students(
        db_client, headers, team_id, [{"name": "回來", "email": email}], sendInvites=False
    )
    sid = body["created"][0]["id"]
    assert db_client.delete(f"/api/students/{sid}", headers=headers).status_code == 204
    assert asyncio.run(_student_row(sid)).status == "removed"
    again = _create_students(
        db_client, headers, team_id, [{"name": "回來", "email": email}], sendInvites=False
    )
    assert [row["id"] for row in again["joined"]] == [sid]
    assert again["pendingJoin"] == []
    assert asyncio.run(_student_row(sid)).status == "active"


@needs_db
def test_自行加入的學生_他班老師不能重寄邀請撤掉原班的(db_client: TestClient) -> None:
    mailer = FakeMailer()
    db_client.app.state.mailer = mailer
    headers_a, team_a, code_a = _setup_team(db_client)
    _create_students(db_client, headers_a, team_a, [{"name": "甲", "email": _student_email("x")}])
    headers_b, team_b, code_b = _setup_team(db_client)
    # 用 A 班的未設密碼學生登入（班級碼路徑），自己加入 B 班
    db_client.app.state.auth._attempts.clear()  # noqa: SLF001
    token = db_client.post(
        "/auth/student/login", json={"teamCode": code_a, "studentCode": "01"}
    ).json()["token"]
    joined = db_client.post(
        "/auth/student/teams/join", json={"teamCode": code_b}, headers=_bearer(token)
    )
    assert joined.status_code == 200, joined.text
    sid = db_client.get("/auth/student/me", headers=_bearer(token)).json()["id"]
    r = db_client.post(f"/api/students/{sid}/reinvite?teamId={team_b}", headers=headers_b)
    assert r.status_code == 400
    assert "原班級" in r.json()["detail"]
