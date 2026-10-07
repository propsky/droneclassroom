"""replay_logs.py — 學生輸入錄製上傳與讀取（J-01 / J-02）。

WS 訊息上限 4KB，完整 InputRecording 走 REST：
  POST /auth/student/replay-log  → logRef（audit dedupe_key）
  complete_level 帶 replayLogRef + replayHash → 伺服器重播驗證。
"""

from __future__ import annotations

import logging
import time
from collections import deque
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .accounts import CurrentStudentSession, DbSession
from .db.audit import record_event
from .db.models import AuditEvent, Level, Student, Team

logger = logging.getLogger("creafly.api.replay_logs")

router = APIRouter()

# v2 錄製 10 分鐘上限約 0.8MB；留餘裕但不讓單次請求吃掉大量記憶體
MAX_REPLAY_LOG_BYTES = 2 * 1024 * 1024


class ReplayLogUpload(BaseModel):
    clientLogId: str = Field(min_length=8, max_length=64)
    recording: dict[str, Any]


class ReplayLogResponse(BaseModel):
    logRef: str


# 每次上傳最多寫入 2MB 到稽核表：限制單一學生的上傳頻率（正常 = 每次過關一筆）
UPLOAD_RATE_LIMIT = 20
UPLOAD_RATE_WINDOW_SEC = 60.0


def _check_upload_rate(request: Request, student_id: int) -> None:
    buckets: dict[int, deque[float]] = request.app.state.replay_upload_times
    now = time.monotonic()
    q = buckets.setdefault(student_id, deque())
    while q and now - q[0] > UPLOAD_RATE_WINDOW_SEC:
        q.popleft()
    if len(q) >= UPLOAD_RATE_LIMIT:
        raise HTTPException(status_code=429, detail="上傳太頻繁")
    q.append(now)


async def _read_body_limited(request: Request, limit: int) -> bytes:
    """邊讀邊計量：超過上限立即 413，不先把整包讀進記憶體。"""
    declared = request.headers.get("content-length")
    if declared is not None and declared.isdigit() and int(declared) > limit:
        raise HTTPException(status_code=413, detail="錄製過大")
    chunks: list[bytes] = []
    size = 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > limit:
            raise HTTPException(status_code=413, detail="錄製過大")
        chunks.append(chunk)
    return b"".join(chunks)


@router.post("/auth/student/replay-log", response_model=ReplayLogResponse)
async def upload_replay_log(
    request: Request,
    current: CurrentStudentSession,
    db: DbSession,
) -> ReplayLogResponse:
    # body 不宣告成參數：FastAPI 會在驗證身分前就整包解析，未登入者也能用大請求耗記憶體。
    # 先過 CurrentStudentSession，再限量讀取
    _check_upload_rate(request, current.principal_id)
    raw = await _read_body_limited(request, MAX_REPLAY_LOG_BYTES)
    try:
        body = ReplayLogUpload.model_validate_json(raw)
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail="錄製格式錯誤") from exc
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


async def load_level_for_replay(
    session: AsyncSession, level_id: str, *, edit_grace_sec: int
) -> tuple[dict[str, Any], bool] | None:
    """伺服器權威關卡定義 + 是否為「剛被老師修改的自訂關」。

    官方關卡每次啟動都由 JSON upsert（updated_at = 啟動時刻），不算「修改」。
    """
    row = (
        await session.execute(select(Level).where(Level.level_id == level_id))
    ).scalar_one_or_none()
    if row is None or not isinstance(row.definition, dict):
        return None
    recently_edited = row.scope == "teacher" and row.updated_at is not None and (
        datetime.now(UTC) - row.updated_at
    ) < timedelta(seconds=edit_grace_sec)
    return row.definition, recently_edited


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
