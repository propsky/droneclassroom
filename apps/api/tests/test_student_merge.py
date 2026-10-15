"""重複 email 合併：dry-run 只描述、不寫入；--apply 才把各班進度分開掛到保留帳號。"""

import asyncio
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select, text

from app.accounts import hash_password
from app.db.models import ClassProgress, Progress, Student, StudentMembership
from app.db.session import create_engine, create_sessionmaker
from app.student_merge import (
    DropPlan,
    LevelSnap,
    MembershipSnap,
    MergeGroup,
    StudentSnap,
    _load,
    apply_groups,
    build_groups,
    format_dry_run,
)
from tests.test_accounts import DATABASE_URL, needs_db
from tests.test_students import _cleanup, _insert_team, _setup_team

# ---------- 純函式：不碰資料庫 ----------


def _snap(**kw) -> StudentSnap:
    base = dict(
        id=1,
        name="王小明",
        email="ming@example.com",
        team_id=None,
        team_name="",
        student_code=None,
        has_password=False,
        created_at=datetime(2026, 1, 1, tzinfo=UTC),
        status="active",
    )
    base.update(kw)
    return StudentSnap(**base)


def test_保留有密碼的帳號_各班進度不混() -> None:
    keep = _snap(
        id=10,
        name="自行註冊",
        has_password=True,
        created_at=datetime(2026, 3, 1, tzinfo=UTC),
    )
    class_a = _snap(
        id=20,
        name="甲班生",
        team_id=1,
        team_name="甲班",
        student_code="03",
        created_at=datetime(2026, 1, 2, tzinfo=UTC),
    )
    class_b = _snap(
        id=30,
        name="乙班生",
        team_id=2,
        team_name="乙班",
        student_code="07",
        created_at=datetime(2026, 1, 3, tzinfo=UTC),
    )
    mems = [
        MembershipSnap(20, 1, "甲班", "03", "active"),
        MembershipSnap(30, 2, "乙班", "07", "active"),
    ]
    levels = [
        LevelSnap(10, "9-9", None, 1),  # 保留帳號的個人進度
        LevelSnap(20, "1-1", None, 2),  # 甲班帳號的個人進度（舊模型）
        LevelSnap(30, "1-2", None, 1),
        LevelSnap(20, "1-1", 1, 1),
    ]
    groups = build_groups([keep, class_a, class_b], mems, levels)
    assert len(groups) == 1
    g = groups[0]
    assert g.keep_id == 10
    by_id = {d.student_id: d for d in g.drops}
    assert by_id[20].personal_to_team_id == 1
    assert by_id[20].personal_to_keep is False
    assert by_id[30].personal_to_team_id == 2
    assert by_id[30].class_team_ids == []
    assert 1 in by_id[20].class_team_ids
    report = format_dry_run(groups)
    assert "不會寫入" in report
    assert "不併進其他班" in report
    assert "ming@example.com" in report
    assert "個人進度帳本不動" in report


def test_沒有重複就明講不用合併() -> None:
    report = format_dry_run([])
    assert "不會寫入" in report
    assert "沒有重複" in report


def test_format_不因呼叫而改計畫() -> None:
    """dry-run 格式化不能把 DropPlan 當成已執行。"""
    group = MergeGroup(
        email="a@b.c",
        keep_id=1,
        keep_name="甲",
        keep_reason="已設密碼",
        drops=[
            DropPlan(
                student_id=2,
                name="乙",
                team_id=5,
                team_name="五班",
                lines=["帳號 #2 乙"],
                personal_to_team_id=5,
                personal_to_keep=False,
                class_team_ids=[5],
            )
        ],
    )
    text_out = format_dry_run([group])
    assert "已寫入" not in text_out
    assert group.drops[0].personal_to_team_id == 5


# ---------- 資料庫：dry-run 不寫、apply 才搬進度 ----------


@pytest.fixture
def db_client(tmp_path) -> object:
    from tests.test_accounts import _make_client

    with _make_client(tmp_path) as c:
        yield c
    asyncio.run(_cleanup())


