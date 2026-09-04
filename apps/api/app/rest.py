"""rest.py — REST 端點，對齊 packages/shared/src/rest.ts。

- 老師帳號（需 DATABASE_URL，否則 503）：
  POST /auth/teacher/register / login → 發 DB session token（回應欄位仍叫 ticket）
  GET  /auth/teacher/me、POST /auth/teacher/logout、POST /auth/teacher/password（Bearer）
  POST /auth/teacher/password-reset/request、POST /auth/teacher/password-reset/confirm
- POST /auth/teacher：舊 PIN 登入（密碼 → HMAC ticket），只在無資料庫模式有效
- GET  /api/levels：三章關卡清單（老師後台下拉選單 / 廣播用），啟動時載入一次快取
- GET  /api/info：教室現場資訊（LAN IP / port / 人數上限 / 版本）
- GET  /api/health：健檢（伺服器存活 + 資料庫狀態 ok / disabled / error）
"""

import contextlib
import html as html_escape
import ipaddress
import json
import logging
import secrets
import socket
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from .accounts import (
    CurrentSession,
    CurrentTeacher,
    DbSession,
    hash_password,
    issue_session,
    revoke_all_sessions_for,
    revoke_session,
    token_hash,
    verify_password,
)
from .auth import TeacherAuth, origin_allowed
from .config import Settings
from .db.audit import record_event
from .db.models import Organization, Teacher
from .db.models import Session as SessionRow
from .mailer import Mailer

logger = logging.getLogger("creafly.api.rest")

API_VERSION = "2.0.0"

router = APIRouter()


# ---------- 回應模型（欄位名對齊 rest.ts，camelCase）----------


class TeacherPinLoginRequest(BaseModel):
    """POST /auth/teacher 請求（舊 PIN 登入，無資料庫模式）。"""

    password: str


class TeacherPinLoginResponse(BaseModel):
    """POST /auth/teacher 回應（401 時無 body）。"""

    ticket: str
    expiresIn: int  # noqa: N815 — 線上格式沿用 camelCase


class TeacherMe(BaseModel):
    """老師身分（rest.ts TeacherMe）。"""

    id: int
    email: str
    name: str
    role: Literal["teacher", "org_admin"]
    orgId: int  # noqa: N815
    orgName: str  # noqa: N815


class TeacherRegisterRequest(BaseModel):
    """POST /auth/teacher/register 請求；密碼長度下限由 Settings.password_min_length 檢查。"""

    email: str = Field(min_length=3, max_length=254)
    password: str = Field(max_length=1024)
    name: str = Field(min_length=1, max_length=100)
    registerCode: str | None = Field(default=None, max_length=64)  # noqa: N815


class TeacherLoginRequest(BaseModel):
    """POST /auth/teacher/login 請求。"""

    email: str = Field(max_length=254)
    password: str = Field(max_length=1024)


class TeacherLoginResponse(BaseModel):
    """註冊 / 登入共同回應：session token（欄位名沿用 ticket）+ 有效秒數 + 身分。"""

    ticket: str
    expiresIn: int  # noqa: N815
    me: TeacherMe


class TeacherLogoutResponse(BaseModel):
    ok: Literal[True] = True


class TeacherChangePasswordRequest(BaseModel):
    """POST /auth/teacher/password 請求。"""

    currentPassword: str = Field(max_length=1024)  # noqa: N815
    newPassword: str = Field(max_length=1024)  # noqa: N815


class TeacherPasswordResetRequest(BaseModel):
    """POST /auth/teacher/password-reset/request 請求。"""

    email: str = Field(max_length=254)


class TeacherPasswordResetConfirm(BaseModel):
    """POST /auth/teacher/password-reset/confirm 請求。"""

    resetToken: str = Field(max_length=200)  # noqa: N815
    newPassword: str = Field(max_length=1024)  # noqa: N815


class OkResponse(BaseModel):
    ok: Literal[True] = True


class LevelBrief(BaseModel):
    """關卡清單項目（只帶後台需要的 id / name，不含 rings 等場景資料）。"""

    id: str
    name: str


