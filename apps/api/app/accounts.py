"""accounts.py — 老師帳號（資料庫）：密碼雜湊、session 簽發 / 解析 / 撤銷、目前老師 dependency。

取代 auth.py 的 PIN + HMAC ticket（後者只在無 DATABASE_URL 時作為退路，見 rest.py / ws.py）。

設計取捨：
- 密碼 argon2id（argon2-cffi 預設參數已是 OWASP 建議值，不另調）
- session token：`secrets.token_urlsafe(32)` 明文只回 client 一次，DB 只存 sha256；
  REST 以 `Authorization: Bearer <token>`、WS 以 `/teacher?ticket=<token>` 帶上
- 滑動續期：每次命中把 expires_at 推到 now + ttl，但距上次延長不到
  session_touch_interval_sec 就不寫 DB（老師後台每秒都在打 API，不能每請求一筆 UPDATE）
- 時間用 Python 端 UTC（可注入 now 方便測試）；created_at 等仍由 DB now() 產生
- 密碼 / token 明文絕不進 log
"""

import hashlib
import secrets
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from typing import Annotated

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from fastapi import Depends, HTTPException, Request
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from .config import Settings
from .db.models import Session, Student, Teacher, Team

_hasher = PasswordHasher()


# ---------- 密碼 ----------