@needs_db
def test_dry_run不寫入_apply才合併且各班分開(db_client: TestClient) -> None:
    assert DATABASE_URL
    headers, team_a, _ = _setup_team(db_client)
    me = db_client.get("/auth/teacher/me", headers=headers).json()
    team_b, _code_b = asyncio.run(_insert_team(me, "乙班"))
    email = f"dup-{uuid.uuid4().hex[:8]}@students-test.invalid"
    now = datetime.now(UTC)

    async def _seed_and_merge() -> str:
        engine = create_engine(DATABASE_URL)
        maker = create_sessionmaker(engine)
        async with maker() as s:
            await s.execute(text("DROP INDEX IF EXISTS uq_students_lower_email"))
            keep = Student(
                name="保留",
                email=email,
                password_hash=hash_password("keep-pass-123"),
                invite_status="accepted",
                progress_mode="personal",
                created_at=now,
            )
            drop_a = Student(
                name="甲重複",
                email=email,
                team_id=team_a,
                student_code="11",
                progress_mode="personal",
                created_at=now - timedelta(days=2),
            )
            drop_b = Student(
                name="乙重複",
                email=email.upper(),
                team_id=team_b,
                student_code="12",
                progress_mode="personal",
                created_at=now - timedelta(days=1),
            )
            s.add_all([keep, drop_a, drop_b])
            await s.flush()
            s.add_all(
                [
                    StudentMembership(
                        student_id=drop_a.id,
                        team_id=team_a,
                        student_code="11",
                        origin="created",
                    ),
                    StudentMembership(
                        student_id=drop_b.id,
                        team_id=team_b,
                        student_code="12",
                        origin="created",
                    ),
                    Progress(
                        student_id=keep.id,
                        level_id="9-9",
                        best_time_ms=9000,
                        attempts=1,
                    ),
                    Progress(
                        student_id=drop_a.id,
                        level_id="1-1",
                        best_time_ms=1000,
                        attempts=2,
                    ),
                    Progress(
                        student_id=drop_b.id,
                        level_id="1-2",
                        best_time_ms=2000,
                        attempts=1,
                    ),
                ]
            )
            await s.commit()
            keep_id = keep.id
            snaps, mems, levels = await _load(s)
            groups = build_groups(snaps, mems, levels)
            report = format_dry_run(groups)
            assert "不會寫入" in report
            still = await s.scalar(
                select(func.count())
                .select_from(Student)
                .where(func.lower(Student.email) == email, Student.status == "active")
            )
            assert still == 3  # dry-run 還沒合併
            await apply_groups(s, groups)
            await s.commit()
            left = (
                (
                    await s.execute(
                        select(Student).where(func.lower(Student.email) == email)
                    )
                )
                .scalars()
                .all()
            )
            assert [st.id for st in left] == [keep_id]
            personal = await s.get(Progress, (keep_id, "9-9"))
            assert personal is not None and personal.best_time_ms == 9000
            assert await s.get(Progress, (keep_id, "1-1")) is None
            class_a = await s.get(ClassProgress, (keep_id, team_a, "1-1"))
            class_b = await s.get(ClassProgress, (keep_id, team_b, "1-2"))
            assert class_a is not None and class_a.attempts == 2
            assert class_b is not None and class_b.best_time_ms == 2000
            assert await s.get(ClassProgress, (keep_id, team_b, "1-1")) is None
            await s.execute(
                text(
                    "CREATE UNIQUE INDEX IF NOT EXISTS uq_students_lower_email "
                    "ON students (lower(email)) WHERE email IS NOT NULL"
                )
            )
            await s.commit()
        await engine.dispose()
        return report

    try:
        report = asyncio.run(_seed_and_merge())
    finally:
        # 索引若測試中斷被拿掉，補回來，避免後面的測試能再建重複 email
        async def _ensure_index() -> None:
            assert DATABASE_URL
            engine = create_engine(DATABASE_URL)
            maker = create_sessionmaker(engine)
            async with maker() as s:
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

        _null_email_then_index(email)
        asyncio.run(_ensure_index())
    assert "已寫入" not in report


def _null_email_then_index(email: str) -> None:
    async def _go() -> None:
        assert DATABASE_URL
        engine = create_engine(DATABASE_URL)
        maker = create_sessionmaker(engine)
        async with maker() as s:
            await s.execute(
                text("UPDATE students SET email = NULL WHERE lower(email) = :email"),
                {"email": email},
            )
            await s.execute(
                text(
                    "CREATE UNIQUE INDEX IF NOT EXISTS uq_students_lower_email "
                    "ON students (lower(email)) WHERE email IS NOT NULL"
                )
            )
            await s.commit()
        await engine.dispose()

    asyncio.run(_go())
