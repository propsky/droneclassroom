"""平台管理員：老師 / 學生的增刪改查、停用、驗證、授權期限。"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from .accounts import (
    CurrentAdmin,
    DbSession,
    hash_password,
    issue_session,
    revoke_session,
)
from .config import Settings
from .db.audit import record_event
from .db.models import Organization, PlatformAdmin, Student, StudentMembership, Teacher, Team
from .licensing import license_expired
from .rest import _login_guard

logger = logging.getLogger("creafly.api.admin")
router = APIRouter()


def _ms(dt: datetime | None) -> float | None:
    return dt.timestamp() * 1000 if dt is not None else None


def _parse_until(raw: str | None) -> datetime | None:
    """空字串 = 清除期限；ISO 日期或日期時間。"""
    if raw is None:
        return None
    text = raw.strip()
    if not text:
        return None
    if len(text) == 10:
        text = f"{text}T23:59:59+00:00"
    parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed


class AdminLoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=1024)


class AdminMe(BaseModel):
    id: int
    username: str
    name: str


class AdminLoginResponse(BaseModel):
    token: str
    expiresIn: int  # noqa: N815
    me: AdminMe


@router.post("/auth/admin/login")
async def admin_login(
    request: Request, body: AdminLoginRequest, session: DbSession
) -> AdminLoginResponse:
    from .accounts import verify_password

    settings: Settings = request.app.state.settings
    ip = _login_guard(request)
    username = body.username.strip()
    admin = (
        await session.execute(select(PlatformAdmin).where(PlatformAdmin.username == username))
    ).scalar_one_or_none()
    ok = (
        admin is not None
        and admin.status == "active"
        and verify_password(admin.password_hash, body.password)
    )
    if not ok or admin is None:
        await session.commit()
        logger.info("[ADMIN] 登入失敗（IP：%s）", ip)
        raise HTTPException(status_code=401, detail="帳號或密碼錯誤")
    admin.last_login_at = datetime.now(UTC)
    token = await issue_session(
        session,
        principal_type="admin",
        principal_id=admin.id,
        ttl=settings.session_ttl_sec,
        user_agent=request.headers.get("user-agent"),
    )
    await record_event(
        session,
        event_type="admin.login",
        actor_type="teacher",
        actor_id=admin.id,
        payload={"ip": ip, "username": admin.username},
    )
    await session.commit()
    return AdminLoginResponse(
        token=token,
        expiresIn=settings.session_ttl_sec,
        me=AdminMe(id=admin.id, username=admin.username, name=admin.name),
    )


@router.post("/auth/admin/logout")
async def admin_logout(admin: CurrentAdmin, session: DbSession, request: Request) -> dict:
    from .accounts import bearer_token, resolve_session

    settings: Settings = request.app.state.settings
    row = await resolve_session(
        session,
        bearer_token(request),
        ttl=settings.session_ttl_sec,
        touch_interval=0,
    )
    if row is not None:
        await revoke_session(session, row)
    await session.commit()
    return {"ok": True, "id": admin.id}


@router.get("/auth/admin/me")
async def admin_me(admin: CurrentAdmin) -> AdminMe:
    return AdminMe(id=admin.id, username=admin.username, name=admin.name)


def _license_state(until: datetime | None) -> Literal["none", "active", "expired"]:
    if until is None:
        return "none"
    return "expired" if license_expired(until) else "active"


class TeacherRow(BaseModel):
    id: int
    name: str
    email: str
    role: str
    status: str
    orgId: int  # noqa: N815
    licensedUntil: float | None  # noqa: N815
    licenseState: str  # noqa: N815
    emailVerified: bool  # noqa: N815
    lastLoginAt: float | None  # noqa: N815
    createdAt: float  # noqa: N815
    teamCount: int  # noqa: N815


class StudentRow(BaseModel):
    id: int
    name: str
    emoji: str
    email: str | None
    studentCode: str | None  # noqa: N815
    status: str
    teamId: int | None  # noqa: N815
    activeTeamId: int | None  # noqa: N815
    progressMode: str  # noqa: N815
    licensedUntil: float | None  # noqa: N815
    licenseState: str  # noqa: N815
    emailVerified: bool  # noqa: N815
    lastSeenAt: float | None  # noqa: N815
    createdAt: float  # noqa: N815
    memberships: list[str]


def _teacher_row(t: Teacher, teams: int) -> TeacherRow:
    return TeacherRow(
        id=t.id,
        name=t.name,
        email=t.email,
        role=t.role,
        status=t.status,
        orgId=t.org_id,
        licensedUntil=_ms(t.licensed_until),
        licenseState=_license_state(t.licensed_until),
        emailVerified=t.email_verified_at is not None,
        lastLoginAt=_ms(t.last_login_at),
        createdAt=_ms(t.created_at) or 0,
        teamCount=teams,
    )


def _student_row(s: Student, codes: list[str]) -> StudentRow:
    return StudentRow(
        id=s.id,
        name=s.name,
        emoji=s.emoji,
        email=s.email,
        studentCode=s.student_code,
        status=s.status,
        teamId=s.team_id,
        activeTeamId=s.active_team_id,
        progressMode=s.progress_mode,
        licensedUntil=_ms(s.licensed_until),
        licenseState=_license_state(s.licensed_until),
        emailVerified=s.email_verified_at is not None,
        lastSeenAt=_ms(s.last_seen_at),
        createdAt=_ms(s.created_at) or 0,
        memberships=codes,
    )


@router.get("/api/admin/summary")
async def admin_summary(_: CurrentAdmin, session: DbSession) -> dict:
    teachers = (await session.execute(select(func.count()).select_from(Teacher))).scalar_one()
    students = (await session.execute(select(func.count()).select_from(Student))).scalar_one()
    teams = (await session.execute(select(func.count()).select_from(Team))).scalar_one()
    disabled_t = (
        await session.execute(
            select(func.count()).select_from(Teacher).where(Teacher.status != "active")
        )
    ).scalar_one()
    now = datetime.now(UTC)
    expired = (
        await session.execute(
            select(func.count()).select_from(Student).where(Student.licensed_until <= now)
        )
    ).scalar_one()
    return {
        "teachers": teachers,
        "students": students,
        "teams": teams,
        "disabledTeachers": disabled_t,
        "expiredStudents": expired,
    }


@router.get("/api/admin/teachers")
async def admin_list_teachers(
    _: CurrentAdmin,
    session: DbSession,
    q: str = "",
    status: str = "",
    license: str = "",
    verified: str = "",
) -> dict:
    stmt = select(Teacher).order_by(Teacher.id.desc())
    if q.strip():
        like = f"%{q.strip().lower()}%"
        stmt = stmt.where(
            or_(func.lower(Teacher.email).like(like), func.lower(Teacher.name).like(like))
        )
    if status in ("active", "disabled"):
        stmt = stmt.where(Teacher.status == status)
    rows = (await session.execute(stmt)).scalars().all()
    counts = dict(
        (
            await session.execute(
                select(Team.owner_teacher_id, func.count()).group_by(Team.owner_teacher_id)
            )
        ).all()
    )
    out = []
    for t in rows:
        state = _license_state(t.licensed_until)
        if license in ("none", "active", "expired") and state != license:
            continue
        verified_flag = t.email_verified_at is not None
        if verified == "yes" and not verified_flag:
            continue
        if verified == "no" and verified_flag:
            continue
        out.append(_teacher_row(t, int(counts.get(t.id, 0))))
    return {"teachers": [r.model_dump() for r in out]}


class TeacherWrite(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=8, max_length=1024)


class TeacherPatch(BaseModel):
    name: str | None = Field(default=None, max_length=100)
    status: Literal["active", "disabled"] | None = None
    licensedUntil: str | None = None  # noqa: N815
    emailVerified: bool | None = None  # noqa: N815
    password: str | None = Field(default=None, max_length=1024)
    clearLicense: bool = False  # noqa: N815


@router.post("/api/admin/teachers", status_code=201)
async def admin_create_teacher(
    body: TeacherWrite, admin: CurrentAdmin, session: DbSession
) -> dict:
    email = body.email.strip().lower()
    if "@" not in email:
        raise HTTPException(status_code=422, detail="email 格式不正確")
    org = (
        await session.execute(select(Organization).where(Organization.slug == "default"))
    ).scalar_one_or_none()
    if org is None:
        raise HTTPException(status_code=500, detail="預設單位不存在")
    teacher = Teacher(
        org_id=org.id,
        email=email,
        password_hash=hash_password(body.password),
        name=body.name.strip(),
        email_verified_at=datetime.now(UTC),
    )
    session.add(teacher)
    try:
        await session.flush()
    except IntegrityError:
        await session.rollback()
        raise HTTPException(status_code=409, detail="這個 email 已經註冊過") from None
    await record_event(
        session,
        event_type="teacher.register",
        actor_type="teacher",
        actor_id=admin.id,
        org_id=org.id,
        payload={"created_teacher_id": teacher.id, "via": "admin"},
    )
    await session.commit()
    return _teacher_row(teacher, 0).model_dump()


@router.patch("/api/admin/teachers/{teacher_id}")
async def admin_patch_teacher(
    teacher_id: int, body: TeacherPatch, admin: CurrentAdmin, session: DbSession
) -> dict:
    teacher = await session.get(Teacher, teacher_id)
    if teacher is None:
        raise HTTPException(status_code=404, detail="老師不存在")
    if body.name is not None and body.name.strip():
        teacher.name = body.name.strip()
    if body.status is not None:
        teacher.status = body.status
    if body.clearLicense:
        teacher.licensed_until = None
    elif body.licensedUntil is not None:
        teacher.licensed_until = _parse_until(body.licensedUntil)
    if body.emailVerified is True:
        teacher.email_verified_at = datetime.now(UTC)
    elif body.emailVerified is False:
        teacher.email_verified_at = None
    if body.password:
        if len(body.password) < 8:
            raise HTTPException(status_code=422, detail="密碼至少 8 個字元")
        teacher.password_hash = hash_password(body.password)
    await record_event(
        session,
        event_type="teacher.updated",
        actor_type="teacher",
        actor_id=admin.id,
        org_id=teacher.org_id,
        payload={"teacher_id": teacher.id, "status": teacher.status},
    )
    await session.commit()
    count = (
        await session.execute(
            select(func.count()).select_from(Team).where(Team.owner_teacher_id == teacher.id)
        )
    ).scalar_one()
    return _teacher_row(teacher, int(count)).model_dump()


@router.get("/api/admin/students")
async def admin_list_students(
    _: CurrentAdmin,
    session: DbSession,
    q: str = "",
    status: str = "",
    license: str = "",
    verified: str = "",
    progress: str = "",
) -> dict:
    stmt = select(Student).order_by(Student.id.desc())
    if status in ("active", "disabled", "removed"):
        stmt = stmt.where(Student.status == status)
    if progress in ("personal", "class"):
        stmt = stmt.where(Student.progress_mode == progress)
    rows = (await session.execute(stmt)).scalars().all()
    memberships = (
        await session.execute(select(StudentMembership, Team.team_code).join(Team))
    ).all()
    by_student: dict[int, list[str]] = {}
    for mem, code in memberships:
        if mem.status != "active":
            continue
        by_student.setdefault(mem.student_id, []).append(f"{code}/{mem.student_code}")
    needle = q.strip().lower()
    out: list[StudentRow] = []
    for s in rows:
        codes = " ".join(by_student.get(s.id, []))
        if (
            needle
            and needle not in s.name.lower()
            and needle not in (s.email or "").lower()
            and needle not in codes
        ):
            continue
        state = _license_state(s.licensed_until)
        if license in ("none", "active", "expired") and state != license:
            continue
        verified_flag = s.email_verified_at is not None
        if verified == "yes" and not verified_flag:
            continue
        if verified == "no" and verified_flag:
            continue
        out.append(_student_row(s, by_student.get(s.id, [])))
    return {"students": [r.model_dump() for r in out]}


class StudentWrite(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    email: str | None = Field(default=None, max_length=254)
    password: str | None = Field(default=None, max_length=1024)
    emoji: str = Field(default="🙂", max_length=16)


class StudentPatch(BaseModel):
    name: str | None = Field(default=None, max_length=100)
    emoji: str | None = Field(default=None, max_length=16)
    status: Literal["active", "disabled", "removed"] | None = None
    licensedUntil: str | None = None  # noqa: N815
    clearLicense: bool = False  # noqa: N815
    emailVerified: bool | None = None  # noqa: N815
    password: str | None = Field(default=None, max_length=1024)
    progressMode: Literal["personal", "class"] | None = None  # noqa: N815


@router.post("/api/admin/students", status_code=201)
async def admin_create_student(
    body: StudentWrite, admin: CurrentAdmin, session: DbSession
) -> dict:
    email = body.email.strip().lower() if body.email else None
    if email and "@" not in email:
        raise HTTPException(status_code=422, detail="email 格式不正確")
    if body.password and len(body.password) < 8:
        raise HTTPException(status_code=422, detail="密碼至少 8 個字元")
    student = Student(
        name=body.name.strip(),
        emoji=body.emoji or "🙂",
        email=email,
        password_hash=hash_password(body.password) if body.password else None,
        invite_status="accepted" if body.password else "none",
        progress_mode="personal",
    )
    session.add(student)
    await session.flush()
    await record_event(
        session,
        event_type="student.created",
        actor_type="teacher",
        actor_id=admin.id,
        student_id=student.id,
        payload={"via": "admin"},
    )
    await session.commit()
    return _student_row(student, []).model_dump()


@router.patch("/api/admin/students/{student_id}")
async def admin_patch_student(
    student_id: int, body: StudentPatch, admin: CurrentAdmin, session: DbSession
) -> dict:
    student = await session.get(Student, student_id)
    if student is None:
        raise HTTPException(status_code=404, detail="學生不存在")
    if body.name is not None and body.name.strip():
        student.name = body.name.strip()
    if body.emoji:
        student.emoji = body.emoji
    if body.status is not None:
        student.status = body.status
    if body.clearLicense:
        student.licensed_until = None
    elif body.licensedUntil is not None:
        student.licensed_until = _parse_until(body.licensedUntil)
    if body.emailVerified is True:
        student.email_verified_at = datetime.now(UTC)
    elif body.emailVerified is False:
        student.email_verified_at = None
    if body.progressMode is not None:
        student.progress_mode = body.progressMode
    if body.password:
        if len(body.password) < 8:
            raise HTTPException(status_code=422, detail="密碼至少 8 個字元")
        student.password_hash = hash_password(body.password)
    await record_event(
        session,
        event_type="student.updated",
        actor_type="teacher",
        actor_id=admin.id,
        student_id=student.id,
        payload={"status": student.status, "progress_mode": student.progress_mode},
    )
    await session.commit()
    return _student_row(student, await _codes(session, student.id)).model_dump()


async def _codes(session: AsyncSession, student_id: int) -> list[str]:
    rows = (
        await session.execute(
            select(StudentMembership, Team.team_code)
            .join(Team, Team.id == StudentMembership.team_id)
            .where(
                StudentMembership.student_id == student_id,
                StudentMembership.status == "active",
            )
        )
    ).all()
    return [f"{code}/{mem.student_code}" for mem, code in rows]


@router.get("/api/admin/teams")
async def admin_list_teams(_: CurrentAdmin, session: DbSession) -> dict:
    rows = (await session.execute(select(Team).order_by(Team.id.desc()))).scalars().all()
    return {
        "teams": [
            {
                "id": t.id,
                "name": t.name,
                "teamCode": t.team_code,
                "locked": t.locked,
                "archived": t.archived_at is not None,
            }
            for t in rows
        ]
    }


async def ensure_platform_admin(session: AsyncSession, cfg: Settings) -> None:
    """密碼有設且帳號不存在才建立。已存在不改密碼。"""
    password = cfg.platform_admin_password
    if not password:
        return
    username = cfg.platform_admin_username.strip() or "admin"
    existing = (
        await session.execute(select(PlatformAdmin).where(PlatformAdmin.username == username))
    ).scalar_one_or_none()
    if existing is not None:
        return
    session.add(
        PlatformAdmin(
            username=username,
            password_hash=hash_password(password),
            name=cfg.platform_admin_name,
        )
    )
    await session.commit()
    logger.info("[ADMIN] 已建立平台管理員帳號 %s", username)
