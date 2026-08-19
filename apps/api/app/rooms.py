"""rooms.py — 多房間（Room）：一位老師開的一個場次 = 獨立名冊 + 獨立賽局 + 設定。

- Room：code + settings + roster（Roster）+ arena / soccer（各自持有該房 roster）
- RoomManager：dict[code → Room]、產碼、建 / 關 / 查、預設房、老師選房、房間列表推送、
  統一 tick（遍歷所有房的賽局 + 閒置自動關房）

預設房（config.default_room_code，預設 MAIN）啟動即存在、不可關閉：
不帶房間碼的學生走預設房 = 既有 URL / 流程原封不動（向後相容）。

老師一條 WS 管多間：RoomManager 記每位老師「目前選定的房」，並把老師 socket 掛進該房
roster 的老師集合（名冊 / 賽局扇出只到選定該房的老師）；房間列表（room_list）則對
所有老師推送。所有狀態封裝在 RoomManager 實例（掛 app.state.rooms），無模組級全域可變狀態。

未來帳號系統：Room.owner_id 已預留，加持久化即可，協定不變。
"""

import asyncio
import contextlib
import logging
import secrets
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Literal

from fastapi import WebSocket

from .config import Settings
from .games import ArenaGame, SoccerField, SoccerGame
from .protocol import (
    WS_CLOSE_KICKED,
    RejectReason,
    RoomClosedMsg,
    RoomInfo,
    RoomListMsg,
    RoomSettingsIn,
    WelcomeMsg,
)
from .roster import Roster, StudentRecord, send_safe

logger = logging.getLogger("creafly.api.rooms")

# 產碼碰撞重試上限：4 碼 32 字元集有 100 萬組合、房間上限 20，實務上一次就中
ROOM_CODE_MAX_TRIES = 50


class RoomLimitError(Exception):
    """房間數已達 room_max_rooms 上限。"""


@dataclass
class RoomSettings:
    """房間設定（伺服器端型別；線上對應 RoomSettingsIn，缺省值由 RoomManager 依 config 給）。"""

    max_students: int
    name: str = ""  # 空 = 列表顯示房間碼
    password: str = ""  # 空 = 不需密碼
    locked: bool = False

    def apply(self, patch: RoomSettingsIn) -> None:
        """套用老師送來的部分更新（只改帶到的欄位）。"""
        if patch.name is not None:
            self.name = patch.name.strip()
        if patch.password is not None:
            self.password = patch.password
        if patch.maxStudents is not None:
            self.max_students = patch.maxStudents
        if patch.locked is not None:
            self.locked = patch.locked


@dataclass
class Room:
    """一間房：名冊 + 兩種賽局 + 設定。"""

    code: str
    settings: RoomSettings
    roster: Roster
    arena: ArenaGame
    soccer: SoccerGame
    created_at: float  # epoch 毫秒
    owner_id: str | None = None  # 預留給未來帳號系統
    # 閒置起點（epoch 毫秒）：0 人且無賽局進行的那一刻；None = 目前不閒置
    idle_since: float | None = field(default=None, repr=False)

    @property
    def student_count(self) -> int:
        """在線人數（斷線保留的名冊列不算）。"""
        return sum(1 for s in self.roster.students if s.connected)

    @property
    def game_running(self) -> bool:
        """任一賽局倒數中或進行中。"""
        return self.arena.status in ("countdown", "running") or self.soccer.status in (
            "countdown",
            "running",
        )

    def reject_reason(
        self, record: StudentRecord, name: str, password: str | None
    ) -> RejectReason | None:
        """學生進房門檢；回 None = 放行。順序：鎖房 → 滿員 → 密碼。

        滿員只算「其他在線學生」：同名重連（舊連線會被取代）與已在房內的本人不佔額。
        """
        if self.settings.locked:
            return "locked"
        others = sum(
            1
            for s in self.roster.students
            if s is not record and s.connected and s.name != name
        )
        if others >= self.settings.max_students:
            return "full"
        if self.settings.password and password != self.settings.password:
            return "bad_password"
        return None

    def info(self) -> RoomInfo:
        return RoomInfo(
            code=self.code,
            name=self.settings.name or self.code,
            hasPassword=bool(self.settings.password),
            maxStudents=self.settings.max_students,
            locked=self.settings.locked,
            studentCount=self.student_count,
            arenaStatus=self.arena.status,
            soccerStatus=self.soccer.status,
            createdAt=self.created_at,
        )


