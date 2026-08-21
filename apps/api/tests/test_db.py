"""資料庫層測試 — /api/health 的 db 欄位、record_event 寫入與 dedupe。

需要真實 PostgreSQL 的測試以 DATABASE_URL（環境變數或 apps/api/.env）為準，
沒設就 skip；既有測試（conftest 的 client fixture）一律無資料庫模式。
"""

import uuid
from collections.abc import AsyncIterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.db.audit import record_event
from app.db.models import AuditEvent
from app.db.session import create_engine, create_sessionmaker
from app.main import create_app

DATABASE_URL = Settings().database_url
needs_db = pytest.mark.skipif(not DATABASE_URL, reason="未設定 DATABASE_URL，略過真實資料庫測試")


def test_health_db_disabled(client: TestClient) -> None:
    """無資料庫模式：/api/health 回 db=disabled（既有流程零改變）。"""
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok", "db": "disabled"}


@pytest.fixture
async def db_session() -> AsyncIterator[AsyncSession]:
    """一個不 commit 的 session：測試結束 rollback，不在 RDS 留下資料。"""
    assert DATABASE_URL
    engine = create_engine(DATABASE_URL)
    maker = create_sessionmaker(engine)
    async with maker() as session:
        yield session
        await session.rollback()
    await engine.dispose()


@needs_db
async def test_record_event_and_dedupe(db_session: AsyncSession) -> None:
    """record_event 寫一筆可查回；同 dedupe_key 再寫一次靜默略過、不重複。"""
    key = f"test-{uuid.uuid4()}"
    first = await record_event(
        db_session,
        event_type="level.completed",
        actor_type="student",
        payload={"level_id": "1-1", "time_ms": 12345},
        dedupe_key=key,
    )
    assert isinstance(first, int)

    row = (
        await db_session.execute(select(AuditEvent).where(AuditEvent.dedupe_key == key))
    ).scalar_one()
    assert row.id == first
    assert row.event_type == "level.completed"
    assert row.actor_type == "student"
    assert row.payload == {"level_id": "1-1", "time_ms": 12345}
    assert row.occurred_at is not None  # DB now()

    second = await record_event(
        db_session,
        event_type="level.completed",
        actor_type="student",
        payload={"level_id": "1-1", "time_ms": 99999},
        dedupe_key=key,
    )
    assert second is None
    count = (
        await db_session.execute(
            select(func.count()).select_from(AuditEvent).where(AuditEvent.dedupe_key == key)
        )
    ).scalar_one()
    assert count == 1


@needs_db
def test_health_db_ok(tmp_path: Path) -> None:
    """設了 DATABASE_URL：lifespan 建 engine，/api/health 回 db=ok。"""
    static_dir = tmp_path / "dist"
    static_dir.mkdir()
    settings = Settings(
        static_dir=static_dir,
        teacher_dist=tmp_path / "no-teacher-dist",
        teacher_password="test123",
        game_tick_interval=0,
        database_url=DATABASE_URL,
    )
    with TestClient(create_app(settings)) as c:
        r = c.get("/api/health")
        assert r.status_code == 200
        assert r.json() == {"status": "ok", "db": "ok"}
        assert c.app.state.db_engine is not None
