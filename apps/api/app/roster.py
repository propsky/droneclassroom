"""roster.py — in-memory 學生名冊 / 進度 / 老師扇出。

行為對齊 apps/server/src/students.ts：
- 學生連上先發 welcome { id: "s<n>" }（遞增計數）
- register 同名 = 重連：踢掉舊連線（close code 4000）、繼承進度
- progress / complete_level → 對所有老師扇出 student_update
- 名冊變動（上線 / 註冊 / 斷線）→ 對所有老師扇出完整 student_list
- 學生斷線：已註冊者保留名冊、標記 connected=False（供重連繼承）；
  未註冊者（name 仍為 '?'）直接移除，避免老師後台堆積幽靈列

所有狀態封裝在本類別（掛在 app.state.roster），無模組級全域可變狀態。
"""

import contextlib
import logging
import time
from dataclasses import dataclass, field

from fastapi import WebSocket
from starlette.websockets import WebSocketState

from .protocol import (
    WS_CLOSE_REPLACED,
    StudentBrief,
    StudentInfo,
    StudentListMsg,
    StudentUpdateMsg,
    TeacherBroadcastPayload,
    WelcomeMsg,
)

logger = logging.getLogger("creafly.api.roster")

# ---------- 防作弊判定門檻（標記不阻擋：只在名冊標 suspect，由老師人工判斷）----------

# 宣稱用時下限：任何關卡光起飛都不只 1 秒，低於此值必是偽造的 complete_level
SUSPECT_MIN_TIME_MS = 1000.0
# 宣稱用時 < 伺服器觀察經過時間的一半 → 可疑。取 0.5 而非 1.0 是保守值：
# progress 到實際開始玩之間學生可能發呆 / 看題目，觀察時間天然偏長
SUSPECT_ELAPSED_RATIO = 0.5
# 再扣 2 秒緩衝：吸收網路延遲與 client / server 計時起點的落差，避免誤判
SUSPECT_ELAPSED_SLACK_MS = 2000.0


@dataclass
class StudentRecord:
    """名冊上的一位學生（in-memory，重啟即清空 — 與 legacy 相同）。

    ws 為 None 表示已斷線（名冊保留，等待同名 register 重連繼承）。
    """

    id: str
    ws: WebSocket | None
    name: str = "?"
    emoji: str = "?"
    level: str | None = None
    time: float | None = None
    # 防作弊：一旦標記保留到重新 register；levelId → 收到 progress 的 monotonic 秒
    suspect: bool = False
    level_started_at: dict[str, float] = field(default_factory=dict)

    @property
    def connected(self) -> bool:
        """連線中 = 尚未斷線且 socket 仍在 CONNECTED 狀態。"""
        return self.ws is not None and self.ws.client_state == WebSocketState.CONNECTED


