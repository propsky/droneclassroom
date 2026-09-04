"""students_api.py — 學生帳號：老師建名單 / 邀請信、學生登入 / 邀請 accept / me。

端點對齊 packages/shared/src/rest.ts 學生段落；全部需要 DATABASE_URL（無 DB 回 503）。

- 老師端（Bearer 老師 + 該班 owner 檢查）：
  POST /api/teams/{teamId}/students   批次建學生（可順便寄邀請信）
  GET  /api/teams/{teamId}/students   全列（含 removed，前端自己篩）
  POST /api/students/{id}/reinvite    重寄邀請信（舊邀請 token 撤銷）
  DELETE /api/students/{id}           移除（status=removed + 撤 session + 在線踢出）
- 學生端：
  POST /auth/student/login            班級碼+學生碼 或 email+密碼（擇一）
  GET  /auth/student/invite/{token}   設密碼頁載入時查邀請對象
  POST /auth/student/invite/accept    設密碼 → 完成即登入
  GET  /auth/student/me               驗 token + 滑動延長
  POST /auth/student/logout           撤銷目前 session（Bearer）

設計取捨：
- student_code 每班流水（'01' 起）：配號前 SELECT ... FOR UPDATE 鎖住 team 列，
  同班併發建立序列化；(team_id, student_code) 唯一約束是 DB 層保險
- 邀請 token = sessions 表一列（principal_type='student', purpose='invite', TTL 7 天）：
  不另開表（db-schema.md §3 的擴充點）；accept 用過即撤銷、完成即登入
- 寄信永遠是加分項：寄失敗 invite_status 留 'none'、invitesSent=false，不擋建立；
  失敗的 token 不撤（7 天自然過期，reinvite 時一併撤舊）
- 學生登入失敗一律 401 統一訊息（防枚舉）；沿用老師登入的 Origin 白名單 + 同 IP 限流
- 有 email 且接受過邀請（已設密碼）的學生，用碼登入也要求密碼 —— 防同學互冒
"""

import html as html_escape
import logging
from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .accounts import (
    CurrentStudentSession,
    CurrentTeacher,
    DbSession,
    bearer_token,
    hash_password,
    issue_session,
    resolve_student_session,
    revoke_all_sessions_for,
    revoke_session,
    token_hash,
    verify_password,
)
from .config import Settings
from .db.audit import record_event
from .db.models import Session as SessionRow
from .db.models import Student, Teacher, Team
from .mailer import Mailer

# 登入類端點共用前置（Origin 白名單 + 同 IP 限流）與 email 正規化沿用 rest.py
from .rest import _login_guard, _normalize_email
from .rooms import RoomManager

logger = logging.getLogger("creafly.api.students")

router = APIRouter()

# 一批最多建幾位（一個班一次貼整班名單綽綽有餘，防手滑貼錯檔案）
MAX_BATCH_SIZE = 100


# ---------- 回應模型（欄位名對齊 rest.ts，camelCase）----------


class StudentIn(BaseModel):
    """批次建學生的一列；email / emoji 選填。"""

    name: str = Field(min_length=1, max_length=100)
    email: str | None = Field(default=None, max_length=254)
    emoji: str | None = Field(default=None, max_length=16)


class StudentsCreateRequest(BaseModel):
    """POST /api/teams/{teamId}/students 請求。"""

    students: list[StudentIn] = Field(min_length=1, max_length=MAX_BATCH_SIZE)
    # 有 email 的是否立刻寄邀請信（寄失敗不擋建立）
    sendInvites: bool = True  # noqa: N815


class StudentEntry(BaseModel):
    """學生一列（rest.ts StudentEntry）。"""

    id: int
    name: str
    emoji: str
    studentCode: str  # noqa: N815
    email: str | None
    inviteStatus: Literal["none", "sent", "accepted"]  # noqa: N815
    status: Literal["active", "removed"]
    createdAt: float  # noqa: N815 — epoch 毫秒（與 Date.now() 同制）
    lastSeenAt: float | None  # noqa: N815


class StudentsCreateResponse(BaseModel):
    """建立結果 + 邀請信寄送結果（email → true/false；停用寄信時全 false）。"""

    created: list[StudentEntry]
    invitesSent: dict[str, bool]  # noqa: N815


class StudentsListResponse(BaseModel):
    students: list[StudentEntry]


