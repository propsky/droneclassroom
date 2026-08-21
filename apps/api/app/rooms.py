"""rooms.py — 多房間（Room）：一位老師開的一個場次 = 獨立名冊 + 獨立賽局 + 設定。

- Room：code + settings + roster（Roster）+ arena / soccer（各自持有該房 roster）
- RoomManager：dict[code → Room]、產碼、建 / 關 / 查、預設房、老師選房、房間列表推送、
  統一 tick（遍歷所有房的賽局 + 閒置自動關房）

預設房（config.default_room_code，預設 MAIN）啟動即存在、不可關閉：
不帶房間碼的學生走預設房 = 既有 URL / 流程原封不動（向後相容）。

老師一條 WS 管多間：RoomManager 記每位老師「目前選定的房」，並把老師 socket 掛進該房
roster 的老師集合（名冊 / 賽局扇出只到選定該房的老師）；房間列表（room_list）則對
所有老師推送。所有狀態封裝在 RoomManager 實例（掛 app.state.rooms），無模組級全域可變狀態。

班級持久化（有 DATABASE_URL 且老師以帳號登入時）：老師開的房 = teams 表一列（Team），
code 固定、重啟不消失、老師只看到自己的班級。Room 是 Team 的「記憶體載入狀態」：
- room_create → 先建 Team 列再載入成 Room（Room.team_id 指回去）
- room_close / 閒置關房 → 只卸載記憶體，Team 保留；room_open_team 再載回來（code 不變）
- room_update → 同步寫 teams；room_archive_team → 封存（列表消失、紀錄保留）
- 伺服器重啟不預載班級：老師重新登入在 room_list.teams 看到、點開才載入（省記憶體）
無 DB / 訪客老師 → 純記憶體房（既有行為零改變）。預設房永遠是記憶體房、所有老師共用。
"""

import asyncio
import contextlib
import logging
import secrets
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Literal

