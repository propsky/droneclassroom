"""replay_logs.py — 學生輸入錄製上傳與讀取（J-01 / J-02）。

WS 訊息上限 4KB，完整 InputRecording 走 REST：
  POST /auth/student/replay-log  → logRef（audit dedupe_key）
  complete_level 帶 replayLogRef + replayHash → 伺服器重播驗證。
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .accounts import CurrentStudentSession, DbSession
from .db.audit import record_event
from .db.models import AuditEvent, Student, Team

logger = logging.getLogger("creafly.api.replay_logs")

router = APIRouter()

MAX_REPLAY_LOG_BYTES = 4 * 1024 * 1024


class ReplayLogUpload(BaseModel):
    clientLogId: str = Field(min_length=8, max_length=64)
    recording: dict[str, Any]


class ReplayLogResponse(BaseModel):
    logRef: str


@router.post("/auth/student/replay-log", response_model=ReplayLogResponse)
async def upload_replay_log(
    body: ReplayLogUpload,
    current: CurrentStudentSession,
    db: DbSession,
) -> ReplayLogResponse:
    raw_size = len(str(body.recording).encode("utf-8"))
    if raw_size > MAX_REPLAY_LOG_BYTES:
        raise HTTPException(status_code=413, detail="錄製過大")
    rec = body.recording
    if rec.get("levelId") is None or rec.get("replayHash") is None:
        raise HTTPException(status_code=400, detail="錄製格式不完整")
    student = await db.get(Student, current.principal_id)
    if student is None:
        raise HTTPException(status_code=401, detail="學生不存在")
    team = await db.get(Team, student.team_id)
    event_id = await record_event(
        db,
        event_type="replay.input_log",
        actor_type="student",
        actor_id=student.id,
        org_id=team.org_id if team is not None else None,
        team_id=student.team_id,
        student_id=student.id,
        dedupe_key=body.clientLogId,
        payload={"recording": body.recording},
    )
    if event_id is None:
        row = (
            await db.execute(
                select(AuditEvent).where(AuditEvent.dedupe_key == body.clientLogId)
            )
        ).scalar_one_or_none()
        if row is None:
            raise HTTPException(status_code=500, detail="dedupe 查詢失敗")
        return ReplayLogResponse(logRef=body.clientLogId)
    await db.commit()
    return ReplayLogResponse(logRef=body.clientLogId)


async def load_replay_recording(
    session: AsyncSession, log_ref: str, student_id: int
) -> dict | None:
    row = (
        await session.execute(
            select(AuditEvent).where(
                AuditEvent.dedupe_key == log_ref,
                AuditEvent.student_id == student_id,
                AuditEvent.event_type == "replay.input_log",
            )
        )
    ).scalar_one_or_none()
    if row is None or not isinstance(row.payload, dict):
        return None
    rec = row.payload.get("recording")
    return rec if isinstance(rec, dict) else None