class ReinviteResponse(BaseModel):
    sent: bool


class StudentMe(BaseModel):
    """學生身分（rest.ts StudentMe）。"""

    id: int
    name: str
    emoji: str
    teamId: int  # noqa: N815
    teamName: str  # noqa: N815
    teamCode: str  # noqa: N815
    studentCode: str  # noqa: N815


class StudentLoginRequest(BaseModel):
    """兩種擇一：{teamCode, studentCode(, password)} 或 {email, password}。"""

    teamCode: str | None = Field(default=None, max_length=20)  # noqa: N815
    studentCode: str | None = Field(default=None, max_length=20)  # noqa: N815
    email: str | None = Field(default=None, max_length=254)
    password: str | None = Field(default=None, max_length=1024)


class StudentLoginResponse(BaseModel):
    """登入 / 邀請 accept 共同回應：session token + 有效秒數 + 身分。"""

    token: str
    expiresIn: int  # noqa: N815
    me: StudentMe


class StudentLogoutResponse(BaseModel):
    ok: Literal[True] = True


class InviteAcceptRequest(BaseModel):
    """POST /auth/student/invite/accept 請求。"""

    inviteToken: str = Field(max_length=200)  # noqa: N815
    password: str = Field(max_length=1024)


class InviteInfoResponse(BaseModel):
    """GET /auth/student/invite/{token} 回應（設密碼頁顯示「你是誰、加入哪班」）。"""

    name: str
    teamName: str  # noqa: N815
    email: str


# ---------- 共用小工具 ----------


def _epoch_ms(dt: datetime | None) -> float | None:
    return dt.timestamp() * 1000 if dt is not None else None


def _entry(s: Student) -> StudentEntry:
    return StudentEntry(
        id=s.id,
        name=s.name,
        emoji=s.emoji,
        studentCode=s.student_code,
        email=s.email,
        inviteStatus=s.invite_status,  # type: ignore[arg-type] — DB CHECK 已限定
        status=s.status,  # type: ignore[arg-type]
        createdAt=_epoch_ms(s.created_at) or 0,
        lastSeenAt=_epoch_ms(s.last_seen_at),
    )


def _me(student: Student, team: Team) -> StudentMe:
    return StudentMe(
        id=student.id,
        name=student.name,
        emoji=student.emoji,
        teamId=team.id,
        teamName=team.name,
        teamCode=team.team_code,
        studentCode=student.student_code,
    )


async def _owned_team(
    session: AsyncSession, teacher: Teacher, team_id: int, *, for_update: bool = False
) -> Team:
    """該老師擁有且未封存的班級；不是就 404（不區分「不存在」與「不是你的」，防枚舉）。

    for_update=True：鎖住 team 列到交易結束（批次建學生配流水碼的併發保護）。
    """
    stmt = select(Team).where(Team.id == team_id)
    if for_update:
        stmt = stmt.with_for_update()
    team = (await session.execute(stmt)).scalar_one_or_none()
    if team is None or team.owner_teacher_id != teacher.id or team.archived_at is not None:
        raise HTTPException(status_code=404, detail="班級不存在")
    return team


async def _owned_student(
    session: AsyncSession, teacher: Teacher, student_id: int
) -> tuple[Student, Team]:
    """該老師班上的學生（含 removed）；不是就 404。"""
    student = await session.get(Student, student_id)
    if student is not None:
        team = await session.get(Team, student.team_id)
        if team is not None and team.owner_teacher_id == teacher.id:
            return student, team
    raise HTTPException(status_code=404, detail="學生不存在")


async def _revoke_invite_tokens(session: AsyncSession, student_id: int) -> None:
    """撤銷該生所有仍有效的邀請 token（reinvite 前呼叫：一人只留最新一張）。不 commit。"""
    rows = (
        (
            await session.execute(
                select(SessionRow).where(
                    SessionRow.principal_type == "student",
                    SessionRow.principal_id == student_id,
                    SessionRow.purpose == "invite",
                    SessionRow.revoked_at.is_(None),
                )
            )
        )
        .scalars()
        .all()
    )
    for row in rows:
        await revoke_session(session, row)


# ---------- 邀請信 ----------