def hash_password(password: str) -> str:
    """argon2id 雜湊（含 salt 與參數，直接存 teachers.password_hash）。"""
    return _hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    """比對密碼；hash 格式壞掉也只回 False（不讓登入端點 500）。"""
    try:
        return _hasher.verify(password_hash, password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


# ---------- session ----------


def _now() -> datetime:
    return datetime.now(UTC)


def token_hash(token: str) -> str:
    """sha256(token) hex — sessions.token_hash 的值（token 本身已是高熵，不需加鹽）。"""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


async def issue_session(
    session: AsyncSession,
    *,
    principal_type: str,
    principal_id: int,
    ttl: int,
    purpose: str = "auth",
    user_agent: str | None = None,
    now: datetime | None = None,
) -> str:
    """發一個 session：回傳明文 token（只此一次），DB 存 sha256。不 commit（呼叫端決定）。

    purpose：auth = 登入 session（滑動延長）；invite = 學生邀請 token（一次性，accept 後撤銷）。
    """
    now = now or _now()
    token = secrets.token_urlsafe(32)
    session.add(
        Session(
            token_hash=token_hash(token),
            principal_type=principal_type,
            principal_id=principal_id,
            purpose=purpose,
            expires_at=now + timedelta(seconds=ttl),
            last_seen_at=now,
            user_agent=user_agent[:500] if user_agent else None,
        )
    )
    await session.flush()
    return token


async def resolve_session(
    session: AsyncSession,
    token: str,
    *,
    ttl: int,
    touch_interval: int,
    purpose: str = "auth",
    now: datetime | None = None,
) -> Session | None:
    """以明文 token 找出有效 session（purpose 相符、未撤銷、未過期），命中即滑動延長。

    回傳 Session 列（principal_type / principal_id / id 供呼叫端用）；無效回 None。
    延長節流：距上次延長（last_seen_at）不到 touch_interval 秒就不寫 DB。不 commit。
    """
    if not token:
        return None
    now = now or _now()
    row = (
        await session.execute(select(Session).where(Session.token_hash == token_hash(token)))
    ).scalar_one_or_none()
    if row is None or row.purpose != purpose or row.revoked_at is not None:
        return None
    if row.expires_at <= now:
        return None
    if (now - row.last_seen_at).total_seconds() >= touch_interval:
        row.expires_at = now + timedelta(seconds=ttl)
        row.last_seen_at = now
        await session.flush()
    return row


async def resolve_student_session(
    session: AsyncSession,
    token: str,
    *,
    settings: Settings,
    now: datetime | None = None,
) -> tuple[Session, Student, Team] | None:
    """學生 auth token → (session 列, 學生, 班級)；REST /auth/student/me 與 WS register 共用。

    無效 token / 非學生 session / 學生 removed / 班級已封存 → None。
    命中即依 student_session_ttl_sec 滑動延長（節流同老師）。不 commit。
    """
    row = await resolve_session(
        session,
        token,
        ttl=settings.student_session_ttl_sec,
        touch_interval=settings.session_touch_interval_sec,
        now=now,
    )
    if row is None or row.principal_type != "student":
        return None
    student = await session.get(Student, row.principal_id)
    if student is None or student.status != "active":
        return None
    team = await session.get(Team, student.team_id)
    if team is None or team.archived_at is not None:
        return None
    return row, student, team


async def revoke_session(session: AsyncSession, row: Session, now: datetime | None = None) -> None:
    """撤銷單一 session（登出）。不硬刪、留紀錄。不 commit。"""
    if row.revoked_at is None:
        row.revoked_at = now or _now()
        await session.flush()


async def revoke_all_sessions_for(
    session: AsyncSession,
    principal_type: str,
    principal_id: int,
    *,
    except_id: int | None = None,
    now: datetime | None = None,
) -> int:
    """撤銷某個 principal 的全部有效 session（換密碼 / 停權 / 踢出）；except_id 保留當前那個。

    回傳撤銷筆數。不 commit。
    """
    stmt = (
        update(Session)
        .where(
            Session.principal_type == principal_type,
            Session.principal_id == principal_id,
            Session.revoked_at.is_(None),
        )
        .values(revoked_at=now or _now())
    )
    if except_id is not None:
        stmt = stmt.where(Session.id != except_id)
    result = await session.execute(stmt)
    return result.rowcount or 0


# ---------- FastAPI dependencies ----------


async def get_account_session(request: Request) -> AsyncIterator[AsyncSession]:
    """帳號端點用的 DB session：未設定 DATABASE_URL 時回 503（帳號功能需要資料庫）。"""
    maker: async_sessionmaker[AsyncSession] | None = getattr(
        request.app.state, "db_sessionmaker", None
    )
    if maker is None:
        raise HTTPException(status_code=503, detail="帳號功能需要資料庫（未設定 DATABASE_URL）")
    async with maker() as session:
        yield session


def bearer_token(request: Request) -> str:
    """取 `Authorization: Bearer <token>`；沒有或格式不對回空字串（交給 resolve 判無效）。"""
    header = request.headers.get("authorization", "")
    scheme, _, token = header.partition(" ")
    return token.strip() if scheme.lower() == "bearer" else ""


# 端點簽名用的型別別名（Annotated + Depends，ruff B008 友善）
DbSession = Annotated[AsyncSession, Depends(get_account_session)]


async def get_current_session(request: Request, session: DbSession) -> Session:
    """Bearer → 有效 session 列（已滑動延長並 commit）；無效 401。"""
    settings: Settings = request.app.state.settings
    row = await resolve_session(
        session,
        bearer_token(request),
        ttl=settings.session_ttl_sec,
        touch_interval=settings.session_touch_interval_sec,
    )
    if row is None or row.principal_type != "teacher":
        raise HTTPException(status_code=401, detail="請先登入")
    await session.commit()  # 滑動延長（若有）落地；沒改動時只是結束一筆唯讀交易
    return row


CurrentSession = Annotated[Session, Depends(get_current_session)]


async def get_current_teacher(current: CurrentSession, session: DbSession) -> Teacher:
    """目前登入的老師（status=active）；停權帳號即使 session 仍有效也 401。"""
    teacher = await session.get(Teacher, current.principal_id)
    if teacher is None or teacher.status != "active":
        raise HTTPException(status_code=401, detail="帳號不存在或已停用")
    return teacher


CurrentTeacher = Annotated[Teacher, Depends(get_current_teacher)]
