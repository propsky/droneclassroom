"""測試資料庫清理 — 依 FK 順序刪除測試老師建立的資料（避免 migration 後 catalog 外鍵殘留）。

所有需 DATABASE_URL 的測試應在 teardown 呼叫 `cleanup_test_teachers()`。
"""

from __future__ import annotations

from sqlalchemy import delete, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import (
    AuditEvent,
    Level,
    Progress,
    Session,
    Student,
    Teacher,
    TeacherLevelKit,
    Team,
    TeamLevelEntry,
)
from app.db.session import create_engine, create_sessionmaker
from app.rest import DEV_TEACHER_EMAIL

# 與 tests/test_accounts.py 的 EMAIL_DOMAIN 一致
TEST_TEACHER_EMAIL_DOMAIN = "accounts-test.invalid"


async def cleanup_test_teachers(
    database_url: str,
    *,
    include_dev: bool = False,
    email_domain: str = TEST_TEACHER_EMAIL_DOMAIN,
) -> None:
    """刪除測試老師及其班級、學生、關卡素材等（FK 安全順序）。"""
    engine = create_engine(database_url)
    maker = create_sessionmaker(engine)
    async with maker() as s:
        await _delete_test_data(s, include_dev=include_dev, email_domain=email_domain)
        await s.commit()
    await engine.dispose()


async def _delete_test_data(
    s: AsyncSession,
    *,
    include_dev: bool,
    email_domain: str,
) -> None:
    cond = Teacher.email.like(f"%@{email_domain}")
    if include_dev:
        cond = or_(cond, Teacher.email == DEV_TEACHER_EMAIL)
    teacher_ids = list((await s.execute(select(Teacher.id).where(cond))).scalars().all())
    if not teacher_ids:
        return

    team_ids = list(
        (
            await s.execute(select(Team.id).where(Team.owner_teacher_id.in_(teacher_ids)))
        ).scalars().all()
    )
    student_ids: list[int] = []
    if team_ids:
        student_ids = list(
            (
                await s.execute(select(Student.id).where(Student.team_id.in_(team_ids)))
            ).scalars().all()
        )

    teacher_level_ids = list(
        (
            await s.execute(select(Level.level_id).where(Level.owner_teacher_id.in_(teacher_ids)))
        ).scalars().all()
    )

    if student_ids:
        await s.execute(delete(Progress).where(Progress.student_id.in_(student_ids)))

    audit_parts = [
        (AuditEvent.actor_type == "teacher") & AuditEvent.actor_id.in_(teacher_ids),
        text("payload->>'email' LIKE :pat").bindparams(pat=f"%@{email_domain}"),
    ]
    if team_ids:
        audit_parts.append(AuditEvent.team_id.in_(team_ids))
    if student_ids:
        audit_parts.append(AuditEvent.student_id.in_(student_ids))
        audit_parts.append(
            (AuditEvent.actor_type == "student") & AuditEvent.actor_id.in_(student_ids)
        )
    await s.execute(delete(AuditEvent).where(or_(*audit_parts)))

    session_parts = [
        (Session.principal_type == "teacher") & Session.principal_id.in_(teacher_ids),
    ]
    if student_ids:
        session_parts.append(
            (Session.principal_type == "student") & Session.principal_id.in_(student_ids)
        )
    await s.execute(delete(Session).where(or_(*session_parts)))

    if team_ids:
        await s.execute(delete(TeamLevelEntry).where(TeamLevelEntry.team_id.in_(team_ids)))
    if teacher_level_ids:
        await s.execute(
            delete(TeamLevelEntry).where(TeamLevelEntry.level_id.in_(teacher_level_ids))
        )

    if student_ids:
        await s.execute(delete(Student).where(Student.id.in_(student_ids)))

    await s.execute(delete(TeacherLevelKit).where(TeacherLevelKit.teacher_id.in_(teacher_ids)))
    await s.execute(delete(Level).where(Level.owner_teacher_id.in_(teacher_ids)))

    if team_ids:
        await s.execute(delete(Team).where(Team.id.in_(team_ids)))

    await s.execute(delete(Teacher).where(Teacher.id.in_(teacher_ids)))