def _invite_mail(
    *, student_name: str, team_name: str, teacher_name: str, link: str, days: int
) -> tuple[str, str, str]:
    """邀請信文案（繁中）：回傳 (主旨, html, 純文字)。不做模板引擎，f-string 就夠。"""
    subject = f"CREAFLY 無人機教室 — 邀請你加入「{team_name}」"
    text = (
        f"{student_name} 同學你好：\n\n"
        f"{teacher_name} 老師邀請你加入 CREAFLY 教室無人機模擬器的班級「{team_name}」。\n"
        f"點下面的連結設定密碼，就可以開始飛行囉：\n\n"
        f"{link}\n\n"
        f"（連結 {days} 天內有效；過期請找老師重新寄送邀請）\n"
        f"如果你不認識這位老師，忽略這封信即可。\n"
    )
    esc_student = html_escape.escape(student_name)
    esc_team = html_escape.escape(team_name)
    esc_teacher = html_escape.escape(teacher_name)
    html = (
        f"<p>{esc_student} 同學你好：</p>"
        f"<p>{esc_teacher} 老師邀請你加入 CREAFLY 教室無人機模擬器的班級"
        f"「<b>{esc_team}</b>」。</p>"
        f"<p>點下面的按鈕設定密碼，就可以開始飛行囉：</p>"
        f'<p><a href="{link}" style="display:inline-block;padding:10px 24px;'
        f'background:#2563eb;color:#fff;border-radius:6px;text-decoration:none">'
        f"設定密碼並加入</a></p>"
        f'<p>按鈕打不開的話，複製這個網址到瀏覽器：<br><a href="{link}">{link}</a></p>'
        f"<p style=\"color:#666\">（連結 {days} 天內有效；過期請找老師重新寄送邀請。"
        f"如果你不認識這位老師，忽略這封信即可。）</p>"
    )
    return subject, html, text