class Roster:
    """學生名冊 + 老師連線集合；所有扇出對 dead socket 的 send 皆 try/except 清理。"""

    def __init__(self, known_levels: frozenset[str] = frozenset()) -> None:
        self._students: list[StudentRecord] = []
        self._teachers: set[WebSocket] = set()
        self._student_counter = 0
        # 已知關卡 id（來自 /api/levels 快取）：complete_level 帶未知 levelId → suspect
        self._known_levels = known_levels

    # ---------- 連線生命週期 ----------

    async def add_student(self, ws: WebSocket) -> StudentRecord:
        """學生連上：配發 id、發 welcome、通知老師。"""
        self._student_counter += 1
        record = StudentRecord(id=f"s{self._student_counter}", ws=ws)
        self._students.append(record)
        await send_safe(ws, WelcomeMsg(id=record.id).model_dump_json())
        await self.broadcast_to_teachers(self._student_list_payload())
        return record

    async def remove_student(self, record: StudentRecord) -> None:
        """學生斷線：已註冊者標記離線保留名冊；未註冊者移除；通知老師。

        若 record 已被同名 register 取代（不在名冊上）則不動作。
        """
        if record not in self._students:
            return
        logger.info("[WS] 學生斷線：%s%s", record.name, record.emoji)
        record.ws = None
        if record.name == "?":
            # 從未 register 的連線沒有可繼承的進度，直接移除
            self._students.remove(record)
        await self.broadcast_to_teachers(self._student_list_payload())

    async def add_teacher(self, ws: WebSocket) -> None:
        """老師連上：先給一份完整名冊。"""
        self._teachers.add(ws)
        await send_safe(ws, self._student_list_payload().model_dump_json())

    def remove_teacher(self, ws: WebSocket) -> None:
        """老師斷線：移出集合。"""
        self._teachers.discard(ws)

    # ---------- 學生協定 ----------

    async def register(self, record: StudentRecord, name: str, emoji: str) -> None:
        """register：同名 = 重連。

        移除舊的同名紀錄（含斷線保留的），舊連線以 close code 4000 踢掉，
        並沿用舊進度（學生重新整理後排行 / 成績不會消失）。
        """
        record.name = name
        record.emoji = emoji
        # 計時起點歸零（新連線重新觀察）；suspect 不歸零 —— 同名重連既然繼承進度，
        # 就一併繼承標記，否則學生重整頁面即可洗白（標記只能由老師人工處置後重啟清除）
        record.level_started_at.clear()
        for other in [s for s in self._students if s is not record and s.name == name]:
            if other.level is not None and record.level is None:
                record.level = other.level
                record.time = other.time
            record.suspect = record.suspect or other.suspect
            self._students.remove(other)
            if other.ws is not None:
                # dead socket 關閉失敗可忽略
                with contextlib.suppress(Exception):
                    await other.ws.close(code=WS_CLOSE_REPLACED, reason="replaced by reconnect")
            logger.info("[WS] %s%s 重連，取代舊連線 %s", record.name, record.emoji, other.id)
        logger.info("[WS] 學生上線：%s%s (%s)", record.name, record.emoji, record.id)
        await self.broadcast_to_teachers(self._student_list_payload())

    async def progress(self, record: StudentRecord, level_id: str) -> None:
        """progress：更新目前關卡 + 記下伺服器觀察的開始時間（防作弊比對用）。"""
        record.level = level_id
        record.level_started_at[level_id] = time.monotonic()
        await self.broadcast_to_teachers(self._student_update_payload(record))

    async def complete_level(self, record: StudentRecord, level_id: str, time_ms: float) -> None:
        """complete_level：記錄關卡 + 用時；先過防作弊判定（標記不阻擋）。"""
        self._flag_if_suspect(record, level_id, time_ms)
        record.level = level_id
        record.time = time_ms
        logger.info(
            "[WS] %s%s 完成 %s 用時 %.1fs", record.name, record.emoji, level_id, time_ms / 1000
        )
        await self.broadcast_to_teachers(self._student_update_payload(record))

    def _flag_if_suspect(self, record: StudentRecord, level_id: str, time_ms: float) -> None:
        """防作弊判定：任一條件成立就把該生標成 suspect（保留到重新 register）。"""
        reasons: list[str] = []
        if level_id not in self._known_levels:
            reasons.append(f"未知關卡 {level_id}")
        started = record.level_started_at.get(level_id)
        if started is None:
            # 正常 client 一定先發 progress 才 complete；直接 complete = 偽造訊息
            reasons.append("沒有先收到 progress")
        else:
            elapsed_ms = (time.monotonic() - started) * 1000
            if time_ms < elapsed_ms * SUSPECT_ELAPSED_RATIO - SUSPECT_ELAPSED_SLACK_MS:
                reasons.append(f"宣稱用時 {time_ms:.0f}ms 但伺服器觀察 {elapsed_ms:.0f}ms")
        if time_ms < SUSPECT_MIN_TIME_MS:
            reasons.append(f"用時 {time_ms:.0f}ms < {SUSPECT_MIN_TIME_MS:.0f}ms")
        if reasons:
            record.suspect = True
            logger.warning(
                "[防作弊] %s%s 完成 %s 標記可疑：%s",
                record.name,
                record.emoji,
                level_id,
                "；".join(reasons),
            )

    # ---------- 賽局防作弊（games/ 呼叫）----------

    async def flag_suspect(self, record: StudentRecord, reason: str) -> None:
        """賽局位置級違規累積達門檻 → 標 suspect（沿用既有機制：標記不阻擋），即時通知老師。"""
        logger.warning("[防作弊] %s%s 標記可疑：%s", record.name, record.emoji, reason)
        if record.suspect:
            return
        record.suspect = True
        await self.broadcast_to_teachers(self._student_update_payload(record))

    # ---------- 扇出 ----------

    async def broadcast_to_teachers(self, msg: StudentListMsg | StudentUpdateMsg) -> None:
        """對所有老師扇出；send 失敗（dead socket）就地移除。"""
        await self.send_raw_to_teachers(msg.model_dump_json())

    async def send_raw_to_teachers(self, data: str) -> None:
        """對所有老師扇出已序列化的 JSON 字串（賽局訊息共用）；dead socket 就地移除。"""
        for teacher in list(self._teachers):
            if not await send_safe(teacher, data):
                self._teachers.discard(teacher)

    async def broadcast_to_students(self, payload: TeacherBroadcastPayload) -> None:
        """老師 broadcast（已通過白名單驗證的 payload）→ 全體在線學生。"""
        data = payload.model_dump_json()
        for record in list(self._students):
            if record.ws is not None:
                await send_safe(record.ws, data)

    # ---------- payload 組裝 ----------

    def _student_list_payload(self) -> StudentListMsg:
        return StudentListMsg(
            students=[
                StudentInfo(
                    id=s.id,
                    name=s.name,
                    emoji=s.emoji,
                    connected=s.connected,
                    level=s.level,
                    time=s.time,
                    suspect=s.suspect,
                )
                for s in self._students
            ]
        )

    def _student_update_payload(self, s: StudentRecord) -> StudentUpdateMsg:
        return StudentUpdateMsg(
            student=StudentBrief(
                id=s.id, name=s.name, emoji=s.emoji, level=s.level, time=s.time, suspect=s.suspect
            )
        )


async def send_safe(ws: WebSocket, data: str) -> bool:
    """安全送出：dead socket 的 send 失敗回 False，由呼叫端清理。

    公開給 games/（賽局扇出）共用，行為與名冊扇出一致。
    """
    if ws.client_state != WebSocketState.CONNECTED:
        return False
    try:
        await ws.send_text(data)
    except Exception:  # noqa: BLE001 — 斷線競態下 send 可能拋各種例外，一律視為失敗
        return False
    return True
