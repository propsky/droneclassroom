"""progress.py — 帳號學生的關卡進度持久化（progress 表 + audit level.completed）。

只有「帳號模式進場（StudentRecord.student_id 有值）且有 DATABASE_URL」才走這裡；
訪客與無 DB 模式的 complete_level 行為與從前完全相同（in-memory 名冊，不回 ack）。

寫入路徑（save_completion，同一交易）：
- audit level.completed：dedupe_key = clientEventId（audit_events 唯一約束擋重送）；
  payload 帶雙時間戳（client_ts / server_ts）與本次的 suspect 判定 —— 成績爭議的唯一依據
- progress upsert：best_time_ms 取歷史最小、attempts +1、first_completed_at 只設一次、
  suspect 沿用 OR。dedupe 命中（record_event 回 None）→ 跳過 upsert，
  確保重送同一筆不會 attempts +2
- 成功（含 dedupe 命中）→ 回 True，呼叫端回 complete_ack；DB 失敗回 False：
  只 log、不擋名冊記錄、不回 ack（client 離線佇列會重試）

下行路徑：帳號模式 register 成功後查該生 progress 全列 → progress_sync
（關卡選單標記已完成、跨裝置成績同步），名冊初始 level / time 帶最近完成的關卡。
"""

import logging
import time

from sqlalchemy import func, or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from .db.audit import record_event
from .db.models import Progress, Team
from .protocol import CompleteLevelMsg, ProgressEntry, ProgressSyncMsg

logger = logging.getLogger("creafly.api.progress")


async def save_completion(
    maker: async_sessionmaker[AsyncSession],
    *,
    student_id: int,
    team_id: int | None,
    msg: CompleteLevelMsg,
    suspect_reasons: list[str],
) -> bool:
    """complete_level 入庫：audit + progress upsert 同一交易；回 True = 可回 complete_ack。

    dedupe 命中（同 clientEventId 已入庫）也回 True —— client 是因為沒收到 ack 才重送，
    這筆確實已落地，該讓它從離線佇列移除。DB 失敗回 False（log 過，不擋名冊）。
    """
    time_ms = int(round(msg.timeMs))
    suspect = bool(suspect_reasons)
    try:
        async with maker() as session:
            # org_id 供稽核的租戶範圍查詢（與其他事件一致）；查不到就留 None
            team = await session.get(Team, team_id) if team_id is not None else None
            event_id = await record_event(
                session,
                event_type="level.completed",
                actor_type="student",
                actor_id=student_id,
                org_id=team.org_id if team is not None else None,
                team_id=team_id,
                student_id=student_id,
                dedupe_key=msg.clientEventId,
                payload={
                    "level_id": msg.levelId,
                    "time_ms": time_ms,
                    "client_ts": msg.clientTs,
                    "server_ts": time.time() * 1000,  # 雙時間戳：occurred_at 之外再留一份
                    "offline": msg.offline,
                    "suspect": suspect,
                    "suspect_reasons": suspect_reasons,
                },
            )
            if event_id is not None:
                # 新事件才 upsert；dedupe 命中代表同一筆已入庫，attempts 不重複加
                await _upsert_progress(session, student_id, msg.levelId, time_ms, suspect)
            await session.commit()
        return True
    except Exception:  # noqa: BLE001 — DB 掛了不能擋上課；不回 ack 讓 client 重試
        logger.exception(
            "[Progress] 學生 #%d 完成 %s 入庫失敗（不回 ack，client 會重試）",
            student_id,
            msg.levelId,
        )
        return False


async def _upsert_progress(
    session: AsyncSession, student_id: int, level_id: str, time_ms: int, suspect: bool
) -> None:
    """一生一關一列：ON CONFLICT (student_id, level_id) DO UPDATE（db-schema.md progress）。"""
    stmt = pg_insert(Progress).values(
        student_id=student_id,
        level_id=level_id,
        best_time_ms=time_ms,
        attempts=1,
        first_completed_at=func.now(),
        last_completed_at=func.now(),
        suspect=suspect,
    )
    stmt = stmt.on_conflict_do_update(
        index_elements=[Progress.student_id, Progress.level_id],
        set_={
            # 取歷史最小；現值 NULL（理論上不會，防禦）視同無紀錄
            "best_time_ms": func.least(
                func.coalesce(Progress.best_time_ms, stmt.excluded.best_time_ms),
                stmt.excluded.best_time_ms,
            ),
            "attempts": Progress.attempts + 1,
            "first_completed_at": func.coalesce(Progress.first_completed_at, func.now()),
            "last_completed_at": func.now(),
            "suspect": or_(Progress.suspect, stmt.excluded.suspect),
            "updated_at": func.now(),  # ORM onupdate 不涵蓋 upsert，明確設
        },
    )
    await session.execute(stmt)


async def load_progress(
    maker: async_sessionmaker[AsyncSession], student_id: int
) -> list[Progress]:
    """該生 progress 全列（一班 ≤30 人、每人 16 關，直接全撈）；DB 出錯回空列只 log。"""
    try:
        async with maker() as session:
            rows = (
                await session.execute(select(Progress).where(Progress.student_id == student_id))
            ).scalars()
            return list(rows.all())
    except Exception:  # noqa: BLE001 — 歷史進度撈不到不能讓學生連不上課
        logger.exception("[Progress] 讀取學生 #%d 歷史進度失敗（本次以空進度進場）", student_id)
        return []


def progress_sync_msg(rows: list[Progress]) -> ProgressSyncMsg:
    """progress 列 → progress_sync 下行（空列也送：client 以此確認同步完成）。"""
    return ProgressSyncMsg(
        progress={
            r.level_id: ProgressEntry(bestTimeMs=r.best_time_ms, attempts=r.attempts)
            for r in rows
        }
    )


def latest_completion(rows: list[Progress]) -> Progress | None:
    """最近完成的一列（名冊初始 level / time 用：老師看到延續的進度）；沒完成過回 None。"""
    done = [r for r in rows if r.last_completed_at is not None]
    return max(done, key=lambda r: r.last_completed_at, default=None)