class ChapterLevels(BaseModel):
    """一章的關卡清單。"""

    chapter: int
    name: str
    levels: list[LevelBrief]


class LevelsResponse(BaseModel):
    """GET /api/levels 回應。"""

    chapters: list[ChapterLevels]


class InfoResponse(BaseModel):
    """GET /api/info 回應。"""

    lanAddresses: list[str]  # noqa: N815
    port: int
    maxStudents: int  # noqa: N815
    version: str
    # 免登入模式（測試用）：前端據此跳過登入畫面自動取票
    teacherAuthDisabled: bool = False  # noqa: N815
    # 老師註冊是否需要邀請碼（前端據此顯示欄位）
    teacherRegisterCodeRequired: bool = False  # noqa: N815


class HealthResponse(BaseModel):
    """GET /api/health 回應。"""

    status: Literal["ok"]
    # ok = SELECT 1 成功；disabled = 未設定 DATABASE_URL；error = 設了但連不上
    db: Literal["ok", "disabled", "error"]


# ---------- 關卡載入（啟動時一次，關卡是靜態資料、改檔重啟即可）----------


def load_levels(levels_dir: Path) -> LevelsResponse:
    """讀 levels_dir 下所有 chapter*.json → LevelsResponse。

    單一檔案格式錯誤只略過並 log，不讓整個伺服器起不來。
    """
    chapters: list[ChapterLevels] = []
    for path in sorted(levels_dir.glob("chapter*.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            chapters.append(
                ChapterLevels(
                    chapter=data["chapter"],
                    name=data["name"],
                    levels=[
                        LevelBrief(id=lvl["id"], name=lvl["name"]) for lvl in data["levels"]
                    ],
                )
            )
        except (OSError, ValueError, KeyError, TypeError):
            logger.warning("[REST] 關卡檔格式錯誤，略過：%s", path)
    if not chapters:
        logger.warning("[REST] %s 下找不到任何 chapter*.json，/api/levels 將回空清單", levels_dir)
    chapters.sort(key=lambda c: c.chapter)
    return LevelsResponse(chapters=chapters)


def known_level_ids(levels: LevelsResponse) -> frozenset[str]:
    """所有已知關卡 id（防作弊：complete_level 帶未知 levelId → suspect）。"""
    return frozenset(lvl.id for ch in levels.chapters for lvl in ch.levels)


# ---------- LAN 位址（老師投影給學生抄的網址）----------


def lan_addresses() -> list[str]:
    """列出本機私有網段 IPv4；任何一步失敗都吞掉、最壞回空陣列不 crash。"""
    candidates: set[str] = set()
    with contextlib.suppress(OSError):
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            candidates.add(info[4][0])
    with contextlib.suppress(OSError):
        # UDP connect 不會真的發包，只為了取得預設路由介面的本機位址
        probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            probe.connect(("8.8.8.8", 80))
            candidates.add(probe.getsockname()[0])
        finally:
            probe.close()
    result: list[str] = []
    for addr in candidates:
        with contextlib.suppress(ValueError):
            ip = ipaddress.ip_address(addr)
            if ip.is_private and not ip.is_loopback and not ip.is_link_local:
                result.append(addr)
    return sorted(result)


# ---------- 老師帳號（DB session）----------

# 免登入模式（TEACHER_AUTH_DISABLED）有 DB 時自動建立的預設老師
DEV_TEACHER_EMAIL = "dev@local"
DEV_TEACHER_NAME = "測試老師"


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "?"


def _login_guard(request: Request) -> str:
    """登入類端點共用前置：Origin 白名單（403）→ 同 IP 限流（429）。回傳 IP 供 log / audit。"""
    settings: Settings = request.app.state.settings
    auth: TeacherAuth = request.app.state.auth
    if not origin_allowed(
        request.headers.get("origin"), request.headers.get("host"), settings.allowed_origins_set
    ):
        raise HTTPException(status_code=403, detail="Origin 不在白名單")
    ip = _client_ip(request)
    if not auth.allow_login_attempt(ip):
        logger.warning("[AUTH] 登入嘗試過於頻繁，暫時封鎖（IP：%s）", ip)
        raise HTTPException(status_code=429, detail="登入嘗試過於頻繁，請一分鐘後再試")
    return ip


def _normalize_email(email: str) -> str:
    return email.strip().lower()


async def _default_org(session: AsyncSession) -> Organization:
    """預設單位（slug=default，migration 0001 已植入）；所有自行註冊的老師先掛這裡。"""
    org = (
        await session.execute(select(Organization).where(Organization.slug == "default"))
    ).scalar_one_or_none()
    if org is None:
        raise HTTPException(status_code=500, detail="預設單位不存在，請先執行 creafly-migrate")
    return org


async def _teacher_me(session: AsyncSession, teacher: Teacher) -> TeacherMe:
    org = await session.get(Organization, teacher.org_id)
    return TeacherMe(
        id=teacher.id,
        email=teacher.email,
        name=teacher.name,
        role=teacher.role,  # type: ignore[arg-type] — DB CHECK 已限定兩值
        orgId=teacher.org_id,
        orgName=org.name if org else "",
    )


async def _issue_login(
    request: Request, session: AsyncSession, teacher: Teacher
) -> TeacherLoginResponse:
    """發 session + 組回應（註冊 / 登入共用）。不 commit。"""
    settings: Settings = request.app.state.settings
    token = await issue_session(
        session,
        principal_type="teacher",
        principal_id=teacher.id,
        ttl=settings.session_ttl_sec,
        user_agent=request.headers.get("user-agent"),
    )
    return TeacherLoginResponse(
        ticket=token, expiresIn=settings.session_ttl_sec, me=await _teacher_me(session, teacher)
    )


async def _find_teacher_by_email(session: AsyncSession, email: str) -> Teacher | None:
    return (
        await session.execute(select(Teacher).where(func.lower(Teacher.email) == email))
    ).scalar_one_or_none()


async def _revoke_reset_tokens(session: AsyncSession, teacher_id: int) -> None:
    """撤銷該老師所有仍有效的重設 token（重發前呼叫）。不 commit。"""
    rows = (
        (
            await session.execute(
                select(SessionRow).where(
                    SessionRow.principal_type == "teacher",
                    SessionRow.principal_id == teacher_id,
                    SessionRow.purpose == "reset",
                    SessionRow.revoked_at.is_(None),
                )
            )
        )
        .scalars()
        .all()
    )
    for row in rows:
        await revoke_session(session, row)


async def _valid_reset(
    session: AsyncSession, token: str, *, now: datetime | None = None
) -> tuple[SessionRow, Teacher] | None:
    """有效重設 token → (session 列, 老師)；無效 / 過期 / 停權 → None。"""
    if not token:
        return None
    now = now or datetime.now(UTC)
    row = (
        await session.execute(select(SessionRow).where(SessionRow.token_hash == token_hash(token)))
    ).scalar_one_or_none()
    if (
        row is None
        or row.purpose != "reset"
        or row.principal_type != "teacher"
        or row.revoked_at is not None
        or row.expires_at <= now
    ):
        return None
    teacher = await session.get(Teacher, row.principal_id)
    if teacher is None or teacher.status != "active":
        return None
    return row, teacher


def _reset_mail(*, teacher_name: str, link: str, minutes: int) -> tuple[str, str, str]:
    subject = "CREAFLY 教室 — 重設老師帳號密碼"
    text = (
        f"{teacher_name} 老師你好：\n\n"
        f"我們收到重設 CREAFLY 老師後台密碼的請求。點下面的連結設定新密碼：\n\n"
        f"{link}\n\n"
        f"（連結 {minutes} 分鐘內有效；若不是你本人操作，忽略此信即可。）\n"
    )
    esc_name = html_escape.escape(teacher_name)
    html = (
        f"<p>{esc_name} 老師你好：</p>"
        f"<p>我們收到重設 CREAFLY 老師後台密碼的請求。點下面的按鈕設定新密碼：</p>"
        f'<p><a href="{link}" style="display:inline-block;padding:10px 24px;'
        f'background:#2563eb;color:#fff;border-radius:6px;text-decoration:none">'
        f"重設密碼</a></p>"
        f'<p>按鈕打不開的話，複製這個網址到瀏覽器：<br><a href="{link}">{link}</a></p>'
        f'<p style="color:#666">（連結 {minutes} 分鐘內有效；若不是你本人操作，忽略此信即可。）</p>'
    )
    return subject, html, text


@router.post("/auth/teacher/register", status_code=201)
async def teacher_register(
    request: Request, body: TeacherRegisterRequest, session: DbSession
) -> TeacherLoginResponse:
    """老師自行註冊（掛預設單位）→ 註冊即登入、發 session。重複 email 409。"""
    settings: Settings = request.app.state.settings
    ip = _login_guard(request)
    if settings.teacher_register_code and body.registerCode != settings.teacher_register_code:
        raise HTTPException(status_code=403, detail="註冊邀請碼不正確")
    email = _normalize_email(body.email)
    if "@" not in email:
        raise HTTPException(status_code=422, detail="email 格式不正確")
    if len(body.password) < settings.password_min_length:
        raise HTTPException(
            status_code=422, detail=f"密碼至少 {settings.password_min_length} 個字元"
        )
    org = await _default_org(session)
    teacher = Teacher(
        org_id=org.id,
        email=email,
        password_hash=hash_password(body.password),
        name=body.name.strip(),
    )
    session.add(teacher)
    try:
        await session.flush()
    except IntegrityError:
        # LOWER(email) 唯一索引撞到 → 已有人用這個 email
        await session.rollback()
        raise HTTPException(status_code=409, detail="這個 email 已經註冊過") from None
    teacher.last_login_at = datetime.now(UTC)
    result = await _issue_login(request, session, teacher)
    await record_event(
        session,
        event_type="teacher.register",
        actor_type="teacher",
        actor_id=teacher.id,
        org_id=teacher.org_id,
        payload={"ip": ip},
    )
    await session.commit()
    logger.info("[AUTH] 老師註冊成功：id=%s（IP：%s）", teacher.id, ip)
    return result


async def _dev_teacher(session: AsyncSession) -> Teacher:
    """免登入模式的預設老師（dev@local）：沒有就自動建（密碼隨機、不可用帳密登入）。"""
    teacher = await _find_teacher_by_email(session, DEV_TEACHER_EMAIL)
    if teacher is None:
        org = await _default_org(session)
        teacher = Teacher(
            org_id=org.id,
            email=DEV_TEACHER_EMAIL,
            password_hash=hash_password(secrets.token_urlsafe(32)),
            name=DEV_TEACHER_NAME,
        )
        session.add(teacher)
        await session.flush()
    return teacher


@router.post("/auth/teacher/login")
async def teacher_account_login(
    request: Request, body: TeacherLoginRequest, session: DbSession
) -> TeacherLoginResponse:
    """老師登入：Origin → 限流 → 帳密比對 → 發 session。

    失敗一律 401、不區分「帳號不存在」與「密碼錯誤」（防枚舉）；audit teacher.login_failed。
    TEACHER_AUTH_DISABLED=1：任意帳密皆登入預設老師 dev@local（測試期免註冊；正式拿掉旗標）。
    """
    settings: Settings = request.app.state.settings
    ip = _login_guard(request)
    email = _normalize_email(body.email)
    if settings.teacher_auth_disabled:
        teacher = await _dev_teacher(session)
    else:
        teacher = await _find_teacher_by_email(session, email)
        ok = (
            teacher is not None
            and teacher.status == "active"
            and verify_password(teacher.password_hash, body.password)
        )
        if not ok:
            await record_event(
                session,
                event_type="teacher.login_failed",
                actor_type="teacher",
                actor_id=teacher.id if teacher else None,
                org_id=teacher.org_id if teacher else None,
                payload={"ip": ip, "email": email},
            )
            await session.commit()
            logger.info("[AUTH] 老師登入失敗（IP：%s）", ip)
            raise HTTPException(status_code=401, detail="帳號或密碼錯誤")
        assert teacher is not None
    teacher.last_login_at = datetime.now(UTC)
    result = await _issue_login(request, session, teacher)
    await record_event(
        session,
        event_type="teacher.login",
        actor_type="teacher",
        actor_id=teacher.id,
        org_id=teacher.org_id,
        payload={"ip": ip, "dev_mode": settings.teacher_auth_disabled},
    )
    await session.commit()
    logger.info("[AUTH] 老師登入成功：id=%s（IP：%s）", teacher.id, ip)
    return result


@router.get("/auth/teacher/me")
async def teacher_me(teacher: CurrentTeacher, session: DbSession) -> TeacherMe:
    """開頁驗 token + 取身分；get_current_session 已順便滑動延長。"""
    return await _teacher_me(session, teacher)


@router.post("/auth/teacher/logout")
async def teacher_logout(
    request: Request, teacher: CurrentTeacher, current: CurrentSession, session: DbSession
) -> TeacherLogoutResponse:
    """撤銷目前 session。"""
    await revoke_session(session, current)
    await record_event(
        session,
        event_type="teacher.logout",
        actor_type="teacher",
        actor_id=teacher.id,
        org_id=teacher.org_id,
        payload={"ip": _client_ip(request), "session_id": current.id},
    )
    await session.commit()
    return TeacherLogoutResponse()


@router.post("/auth/teacher/password")
async def teacher_change_password(
    request: Request,
    body: TeacherChangePasswordRequest,
    teacher: CurrentTeacher,
    current: CurrentSession,
    session: DbSession,
) -> TeacherLogoutResponse:
    """換密碼：驗舊密碼 → 換新 → 撤銷該老師其他所有 session（當前保留，不用重登）。"""
    settings: Settings = request.app.state.settings
    if not verify_password(teacher.password_hash, body.currentPassword):
        raise HTTPException(status_code=401, detail="目前密碼錯誤")
    if len(body.newPassword) < settings.password_min_length:
        raise HTTPException(
            status_code=422, detail=f"新密碼至少 {settings.password_min_length} 個字元"
        )
    teacher.password_hash = hash_password(body.newPassword)
    revoked = await revoke_all_sessions_for(session, "teacher", teacher.id, except_id=current.id)
    await record_event(
        session,
        event_type="teacher.password_changed",
        actor_type="teacher",
        actor_id=teacher.id,
        org_id=teacher.org_id,
        payload={"ip": _client_ip(request), "revoked_sessions": revoked},
    )
    await session.commit()
    logger.info("[AUTH] 老師換密碼：id=%s，撤銷其他 session %d 個", teacher.id, revoked)
    return TeacherLogoutResponse()


@router.post("/auth/teacher/password-reset/request")
async def teacher_password_reset_request(
    request: Request, body: TeacherPasswordResetRequest, session: DbSession
) -> OkResponse:
    """忘記密碼：寄重設連結。不論 email 是否存在都回 ok（防枚舉）。"""
    settings: Settings = request.app.state.settings
    mailer: Mailer = request.app.state.mailer
    ip = _login_guard(request)
    email = _normalize_email(body.email)
    teacher = await _find_teacher_by_email(session, email)
    if teacher is not None and teacher.status == "active":
        await _revoke_reset_tokens(session, teacher.id)
        token = await issue_session(
            session,
            principal_type="teacher",
            principal_id=teacher.id,
            ttl=settings.password_reset_ttl_sec,
            purpose="reset",
        )
        link = f"{settings.public_teacher_url.rstrip('/')}/?reset={token}"
        if not mailer.enabled:
            logger.info("[MAIL] 停用模式重設密碼連結（%s）：%s", email, link)
        minutes = max(1, settings.password_reset_ttl_sec // 60)
        subject, html, text = _reset_mail(teacher_name=teacher.name, link=link, minutes=minutes)
        sent = await mailer.send(to=email, subject=subject, html=html, text=text)
        await record_event(
            session,
            event_type="teacher.password_reset_requested",
            actor_type="teacher",
            actor_id=teacher.id,
            org_id=teacher.org_id,
            payload={"ip": ip, "sent": sent},
        )
        await session.commit()
    return OkResponse()


@router.post("/auth/teacher/password-reset/confirm")
async def teacher_password_reset_confirm(
    request: Request, body: TeacherPasswordResetConfirm, session: DbSession
) -> TeacherLoginResponse:
    """重設密碼連結：驗 token → 換密碼 → 撤舊 session → 發新登入 session。"""
    settings: Settings = request.app.state.settings
    ip = _login_guard(request)
    found = await _valid_reset(session, body.resetToken)
    if found is None:
        raise HTTPException(status_code=404, detail="重設連結無效或已過期")
    if len(body.newPassword) < settings.password_min_length:
        raise HTTPException(
            status_code=422, detail=f"密碼至少 {settings.password_min_length} 個字元"
        )
    row, teacher = found
    teacher.password_hash = hash_password(body.newPassword)
    teacher.last_login_at = datetime.now(UTC)
    await revoke_session(session, row)
    await revoke_all_sessions_for(session, "teacher", teacher.id)
    result = await _issue_login(request, session, teacher)
    await record_event(
        session,
        event_type="teacher.password_reset",
        actor_type="teacher",
        actor_id=teacher.id,
        org_id=teacher.org_id,
        payload={"ip": ip},
    )
    await session.commit()
    logger.info("[AUTH] 老師重設密碼成功：id=%s（IP：%s）", teacher.id, ip)
    return result


# ---------- 舊 PIN 登入（無資料庫模式）----------


@router.post("/auth/teacher")
async def teacher_login(request: Request, body: TeacherPinLoginRequest) -> TeacherPinLoginResponse:
    """舊教師登入：Origin 檢查 → 同 IP 限流 → PIN 比對 → 發 HMAC ticket。

    只在無 DATABASE_URL 時有效（離線 / 測試部署）；有資料庫時回 410，請改走 /auth/teacher/login。
    """
    if request.app.state.db_sessionmaker is not None:
        raise HTTPException(status_code=410, detail="請改用 /auth/teacher/login 帳號登入")
    auth: TeacherAuth = request.app.state.auth
    ip = _login_guard(request)
    if not auth.check_password(body.password):
        logger.info("[AUTH] 教師登入失敗：密碼錯誤（IP：%s）", ip)
        raise HTTPException(status_code=401, detail="密碼錯誤")
    logger.info("[AUTH] 教師登入成功（IP：%s）", ip)
    return TeacherPinLoginResponse(ticket=auth.issue_ticket(), expiresIn=auth.ttl)


# ---------- 其他端點 ----------


@router.get("/api/levels")
async def get_levels(request: Request) -> LevelsResponse:
    """三章關卡清單（啟動時載入的快取）。"""
    levels: LevelsResponse = request.app.state.levels
    return levels


@router.get("/api/info")
async def get_info(request: Request) -> InfoResponse:
    """教室現場資訊：LAN IP / port / 學生人數上限 / 版本。"""
    settings: Settings = request.app.state.settings
    return InfoResponse(
        lanAddresses=lan_addresses(),
        port=settings.port,
        maxStudents=settings.max_students,
        version=API_VERSION,
        teacherAuthDisabled=settings.teacher_auth_disabled,
        teacherRegisterCodeRequired=bool(settings.teacher_register_code),
    )


@router.get("/api/health")
async def get_health(request: Request) -> HealthResponse:
    """健檢：永遠 200（無資料庫也能上課）；db 欄位反映資料庫狀態。"""
    engine = request.app.state.db_engine
    if engine is None:
        return HealthResponse(status="ok", db="disabled")
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
    except Exception:  # noqa: BLE001 — 健檢只回報狀態，任何連線錯誤都算 error
        logger.warning("[REST] /api/health 資料庫健檢失敗", exc_info=True)
        return HealthResponse(status="ok", db="error")
    return HealthResponse(status="ok", db="ok")
