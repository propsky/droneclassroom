"""db_cleanup 單元測試 — 需 DATABASE_URL。"""

import secrets
import uuid

import pytest
from sqlalchemy import select

from app.db.models import (
    Level,
    Organization,
    Student,
    Teacher,
    TeacherLevelKit,
    Team,
    TeamLevelEntry,
)
from app.db.session import create_engine, create_sessionmaker
from tests.db_cleanup import cleanup_test_teachers
from tests.test_accounts import DATABASE_URL, EMAIL_DOMAIN, needs_db


def _email(tag: str) -> str:
    return f"{tag}-{uuid.uuid4().hex[:10]}@{EMAIL_DOMAIN}"


@needs_db
@pytest.mark.asyncio
async def test_cleanup_刪除老師班級學生與關卡素材() -> None:
    assert DATABASE_URL
    engine = create_engine(DATABASE_URL)
    maker = create_sessionmaker(engine)
    teacher_id: int
    team_id: int
    student_id: int
    level_id: str
    async with maker() as s:
        from app.accounts import hash_password

        org_id = (await s.execute(select(Organization.id).limit(1))).scalar_one_or_none()
        if org_id is None:
            org = Organization(name="測試組織", slug=f"test-{uuid.uuid4().hex[:8]}", plan="trial")
            s.add(org)
            await s.flush()
            org_id = org.id
        t = Teacher(
            org_id=org_id,
            email=_email("cleanup"),
            password_hash=hash_password("pw"),
            name="清道夫",
            role="teacher",
        )
        s.add(t)
        await s.flush()
        teacher_id = t.id
        team = Team(
            org_id=org_id,
            owner_teacher_id=teacher_id,
            name="測試班",
            team_code="".join(secrets.choice("ABCDEFGHJKLMNPQRSTUVWXYZ23456789") for _ in range(6)),
        )
        s.add(team)
        await s.flush()
        team_id = team.id
        st = Student(team_id=team_id, name="小測", student_code="01", status="active")
        s.add(st)
        await s.flush()
        student_id = st.id
        lvl = Level(
            level_id="draft-pending",
            scope="teacher",
            org_id=org_id,
            owner_teacher_id=teacher_id,
            title="素材關",
            definition={"id": "x", "name": "x"},
            status="draft",
        )
        s.add(lvl)
        await s.flush()
        lvl.level_id = f"cl-{lvl.id}"
        level_id = lvl.level_id
        s.add(
            TeamLevelEntry(
                team_id=team_id,
                level_id=level_id,
                group_label="測試",
            )
        )
        s.add(
            TeacherLevelKit(
                teacher_id=teacher_id,
                name="片段",
                category="rings",
                patch={"rings": [{"x": 0, "y": 2, "z": -3}]},
            )
        )
        await s.commit()

    await cleanup_test_teachers(DATABASE_URL, email_domain=EMAIL_DOMAIN)

    async with maker() as s:
        assert await s.get(Teacher, teacher_id) is None
        assert await s.get(Team, team_id) is None
        assert await s.get(Student, student_id) is None
        assert (
            await s.execute(select(Level).where(Level.level_id == level_id))
        ).scalar_one_or_none() is None
    await engine.dispose()