from fastapi import WebSocket
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from .accounts import hash_password, verify_password
from .config import Settings
from .db.audit import record_event
from .db.models import Teacher, Team
from .games import ArenaGame, SoccerField, SoccerGame
from .protocol import (
    WS_CLOSE_KICKED,
    RejectReason,
    RoomClosedMsg,
    RoomInfo,
    RoomListMsg,
    RoomSettingsIn,
    TeamInfo,
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
    """房間設定（伺服器端型別；線上對應 RoomSettingsIn，缺省值由 RoomManager 依 config 給）。

    密碼兩種存法擇一：記憶體房存明文 `password`（既有路徑）；班級房存 argon2 `password_hash`
    （與 teams.join_password_hash 同值、明文不進記憶體）。
    """

    max_students: int
    name: str = ""  # 空 = 列表顯示房間碼
    password: str = ""  # 空 = 不需密碼（記憶體房）
    password_hash: str | None = None  # 班級房的密碼雜湊；None = 不需密碼
    locked: bool = False

    @property
    def has_password(self) -> bool:
        return bool(self.password) or self.password_hash is not None

    def check_password(self, password: str | None) -> bool:
        """學生帶來的密碼對不對；沒設密碼一律通過。"""
        if self.password_hash is not None:
            return verify_password(self.password_hash, password or "")
        return not self.password or password == self.password

    def apply(self, patch: RoomSettingsIn, *, hashed: bool = False) -> None:
        """套用老師送來的部分更新（只改帶到的欄位）。hashed=True（班級房）：密碼存雜湊。"""
        if patch.name is not None:
            self.name = patch.name.strip()
        if patch.password is not None:
            if hashed:
                self.password_hash = hash_password(patch.password) if patch.password else None
            else:
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
    # 持久化班級（teams 表）：id 與擁有的老師；預設房與記憶體房皆為 None
    team_id: int | None = None
    owner_teacher_id: int | None = None
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
        self,
        record: StudentRecord,
        name: str,
        password: str | None,
        *,
        skip_password: bool = False,
    ) -> RejectReason | None:
        """學生進房門檢；回 None = 放行。順序：鎖房 → 滿員 → 密碼。

        滿員只算「其他在線學生」：同名重連（舊連線會被取代）與已在房內的本人不佔額。
        skip_password：帳號模式（studentToken 已驗明身分、本來就是這班的學生）免密碼。
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
        if not skip_password and not self.settings.check_password(password):
            return "bad_password"
        return None

    def info(self) -> RoomInfo:
        return RoomInfo(
            code=self.code,
            name=self.settings.name or self.code,
            hasPassword=self.settings.has_password,
            maxStudents=self.settings.max_students,
            locked=self.settings.locked,
            studentCount=self.student_count,
            arenaStatus=self.arena.status,
            soccerStatus=self.soccer.status,
            createdAt=self.created_at,
            teamId=self.team_id,
        )


def _epoch_ms(dt: datetime) -> float:
    return dt.timestamp() * 1000


class RoomManager:
    """所有房間 + 老師選房狀態 + 房間列表推送 + 統一 tick（+ 班級持久化，有 DB 時）。"""

    def __init__(
        self,
        cfg: Settings,
        known_levels: frozenset[str] = frozenset(),
        db: async_sessionmaker[AsyncSession] | None = None,
    ) -> None:
        self._cfg = cfg
        self._known_levels = known_levels
        self._soccer_field = SoccerField.from_settings(cfg)
        # 資料庫 sessionmaker；None = 無資料庫模式（房間全在記憶體，班級功能關閉）
        self._db = db
        self._rooms: dict[str, Room] = {}
        # 老師 socket → 目前選定的房
        self._teachers: dict[WebSocket, Room] = {}
        # 老師 socket → 帳號 id（無 DB / 舊 PIN 登入為 None）：班級清單與權限用
        self._teacher_ids: dict[WebSocket, int | None] = {}
        # 老師帳號 id → 其班級列快取（連上時載入、自己的班級變動時重載、全部斷線時丟掉）：
        # room_list 推送很頻繁（人數 / 賽局狀態變動都推），不能每推一次查一次 DB；
        # 班級只會被擁有者自己改，所以快取只需在本人操作後刷新
        self._teams_cache: dict[int, list[Team]] = {}
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

    def get_by_team(self, team_id: int) -> Room | None:
        """找某班級目前載入的房（沒開著回 None）。"""
        return next((r for r in self._rooms.values() if r.team_id == team_id), None)

    def _default_settings(self) -> RoomSettings:
        return RoomSettings(
            max_students=self._cfg.room_default_max_students or self._cfg.max_students
        )

    def _new_room(
        self,
        code: str,
        settings: RoomSettings,
        *,
        team_id: int | None = None,
        owner_teacher_id: int | None = None,
        created_at: float | None = None,
    ) -> Room:
        roster = Roster(known_levels=self._known_levels, on_change=self.notify)
        room = Room(
            code=code,
            settings=settings,
            roster=roster,
            arena=ArenaGame(roster),
            soccer=SoccerGame(roster, field=self._soccer_field),
            created_at=self.now_ms() if created_at is None else created_at,
            team_id=team_id,
            owner_teacher_id=owner_teacher_id,
        )
        self._rooms[code] = room
        return room

    def _random_code(self) -> str:
        return "".join(
            secrets.choice(self._cfg.room_code_alphabet) for _ in range(self._cfg.room_code_length)
        )

    def generate_code(self) -> str:
        """產房間碼：config 的長度 / 字元集（預設 4 碼、去 0/O/1/I），碰撞重試。"""
        for _ in range(ROOM_CODE_MAX_TRIES):
            code = self._random_code()
            if code not in self._rooms:
                return code
        raise RoomLimitError("房間碼空間耗盡")  # 上限 20 房實務上不會發生

    def _check_room_limit(self) -> None:
        if len(self._rooms) >= self._cfg.room_max_rooms:
            raise RoomLimitError(f"房間數已達上限 {self._cfg.room_max_rooms}")

    async def create(
        self, patch: RoomSettingsIn | None = None, teacher_id: int | None = None
    ) -> Room:
        """開新房；超過 room_max_rooms 拋 RoomLimitError。

        有 DB 且老師有帳號 → 先建 Team 列（固定 team_code）再載入成 Room；否則純記憶體房。
        """
        self._check_room_limit()
        if self._db is not None and teacher_id is not None:
            try:
                return await self._create_team(patch, teacher_id)
            except RoomLimitError:
                raise
            except Exception:  # noqa: BLE001 — DB 掛了也要能上課：退回記憶體房（不持久化）
                logger.exception("[Room] 建班級失敗，改開記憶體房（本次不持久化）")
        settings = self._default_settings()
        if patch is not None:
            settings.apply(patch)
        room = self._new_room(self.generate_code(), settings)
        logger.info("[Room] 開房 %s（%s）", room.code, room.settings.name or "-")
        return room  # 呼叫端 select 完再 notify()，讓開房老師先收齊新房快照

    async def update(
        self, room: Room, patch: RoomSettingsIn, teacher_id: int | None = None
    ) -> None:
        """改設定（改名 / 密碼 / 上限 / 鎖房）；已在房內的學生不受影響。班級房同步寫 teams。"""
        before = _settings_snapshot(room.settings)
        room.settings.apply(patch, hashed=room.team_id is not None)
        logger.info(
            "[Room] %s 設定更新：%s",
            room.code,
            patch.model_dump(exclude_none=True, exclude={"password"}),
        )
        if room.team_id is not None:
            await self._sync_team(room, before, teacher_id)
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

        預設房拒絕關閉（回 False）。班級房只卸載記憶體，Team 列保留（可再 room_open_team）。
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

    def can_manage(self, room: Room, teacher_id: int | None) -> bool:
        """老師能否管理這間房（改設定 / 踢人 / 關房）：班級房限擁有者；記憶體房與預設房共用。"""
        return room.team_id is None or room.owner_teacher_id == teacher_id

    # ---------- 班級（teams 表）----------

    async def _create_team(self, patch: RoomSettingsIn | None, teacher_id: int) -> Room:
        """建 Team 列（team_code 檢查 DB 唯一、密碼 argon2）→ 載入成 Room；audit team.created。"""
        assert self._db is not None
        settings = self._default_settings()
        if patch is not None:
            settings.apply(patch, hashed=True)
        async with self._db() as session:
            teacher = await session.get(Teacher, teacher_id)
            if teacher is None:
                raise RoomLimitError(f"老師 {teacher_id} 不存在")
            team = await self._insert_team(session, teacher.org_id, teacher.id, settings)
            await record_event(
                session,
                event_type="team.created",
                actor_type="teacher",
                actor_id=teacher.id,
                org_id=teacher.org_id,
                team_id=team.id,
                payload={"team_code": team.team_code, **_settings_snapshot(settings)},
            )
            await session.commit()
        room = self._load_team(team, settings)
        await self.refresh_teams(teacher_id)
        logger.info("[Room] 開房 %s（%s）← 新班級 #%d", room.code, settings.name or "-", team.id)
        return room

    async def _insert_team(
        self, session: AsyncSession, org_id: int, teacher_id: int, settings: RoomSettings
    ) -> Team:
        """產一個記憶體與 DB 都沒用過的 team_code 並寫入 teams；撞到唯一鍵就換碼重試。"""
        for _ in range(ROOM_CODE_MAX_TRIES):
            code = self._random_code()
            if code in self._rooms:
                continue
            exists = (
                await session.execute(select(Team.id).where(Team.team_code == code))
            ).scalar_one_or_none()
            if exists is not None:
                continue
            team = Team(
                org_id=org_id,
                owner_teacher_id=teacher_id,
                name=settings.name or code,
                team_code=code,
                join_password_hash=settings.password_hash,
                max_students=settings.max_students,
                locked=settings.locked,
            )
            session.add(team)
            try:
                await session.flush()
            except IntegrityError:  # 同時有人搶到同一碼（極罕見）→ 換碼再試
                await session.rollback()
                continue
            return team
        raise RoomLimitError("班級碼空間耗盡")

    def _load_team(self, team: Team, settings: RoomSettings | None = None) -> Room:
        """Team 列 → 記憶體 Room（code = team_code、密碼帶雜湊）。"""
        if settings is None:
            settings = RoomSettings(
                max_students=team.max_students,
                name=team.name,
                password_hash=team.join_password_hash,
                locked=team.locked,
            )
        return self._new_room(
            team.team_code,
            settings,
            team_id=team.id,
            owner_teacher_id=team.owner_teacher_id,
            created_at=_epoch_ms(team.created_at),
        )

    async def _own_team(self, session: AsyncSession, teacher_id: int, team_id: int) -> Team | None:
        """該老師擁有且未封存的 Team；不是就回 None（呼叫端忽略 + log）。"""
        team = await session.get(Team, team_id)
        if team is None or team.owner_teacher_id != teacher_id or team.archived_at is not None:
            return None
        return team

    async def open_team(self, teacher_id: int | None, team_id: int) -> Room | None:
        """把班級載入成 Room（已開著就直接回那間）；不屬於該老師 / 已封存 / 無 DB 回 None。

        超過 room_max_rooms 拋 RoomLimitError。
        """
        if self._db is None or teacher_id is None:
            return None
        room = self.get_by_team(team_id)
        if room is not None:
            return room if room.owner_teacher_id == teacher_id else None
        try:
            async with self._db() as session:
                team = await self._own_team(session, teacher_id, team_id)
        except Exception:  # noqa: BLE001 — DB 出錯：開不了班級，不讓老師連線掛掉
            logger.exception("[Room] 讀取班級 #%d 失敗", team_id)
            return None
        if team is None:
            logger.info("[Room] 老師 %s 開班級 #%d 被拒（非擁有者或已封存）", teacher_id, team_id)
            return None
        self._check_room_limit()
        if team.team_code in self._rooms:  # 碼被記憶體房占用（理論上不會）
            logger.warning("[Room] 班級 #%d 的碼 %s 已被占用，無法開房", team.id, team.team_code)
            return None
        room = self._load_team(team)
        logger.info("[Room] 開房 %s（%s）← 班級 #%d", room.code, room.settings.name, team.id)
        return room

    async def archive_team(self, teacher_id: int | None, team_id: int) -> bool:
        """封存班級：開著的先關房，teams.archived_at 設為現在；audit team.archived。"""
        if self._db is None or teacher_id is None:
            return False
        try:
            async with self._db() as session:
                team = await self._own_team(session, teacher_id, team_id)
                if team is None:
                    logger.info(
                        "[Room] 老師 %s 封存班級 #%d 被拒（非擁有者或已封存）", teacher_id, team_id
                    )
                    return False
                room = self.get_by_team(team_id)
                if room is not None:
                    await self.close(room)
                team.archived_at = datetime.now(UTC)
                await record_event(
                    session,
                    event_type="team.archived",
                    actor_type="teacher",
                    actor_id=teacher_id,
                    org_id=team.org_id,
                    team_id=team.id,
                    payload={"team_code": team.team_code, "name": team.name},
                )
                await session.commit()
        except Exception:  # noqa: BLE001 — DB 出錯：封存沒成功，只 log
            logger.exception("[Room] 封存班級 #%d 失敗", team_id)
            return False
        await self.refresh_teams(teacher_id)
        logger.info("[Room] 班級 #%d（%s）已封存", team_id, team.team_code)
        return True

    async def _sync_team(
        self, room: Room, before: dict[str, object], teacher_id: int | None
    ) -> None:
        """room_update 後把設定寫回 teams；audit team.updated（before/after，不含密碼）
        與 team.locked / team.unlocked。DB 出錯只 log（記憶體房照常運作，不讓上課中斷）。"""
        assert self._db is not None and room.team_id is not None
        after = _settings_snapshot(room.settings)
        try:
            async with self._db() as session:
                team = await session.get(Team, room.team_id)
                if team is None:
                    return
                team.name = room.settings.name or team.team_code
                team.join_password_hash = room.settings.password_hash
                team.max_students = room.settings.max_students
                team.locked = room.settings.locked
                events: list[tuple[str, dict[str, object]]] = [
                    ("team.updated", {"before": before, "after": after})
                ]
                if before["locked"] != after["locked"]:
                    kind = "team.locked" if after["locked"] else "team.unlocked"
                    events.append((kind, {"team_code": team.team_code}))
                for event_type, payload in events:
                    await record_event(
                        session,
                        event_type=event_type,
                        actor_type="teacher",
                        actor_id=teacher_id,
                        org_id=team.org_id,
                        team_id=team.id,
                        payload=payload,
                    )
                await session.commit()
            if room.owner_teacher_id is not None:
                await self.refresh_teams(room.owner_teacher_id)
        except Exception:  # noqa: BLE001 — 見 docstring
            logger.exception("[Room] 班級 #%d 設定寫入資料庫失敗", room.team_id)

    async def refresh_teams(self, teacher_id: int) -> None:
        """從 DB 重載該老師擁有、未封存的班級清單進快取；查詢失敗只 log（清單暫為空）。"""
        if self._db is None:
            return
        try:
            async with self._db() as session:
                teams = (
                    (
                        await session.execute(
                            select(Team)
                            .where(Team.owner_teacher_id == teacher_id, Team.archived_at.is_(None))
                            .order_by(Team.created_at, Team.id)
                        )
                    )
                    .scalars()
                    .all()
                )
        except Exception:  # noqa: BLE001 — 班級清單查不到不該讓老師連不上 / 房間列表整份失敗
            logger.exception("[Room] 讀取老師 %s 的班級清單失敗", teacher_id)
            teams = []
        self._teams_cache[teacher_id] = list(teams)

    def _team_infos(self, teacher_id: int | None) -> list[TeamInfo]:
        """快取 → TeamInfo（open = 目前有對應 Room）；無 DB / 訪客 → []。"""
        if teacher_id is None:
            return []
        return [
            TeamInfo(
                id=t.id,
                code=t.team_code,
                name=t.name,
                hasPassword=t.join_password_hash is not None,
                maxStudents=t.max_students,
                locked=t.locked,
                createdAt=_epoch_ms(t.created_at),
                open=self.get_by_team(t.id) is not None,
            )
            for t in self._teams_cache.get(teacher_id, [])
        ]

    # ---------- 學生 ----------

    async def new_student(self, ws: WebSocket) -> StudentRecord:
        """學生連上：配發全域遞增 id、發 welcome（進哪房由之後的 register 決定）。"""
        self._student_counter += 1
        record = StudentRecord(id=f"s{self._student_counter}", ws=ws)
        await send_safe(ws, WelcomeMsg(id=record.id).model_dump_json())
        return record

    # ---------- 老師 ----------

    async def add_teacher(self, ws: WebSocket, teacher_id: int | None = None) -> None:
        """老師連上：先給房間列表，再掛進預設房（名冊 + 鎖定狀態由 roster.add_teacher 補送）。

        teacher_id = 帳號 id（有 DB 時由 ticket 解析；無 DB 為 None）：班級清單與權限用。
        """
        self._teacher_ids[ws] = teacher_id
        if teacher_id is not None and teacher_id not in self._teams_cache:
            await self.refresh_teams(teacher_id)
        await self.send_room_list(ws, selected=self.default)
        self._teachers[ws] = self.default
        await self.default.roster.add_teacher(ws)

    def remove_teacher(self, ws: WebSocket) -> None:
        teacher_id = self._teacher_ids.pop(ws, None)
        if teacher_id is not None and teacher_id not in self._teacher_ids.values():
            self._teams_cache.pop(teacher_id, None)  # 該老師最後一條連線走了 → 丟快取
        room = self._teachers.pop(ws, None)
        if room is not None:
            room.roster.remove_teacher(ws)

    def teacher_id(self, ws: WebSocket) -> int | None:
        """老師 socket 對應的帳號 id（無 DB / 未登記為 None）。"""
        return self._teacher_ids.get(ws)

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

    def _room_list(self, ws: WebSocket, selected: Room | None) -> RoomListMsg:
        """房間列表 + 該老師的班級清單（全同步、不碰 DB：推送順序才與狀態一致）。"""
        return RoomListMsg(
            rooms=[r.info() for r in self._rooms.values()],
            selected=selected.code if selected is not None else None,
            teams=self._team_infos(self._teacher_ids.get(ws)),
        )

    async def send_room_list(self, ws: WebSocket, selected: Room | None = None) -> None:
        """對單一老師送一份房間列表（連上 / room_list_req / 選房 / 班級變動）。"""
        if selected is None:
            selected = self._teachers.get(ws)
        await send_safe(ws, self._room_list(ws, selected).model_dump_json())

    def _signature(self) -> tuple[tuple[object, ...], ...]:
        """房間列表的可見狀態指紋：沒變就不推。"""
        return tuple(
            (
                r.code,
                r.settings.name,
                r.settings.has_password,
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
            if not await send_safe(ws, self._room_list(ws, selected).model_dump_json()):
                self.remove_teacher(ws)

    # ---------- tick ----------

    async def tick(self) -> None:
        """推進所有房的賽局；非預設房 0 人且無賽局閒置逾時 → 自動關房（班級房只卸載記憶體，
        Team 列不動）；狀態變了推列表。"""
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


def _settings_snapshot(settings: RoomSettings) -> dict[str, object]:
    """設定的稽核快照（不含密碼明文 / 雜湊，只記有沒有設）。"""
    return {
        "name": settings.name,
        "has_password": settings.has_password,
        "max_students": settings.max_students,
        "locked": settings.locked,
    }


async def _close_kicked(record: StudentRecord, reason: Literal["closed", "kicked"]) -> None:
    """通知學生（room_closed）並以 WS_CLOSE_KICKED 關閉；dead socket 靜默略過。"""
    ws = record.ws
    if ws is None:
        return
    await send_safe(ws, RoomClosedMsg(reason=reason).model_dump_json())
    with contextlib.suppress(Exception):
        await ws.close(code=WS_CLOSE_KICKED, reason=reason)