class RoomManager:
    """所有房間 + 老師選房狀態 + 房間列表推送 + 統一 tick。"""

    def __init__(self, cfg: Settings, known_levels: frozenset[str] = frozenset()) -> None:
        self._cfg = cfg
        self._known_levels = known_levels
        self._soccer_field = SoccerField.from_settings(cfg)
        self._rooms: dict[str, Room] = {}
        # 老師 socket → 目前選定的房
        self._teachers: dict[WebSocket, Room] = {}
        # 學生 id 全域遞增（帶 ?room= 的學生要到 register 才知道進哪房，id 得先發）
        self._student_counter = 0
        # 時鐘可注入（測試閒置關房）；epoch 毫秒（RoomInfo.createdAt 走線上給 Date.now() 比對）
        self.now_ms: Callable[[], float] = lambda: time.time() * 1000
        # room_list 推送節流：同一 event-loop tick 內多次變動合併成一次；
        # _last_signature 用來略過「沒有可見變動」的推送
        self._push_scheduled = False
        self._push_task: asyncio.Task[None] | None = None
        self._last_signature: tuple[tuple[object, ...], ...] | None = None
        # 預設房：啟動即存在、不可關閉
        self.default = self._new_room(
            cfg.default_room_code.strip().upper(), self._default_settings()
        )

    # ---------- 建 / 關 / 查 ----------

    @property
    def rooms(self) -> tuple[Room, ...]:
        return tuple(self._rooms.values())

    def get(self, code: str | None) -> Room | None:
        """依房間碼找房（大小寫不敏感）；None / 空字串 = 預設房。"""
        if not code:
            return self.default
        return self._rooms.get(code.strip().upper())

    def _default_settings(self) -> RoomSettings:
        return RoomSettings(
            max_students=self._cfg.room_default_max_students or self._cfg.max_students
        )

    def _new_room(self, code: str, settings: RoomSettings) -> Room:
        roster = Roster(known_levels=self._known_levels, on_change=self.notify)
        room = Room(
            code=code,
            settings=settings,
            roster=roster,
            arena=ArenaGame(roster),
            soccer=SoccerGame(roster, field=self._soccer_field),
            created_at=self.now_ms(),
        )
        self._rooms[code] = room
        return room

    def generate_code(self) -> str:
        """產房間碼：config 的長度 / 字元集（預設 4 碼、去 0/O/1/I），碰撞重試。"""
        for _ in range(ROOM_CODE_MAX_TRIES):
            code = "".join(
                secrets.choice(self._cfg.room_code_alphabet)
                for _ in range(self._cfg.room_code_length)
            )
            if code not in self._rooms:
                return code
        raise RoomLimitError("房間碼空間耗盡")  # 上限 20 房實務上不會發生

    def create(self, patch: RoomSettingsIn | None = None) -> Room:
        """開新房；超過 room_max_rooms 拋 RoomLimitError。"""
        if len(self._rooms) >= self._cfg.room_max_rooms:
            raise RoomLimitError(f"房間數已達上限 {self._cfg.room_max_rooms}")
        settings = self._default_settings()
        if patch is not None:
            settings.apply(patch)
        room = self._new_room(self.generate_code(), settings)
        logger.info("[Room] 開房 %s（%s）", room.code, room.settings.name or "-")
        return room  # 呼叫端 select 完再 notify()，讓開房老師先收齊新房快照

    def update(self, room: Room, patch: RoomSettingsIn) -> None:
        """改設定（改名 / 密碼 / 上限 / 鎖房）；已在房內的學生不受影響。"""
        room.settings.apply(patch)
        logger.info("[Room] %s 設定更新：%s", room.code, patch.model_dump(exclude_none=True))
        self.notify()

    async def kick(self, room: Room, record: StudentRecord) -> None:
        """踢人：移出賽局與名冊（整筆，不留離線列），通知後以 WS_CLOSE_KICKED 關閉。可重進。"""
        await room.arena.drop(record)
        await room.soccer.drop(record)
        await room.roster.detach(record)
        await _close_kicked(record, "kicked")
        logger.info("[Room] %s 踢出 %s%s (%s)", room.code, record.name, record.emoji, record.id)

    async def close(self, room: Room) -> bool:
        """關房：全員 WS_CLOSE_KICKED、賽局停止、看著這房的老師切回預設房、房移除。

        預設房拒絕關閉（回 False）。
        """
        if room is self.default or room.code not in self._rooms:
            return False
        for record in room.roster.students:
            await _close_kicked(record, "closed")
        await room.arena.stop()
        await room.soccer.stop()
        del self._rooms[room.code]
        for ws, selected in list(self._teachers.items()):
            if selected is room:
                await self.select(ws, self.default)
        logger.info("[Room] 關房 %s", room.code)
        self.notify()
        return True

    # ---------- 學生 ----------

    async def new_student(self, ws: WebSocket) -> StudentRecord:
        """學生連上：配發全域遞增 id、發 welcome（進哪房由之後的 register 決定）。"""
        self._student_counter += 1
        record = StudentRecord(id=f"s{self._student_counter}", ws=ws)
        await send_safe(ws, WelcomeMsg(id=record.id).model_dump_json())
        return record

    # ---------- 老師 ----------

    async def add_teacher(self, ws: WebSocket) -> None:
        """老師連上：先給房間列表，再掛進預設房（名冊 + 鎖定狀態由 roster.add_teacher 補送）。"""
        await self.send_room_list(ws, selected=self.default)
        self._teachers[ws] = self.default
        await self.default.roster.add_teacher(ws)

    def remove_teacher(self, ws: WebSocket) -> None:
        room = self._teachers.pop(ws, None)
        if room is not None:
            room.roster.remove_teacher(ws)

    def selected(self, ws: WebSocket) -> Room:
        """老師目前的作用房（未登記者視為預設房）。"""
        return self._teachers.get(ws, self.default)

    async def select(self, ws: WebSocket, room: Room) -> None:
        """切換作用房：老師 socket 從舊房移到新房，補送新房名冊 + 賽局快照 + 房間列表。"""
        old = self._teachers.get(ws)
        if old is not None:
            old.roster.remove_teacher(ws)
        self._teachers[ws] = room
        await room.roster.add_teacher(ws)
        await room.arena.send_snapshot_to(ws)
        await room.soccer.send_snapshot_to(ws)
        await self.send_room_list(ws, selected=room)

    # ---------- 房間列表推送 ----------

    def _room_list(self, selected: Room | None) -> RoomListMsg:
        return RoomListMsg(
            rooms=[r.info() for r in self._rooms.values()],
            selected=selected.code if selected is not None else None,
        )

    async def send_room_list(self, ws: WebSocket, selected: Room | None = None) -> None:
        """對單一老師送一份房間列表（連上 / room_list_req / 選房）。"""
        if selected is None:
            selected = self._teachers.get(ws)
        await send_safe(ws, self._room_list(selected).model_dump_json())

    def _signature(self) -> tuple[tuple[object, ...], ...]:
        """房間列表的可見狀態指紋：沒變就不推。"""
        return tuple(
            (
                r.code,
                r.settings.name,
                bool(r.settings.password),
                r.settings.max_students,
                r.settings.locked,
                r.student_count,
                r.arena.status,
                r.soccer.status,
            )
            for r in self._rooms.values()
        )

    def notify(self) -> None:
        """房間狀態可能變了 → 排程對所有老師推 room_list（同一 loop tick 內合併成一次）。

        同步方法：可從 roster 回呼 / 任何 handler 呼叫；沒老師或沒變動就不推。
        """
        if self._push_scheduled or not self._teachers:
            return
        if self._signature() == self._last_signature:
            return
        self._push_scheduled = True
        asyncio.get_running_loop().call_soon(self._flush_room_list)

    def _flush_room_list(self) -> None:
        self._push_scheduled = False
        self._push_task = asyncio.ensure_future(self._push_room_list())

    async def _push_room_list(self) -> None:
        self._last_signature = self._signature()
        for ws, selected in list(self._teachers.items()):
            if not await send_safe(ws, self._room_list(selected).model_dump_json()):
                self.remove_teacher(ws)

    # ---------- tick ----------

    async def tick(self) -> None:
        """推進所有房的賽局；非預設房 0 人且無賽局閒置逾時 → 自動關房；狀態變了推列表。"""
        now = self.now_ms()
        idle_limit_ms = self._cfg.room_idle_close_sec * 1000
        for room in list(self._rooms.values()):
            await room.arena.tick()
            await room.soccer.tick()
            if room is self.default:
                continue
            if room.student_count > 0 or room.game_running:
                room.idle_since = None
            elif room.idle_since is None:
                room.idle_since = now
            elif now - room.idle_since >= idle_limit_ms:
                logger.info("[Room] %s 閒置逾 %.0f 秒，自動關房", room.code, idle_limit_ms / 1000)
                await self.close(room)
        self.notify()


async def _close_kicked(record: StudentRecord, reason: Literal["closed", "kicked"]) -> None:
    """通知學生（room_closed）並以 WS_CLOSE_KICKED 關閉；dead socket 靜默略過。"""
    ws = record.ws
    if ws is None:
        return
    await send_safe(ws, RoomClosedMsg(reason=reason).model_dump_json())
    with contextlib.suppress(Exception):
        await ws.close(code=WS_CLOSE_KICKED, reason=reason)