async def _send_invite(
    request: Request, session: AsyncSession, team: Team, student: Student, teacher: Teacher
) -> bool:
    """發一張邀請 token 並寄信；成功 → invite_status='sent' + audit student.invited。

    寄失敗（含停用模式）→ invite_status 留 'none'、回 False，不擋任何流程；
    token 不撤（7 天自然過期），停用模式下 log 裡的連結仍可用（本機開發拿邀請連結的途徑）。
    """
    assert student.email
    settings: Settings = request.app.state.settings
    mailer: Mailer = request.app.state.mailer
    token = await issue_session(
        session,
        principal_type="student",
        principal_id=student.id,
        ttl=settings.invite_ttl_sec,
        purpose="invite",
    )
    link = f"{settings.public_student_url.rstrip('/')}/?invite={token}"
    if not mailer.enabled:
        # 停用模式：連結印到 log（開發 / 冒煙測試沒有真信箱，這是拿到邀請連結的唯一途徑）
        logger.info("[MAIL] 停用模式邀請連結（%s）：%s", student.email, link)
    days = max(1, settings.invite_ttl_sec // 86400)
    subject, html, text = _invite_mail(
        student_name=student.name,
        team_name=team.name,
        teacher_name=teacher.name,
        link=link,
        days=days,
    )
    sent = await mailer.send(to=student.email, subject=subject, html=html, text=text)
    if sent:
        student.invite_status = "sent"
        await record_event(
            session,
            event_type="student.invited",
            actor_type="teacher",
            actor_id=teacher.id,
            org_id=team.org_id,
            team_id=team.id,
            student_id=student.id,
            payload={"email": student.email},
        )
    return sent


# ---------- 老師端點 ----------


@router.post("/api/teams/{team_id}/students", status_code=201)
async def students_create(
    request: Request,
    team_id: int,
    body: StudentsCreateRequest,
    teacher: CurrentTeacher,
    session: DbSession,
) -> StudentsCreateResponse:
    """批次建學生：student_code 每班流水（'01' 起）；班內重複 email 整批回滾 409。

    建立先 commit（寄信失敗不影響已建立的學生），邀請信另一筆交易寄送與記狀態。
    """
    # FOR UPDATE 鎖 team 列：同班兩位老師分頁同時貼名單也不會配出重號
    team = await _owned_team(session, teacher, team_id, for_update=True)
    existing = (
        (await session.execute(select(Student).where(Student.team_id == team.id))).scalars().all()
    )
    existing_emails = {s.email for s in existing if s.email}
    next_code = (
        max((int(s.student_code) for s in existing if s.student_code.isdigit()), default=0) + 1
    )
    created: list[Student] = []
    batch_emails: set[str] = set()
    for i, item in enumerate(body.students, start=1):
        email = _normalize_email(item.email) if item.email else None
        if email is not None:
            if "@" not in email:
                raise HTTPException(status_code=422, detail=f"第 {i} 列 email 格式不正確")
            if email in existing_emails or email in batch_emails:
                # 整批不建：HTTPException 讓交易回滾（含 FOR UPDATE 鎖釋放）
                raise HTTPException(
                    status_code=409, detail=f"第 {i} 列 email 已存在班內：{email}"
                )
            batch_emails.add(email)
        student = Student(
            team_id=team.id,
            name=item.name.strip(),
            email=email,
            student_code=f"{next_code:02d}",
        )
        if item.emoji:
            student.emoji = item.emoji
        next_code += 1
        session.add(student)
        created.append(student)
    await session.flush()
    await record_event(
        session,
        event_type="student.created",
        actor_type="teacher",
        actor_id=teacher.id,
        org_id=team.org_id,
        team_id=team.id,
        payload={
            "count": len(created),
            "students": [
                {"id": s.id, "name": s.name, "student_code": s.student_code, "email": s.email}
                for s in created
            ],
        },
    )
    await session.commit()  # 建立落地；接下來寄信失敗不影響
    invites_sent: dict[str, bool] = {}
    if body.sendInvites:
        for student in created:
            if student.email:
                invites_sent[student.email] = await _send_invite(
                    request, session, team, student, teacher
                )
        await session.commit()  # invite token / invite_status / audit 落地
    logger.info(
        "[Students] 班級 #%d 建 %d 位學生（寄邀請 %d 封）",
        team.id,
        len(created),
        sum(invites_sent.values()),
    )
    return StudentsCreateResponse(
        created=[_entry(s) for s in created], invitesSent=invites_sent
    )


@router.get("/api/teams/{team_id}/students")
async def students_list(
    team_id: int, teacher: CurrentTeacher, session: DbSession
) -> StudentsListResponse:
    """全班學生（含 removed，前端自己篩）；依學生碼排序。"""
    team = await _owned_team(session, teacher, team_id)
    students = (
        (
            await session.execute(
                select(Student)
                .where(Student.team_id == team.id)
                .order_by(Student.student_code, Student.id)
            )
        )
        .scalars()
        .all()
    )
    return StudentsListResponse(students=[_entry(s) for s in students])


@router.post("/api/students/{student_id}/reinvite")
async def student_reinvite(
    request: Request, student_id: int, teacher: CurrentTeacher, session: DbSession
) -> ReinviteResponse:
    """重寄邀請信：舊邀請 token 全撤、發新的一張再寄。"""
    student, team = await _owned_student(session, teacher, student_id)
    if student.status != "active":
        raise HTTPException(status_code=404, detail="學生不存在")
    if not student.email:
        raise HTTPException(status_code=400, detail="該學生沒有 email，無法寄邀請信")
    await _revoke_invite_tokens(session, student.id)
    sent = await _send_invite(request, session, team, student, teacher)
    await session.commit()
    return ReinviteResponse(sent=sent)


@router.delete("/api/students/{student_id}", status_code=204)
async def student_remove(
    request: Request, student_id: int, teacher: CurrentTeacher, session: DbSession
) -> None:
    """移除學生：status='removed'（進度保留）+ 撤銷該生所有 session + 在線就踢出（close 4001）。"""
    student, team = await _owned_student(session, teacher, student_id)
    student.status = "removed"
    revoked = await revoke_all_sessions_for(session, "student", student.id)
    await record_event(
        session,
        event_type="student.removed",
        actor_type="teacher",
        actor_id=teacher.id,
        org_id=team.org_id,
        team_id=team.id,
        student_id=student.id,
        payload={"revoked_sessions": revoked},
    )
    await session.commit()
    # 該班的房開著且本人在線 → 踢出（WS_CLOSE_KICKED=4001，學生端回進房畫面）
    rooms: RoomManager = request.app.state.rooms
    room = rooms.get_by_team(team.id)
    if room is not None:
        record = next((r for r in room.roster.students if r.student_id == student.id), None)
        if record is not None:
            await rooms.kick(room, record)
    logger.info("[Students] 移除學生 #%d（撤銷 session %d 個）", student.id, revoked)


# ---------- 學生認證端點 ----------


def _now() -> datetime:
    return datetime.now(UTC)


async def _login_by_code(
    session: AsyncSession, team_code: str, student_code: str, password: str | None
) -> tuple[Student | None, Team | None, bool]:
    """班級碼 + 學生碼路徑：回 (學生, 班級, 驗證通過)。

    已設密碼（接受過邀請）的學生走此路徑也要求密碼 —— 只憑投影幕上的班級碼 +
    看得到的座號就能冒充同學，設過密碼的帳號不允許。沒帶密碼時回 401
    detail='password_required'（前端據此展開密碼欄，不算登入失敗、不記 audit）。
    """
    team = (
        await session.execute(
            select(Team).where(
                Team.team_code == team_code.strip().upper(), Team.archived_at.is_(None)
            )
        )
    ).scalar_one_or_none()
    if team is None:
        return None, None, False
    code = student_code.strip()
    if code.isdigit():
        code = code.zfill(2)  # 學生打 '1' 也認得（配號固定兩位起）
    student = (
        await session.execute(
            select(Student).where(
                Student.team_id == team.id,
                Student.student_code == code,
                Student.status == "active",
            )
        )
    ).scalar_one_or_none()
    if student is None:
        return None, team, False
    if student.password_hash is not None:
        if password is None:
            raise HTTPException(status_code=401, detail="password_required")
        return student, team, verify_password(student.password_hash, password)
    return student, team, True


async def _login_by_email(
    session: AsyncSession, email: str, password: str
) -> tuple[Student | None, Team | None, bool]:
    """email + 密碼路徑。email 只保證班內唯一（跨班可重複）→ 逐一比對密碼，中者即身分。"""
    candidates = (
        (
            await session.execute(
                select(Student).where(
                    func.lower(Student.email) == email,
                    Student.status == "active",
                    Student.password_hash.is_not(None),
                )
            )
        )
        .scalars()
        .all()
    )
    for student in candidates:
        team = await session.get(Team, student.team_id)
        if team is None or team.archived_at is not None:
            continue
        assert student.password_hash is not None
        if verify_password(student.password_hash, password):
            return student, team, True
    return None, None, False


async def _issue_student_login(
    request: Request, session: AsyncSession, student: Student, team: Team
) -> StudentLoginResponse:
    """發學生 auth session + 組回應（登入 / 邀請 accept 共用）。不 commit。"""
    settings: Settings = request.app.state.settings
    token = await issue_session(
        session,
        principal_type="student",
        principal_id=student.id,
        ttl=settings.student_session_ttl_sec,
        user_agent=request.headers.get("user-agent"),
    )
    student.last_seen_at = _now()
    return StudentLoginResponse(
        token=token, expiresIn=settings.student_session_ttl_sec, me=_me(student, team)
    )


@router.post("/auth/student/login")
async def student_login(
    request: Request, body: StudentLoginRequest, session: DbSession
) -> StudentLoginResponse:
    """學生登入：Origin → 限流 → 兩種路徑擇一 → 發 session。

    失敗一律 401 統一訊息（不透露班級碼 / 學生碼 / email 哪個錯，防枚舉）。
    """
    ip = _login_guard(request)
    if body.email:
        student, team, ok = await _login_by_email(
            session, _normalize_email(body.email), body.password or ""
        )
        method = "email"
    elif body.teamCode and body.studentCode:
        student, team, ok = await _login_by_code(
            session, body.teamCode, body.studentCode, body.password
        )
        method = "code"
    else:
        raise HTTPException(
            status_code=422, detail="請帶 teamCode + studentCode 或 email + password"
        )
    if not ok or student is None or team is None:
        await record_event(
            session,
            event_type="student.login_failed",
            actor_type="student",
            actor_id=student.id if student else None,
            org_id=team.org_id if team else None,
            team_id=team.id if team else None,
            student_id=student.id if student else None,
            payload={"ip": ip, "method": method},
        )
        await session.commit()
        logger.info("[AUTH] 學生登入失敗（IP：%s）", ip)
        raise HTTPException(status_code=401, detail="登入資訊不正確")
    result = await _issue_student_login(request, session, student, team)
    await record_event(
        session,
        event_type="student.login",
        actor_type="student",
        actor_id=student.id,
        org_id=team.org_id,
        team_id=team.id,
        student_id=student.id,
        payload={"ip": ip, "method": method},
    )
    await session.commit()
    logger.info("[AUTH] 學生登入成功：id=%s（IP：%s）", student.id, ip)
    return result


async def _valid_invite(
    session: AsyncSession, token: str
) -> tuple[SessionRow, Student, Team] | None:
    """有效邀請 token → (session 列, 學生, 班級)；無效 / 過期 / removed / 封存 → None。

    刻意不走 resolve_session：邀請 token 不滑動延長（7 天就是 7 天）。
    """
    if not token:
        return None
    row = (
        await session.execute(
            select(SessionRow).where(SessionRow.token_hash == token_hash(token))
        )
    ).scalar_one_or_none()
    if (
        row is None
        or row.purpose != "invite"
        or row.principal_type != "student"
        or row.revoked_at is not None
        or row.expires_at <= _now()
    ):
        return None
    student = await session.get(Student, row.principal_id)
    if student is None or student.status != "active":
        return None
    team = await session.get(Team, student.team_id)
    if team is None or team.archived_at is not None:
        return None
    return row, student, team


@router.get("/auth/student/invite/{token}")
async def invite_info(token: str, session: DbSession) -> InviteInfoResponse:
    """設密碼頁載入時查邀請對象（顯示「你是誰、加入哪班」）；無效一律 404。"""
    found = await _valid_invite(session, token)
    if found is None:
        raise HTTPException(status_code=404, detail="邀請連結無效或已過期")
    _, student, team = found
    return InviteInfoResponse(name=student.name, teamName=team.name, email=student.email or "")


@router.post("/auth/student/invite/accept")
async def invite_accept(
    request: Request, body: InviteAcceptRequest, session: DbSession
) -> StudentLoginResponse:
    """邀請連結設密碼：invite_status='accepted' → 撤邀請 token → 發正式 session（完成即登入）。"""
    settings: Settings = request.app.state.settings
    ip = _login_guard(request)  # 設密碼也算登入類端點：Origin + 限流
    found = await _valid_invite(session, body.inviteToken)
    if found is None:
        raise HTTPException(status_code=404, detail="邀請連結無效或已過期")
    if len(body.password) < settings.password_min_length:
        raise HTTPException(
            status_code=422, detail=f"密碼至少 {settings.password_min_length} 個字元"
        )
    row, student, team = found
    student.password_hash = hash_password(body.password)
    student.invite_status = "accepted"
    await revoke_session(session, row)  # 一次性：用過即失效
    result = await _issue_student_login(request, session, student, team)
    await record_event(
        session,
        event_type="student.joined",
        actor_type="student",
        actor_id=student.id,
        org_id=team.org_id,
        team_id=team.id,
        student_id=student.id,
        payload={"ip": ip},
    )
    await session.commit()
    logger.info("[AUTH] 學生接受邀請並設密碼：id=%s（IP：%s）", student.id, ip)
    return result


@router.get("/auth/student/me")
async def student_me(request: Request, session: DbSession) -> StudentMe:
    """Bearer 學生 token → 身分；resolve 已順便滑動延長（節流同老師）。"""
    settings: Settings = request.app.state.settings
    resolved = await resolve_student_session(session, bearer_token(request), settings=settings)
    if resolved is None:
        raise HTTPException(status_code=401, detail="請先登入")
    _, student, team = resolved
    await session.commit()  # 滑動延長（若有）落地
    return _me(student, team)


@router.post("/auth/student/logout")
async def student_logout(
    request: Request, session: DbSession, current: CurrentStudentSession
) -> StudentLogoutResponse:
    """撤銷目前學生 session（與老師 logout 對齊）。"""
    student = await session.get(Student, current.principal_id)
    team = await session.get(Team, student.team_id) if student is not None else None
    await revoke_session(session, current)
    if student is not None and team is not None:
        await record_event(
            session,
            event_type="student.logout",
            actor_type="student",
            actor_id=student.id,
            org_id=team.org_id,
            team_id=team.id,
            student_id=student.id,
            payload={"ip": request.client.host if request.client else "?"},
        )
    await session.commit()
    return StudentLogoutResponse()
