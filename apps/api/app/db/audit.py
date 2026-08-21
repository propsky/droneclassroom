"""audit.py — 稽核事件 append-only 寫入（docs/db-schema.md §2 audit_events）。

所有稽核寫入都走 record_event；此表只新增、不更新、不刪除。
"""

from typing import Any

from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from .models import AuditEvent


async def record_event(
    session: AsyncSession,
    *,
    event_type: str,
    actor_type: str,
    actor_id: int | None = None,
    org_id: int | None = None,
    team_id: int | None = None,
    student_id: int | None = None,
    payload: dict[str, Any] | None = None,
    dedupe_key: str | None = None,
) -> int | None:
    """寫入一筆稽核事件，回傳 audit_events.id。

    - occurred_at 由 DB now() 產生（伺服器時間）；client 時間請放 payload
    - dedupe_key 重複時靜默略過（ON CONFLICT DO NOTHING）並回傳 None —— 離線補傳 / 重送不重複記
    - 不 commit：與呼叫端的業務寫入同一筆交易，由呼叫端決定 commit / rollback
    """
    stmt = pg_insert(AuditEvent).values(
        event_type=event_type,
        actor_type=actor_type,
        actor_id=actor_id,
        org_id=org_id,
        team_id=team_id,
        student_id=student_id,
        payload=payload or {},
        dedupe_key=dedupe_key,
    )
    if dedupe_key is not None:
        stmt = stmt.on_conflict_do_nothing(index_elements=[AuditEvent.dedupe_key])
    result = await session.execute(stmt.returning(AuditEvent.id))
    return result.scalar_one_or_none()
