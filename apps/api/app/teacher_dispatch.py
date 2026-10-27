"""同房教師派送。等待名單只活在這間房的記憶體，不寫資料庫、不改 schema。

足球與大亂鬥各一條名單。學生被派送後留在目前關卡；老師按開始才進場。
比賽中不可追加。老師離開時清掉還沒進場的名單，避免學生卡在等待看板。
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import Any, Literal

from .class_level_send import ClassLevelSend
from .games.base import game_player_key
from .roster import StudentRecord, send_safe

logger = logging.getLogger("creafly.api.dispatch")

DispatchActivity = Literal["soccer", "arena"]

# 與 packages/shared/src/teacherDispatch.ts 的 TeacherDispatch 同一組數字。
# 足球：F9A-B 每隊 3 人，3v3 共 6。
# 大亂鬥：程式沒有場地上限；房間 max_students 是進房門檻。派送用 8。
SOCCER_CAP = 6
ARENA_CAP = 8

_SOCCER_LIVE = frozenset({"countdown", "running", "break", "golden", "pk"})
_ARENA_LIVE = frozenset({"countdown", "running"})
_ACTIVITIES: tuple[DispatchActivity, DispatchActivity] = ("soccer", "arena")
_ATTR = "_teacher_dispatch"


@dataclass
class DispatchSeat:
    """名單上的一位。key 跨重連不變（帳號 id 或名字），student_id 會在重連後改寫。"""

    key: str
    student_id: str
    name: str
    emoji: str
    return_level: str | None


@dataclass
class ActivityQueue:
    waiting: list[DispatchSeat] = field(default_factory=list)
    # 已送進這一場、賽後要送回原關卡的人。key → 派送當下的關卡。
    playing: dict[str, str | None] = field(default_factory=dict)
    # 賽後人不在線，等重連再送回。
    pending_return: dict[str, str | None] = field(default_factory=dict)


@dataclass
class RoomDispatch:
    soccer: ActivityQueue = field(default_factory=ActivityQueue)
    arena: ActivityQueue = field(default_factory=ActivityQueue)
    gate_locked: bool = False


def _loads(room: Any) -> RoomDispatch:
    found = getattr(room, _ATTR, None)
    if found is None:
        found = RoomDispatch()
        setattr(room, _ATTR, found)
    return found


def _queue(room: Any, activity: DispatchActivity) -> ActivityQueue:
    state = _loads(room)
    return state.soccer if activity == "soccer" else state.arena


def _game(room: Any, activity: DispatchActivity) -> Any:
    return room.soccer if activity == "soccer" else room.arena


class TeacherDispatch:
    """一間房的等待名單。全部靜態方法，狀態掛在 Room 上。"""

    SOCCER_CAP = SOCCER_CAP
    ARENA_CAP = ARENA_CAP

    @staticmethod
    def cap(activity: DispatchActivity) -> int:
        return SOCCER_CAP if activity == "soccer" else ARENA_CAP

    @staticmethod
    def title(activity: DispatchActivity) -> str:
        return "足球對戰" if activity == "soccer" else "大亂鬥"

    @staticmethod
    def attach(room: Any) -> None:
        """賽局結束時把派送過的學生送回原關卡。在建房時掛上。"""

        async def _soccer(reason: str) -> None:
            await TeacherDispatch.finish(room, "soccer", reason)

        async def _arena(reason: str) -> None:
            await TeacherDispatch.finish(room, "arena", reason)

        room.soccer.on_match_end = _soccer
        room.arena.on_match_end = _arena

    @staticmethod
    def match_is_live(room: Any, activity: DispatchActivity) -> bool:
        status = _game(room, activity).status
        live = _SOCCER_LIVE if activity == "soccer" else _ARENA_LIVE
        return status in live

    @staticmethod
    def gate_locked(room: Any) -> bool:
        if TeacherDispatch.match_is_live(room, "soccer") or TeacherDispatch.match_is_live(
            room, "arena"
        ):
            return True
        state = _loads(room)
        return bool(state.soccer.waiting or state.arena.waiting)

    @staticmethod
    def allow_join(room: Any, activity: DispatchActivity, record: StudentRecord) -> bool:
        """自行進場。有名單或比賽中時拒絕；已在這一場（重連／剛被送進去）仍放行。

        老師把全班傳送到這個賽局時，還沒進場的學生要能加入進行中的那一場
        （見 class_level_send），除非他正在另一個活動的派送名單上等。
        """
        if not TeacherDispatch.gate_locked(room):
            return True
        key = game_player_key(record)
        if key in _queue(room, activity).playing:
            return True
        player = _game(room, activity).players.get(key)
        if player is not None and player.active:
            return True
        if player is not None and player.disconnected and TeacherDispatch.match_is_live(
            room, activity
        ):
            return True
        if ClassLevelSend.sends_into(room.roster.current_level_id, activity):
            waiting = (seat.key for act in _ACTIVITIES for seat in _queue(room, act).waiting)
            return key not in set(waiting)
        return False

    @staticmethod
    async def reject_join(record: StudentRecord, activity: DispatchActivity) -> None:
        """自行進場被拒：叫學生端退出這個活動並提示，不要停在沒有伺服器狀態的空場上。"""
        await TeacherDispatch._send(
            record, {"type": "dispatch_join_rejected", "activity": activity}
        )

    @staticmethod
    async def add(room: Any, activity: DispatchActivity, student_ids: list[str]) -> None:
        if TeacherDispatch.match_is_live(room, activity):
            await TeacherDispatch._sync_state(room, activity, notice="比賽中不可追加。")
            return
        queue = _queue(room, activity)
        occupied = {seat.student_id for seat in queue.waiting}
        occupied.update(TeacherDispatch._active_ids(room, activity))
        waiting_ids = {seat.student_id for seat in queue.waiting}
        cap = TeacherDispatch.cap(activity)
        accepted: list[StudentRecord] = []
        rejected_cap: list[str] = []
        rejected_off: list[str] = []
        seen: set[str] = set()
        for raw in student_ids:
            sid = raw.strip()
            if not sid or sid in seen:
                continue
            seen.add(sid)
            if sid in waiting_ids:
                continue
            record = room.roster.find(sid)
            if record is None or not record.connected or record.name == "?":
                label = sid
                if record is not None and record.name != "?":
                    label = record.name
                rejected_off.append(label)
                continue
            if record.id in TeacherDispatch._active_ids(room, activity):
                continue
            if len(occupied) >= cap:
                rejected_cap.append(record.name)
                continue
            if TeacherDispatch._pull_other(room, activity, game_player_key(record)):
                other: DispatchActivity = "arena" if activity == "soccer" else "soccer"
                await TeacherDispatch._sync_state(room, other)
            level = TeacherDispatch._chapter(record.level)
            seat = DispatchSeat(
                key=game_player_key(record),
                student_id=record.id,
                name=record.name,
                emoji=record.emoji,
                return_level=level,
            )
            queue.waiting.append(seat)
            occupied.add(record.id)
            waiting_ids.add(record.id)
            accepted.append(record)
        for record in accepted:
            await TeacherDispatch._send(record, TeacherDispatch._hold(activity))
        notice = TeacherDispatch._add_notice(activity, cap, rejected_cap, rejected_off)
        await TeacherDispatch._sync_state(room, activity, notice=notice)
        await TeacherDispatch.sync_gate(room)

    @staticmethod
    async def cancel(
        room: Any, activity: DispatchActivity, student_ids: list[str] | None
    ) -> None:
        if TeacherDispatch.match_is_live(room, activity):
            await TeacherDispatch._sync_state(
                room, activity, notice="比賽中無法取消，請先停止比賽。"
            )
            return
        queue = _queue(room, activity)
        if not student_ids:
            targets = list(queue.waiting)
            queue.waiting.clear()
        else:
            want = {sid.strip() for sid in student_ids if sid.strip()}
            targets = [
                seat
                for seat in queue.waiting
                if seat.student_id in want or seat.key in want
            ]
            drop = {seat.key for seat in targets}
            queue.waiting = [seat for seat in queue.waiting if seat.key not in drop]
        for seat in targets:
            record = TeacherDispatch._by_key(room, seat.key)
            if record is not None:
                await TeacherDispatch._send(record, {"type": "dispatch_release"})
        await TeacherDispatch._sync_state(room, activity)
        await TeacherDispatch.sync_gate(room)

    @staticmethod
    async def launch(
        room: Any,
        activity: DispatchActivity,
        *,
        arena_mode: str | None = None,
        arena_field: str | None = None,
    ) -> bool:
        """老師按開始：名單上的人這時才加入賽局，並通知學生切畫面。"""
        queue = _queue(room, activity)
        if not queue.waiting:
            return False
        seats = list(queue.waiting)
        queue.waiting.clear()
        for seat in seats:
            record = TeacherDispatch._by_key(room, seat.key)
            if record is None or not record.connected:
                continue
            queue.playing[seat.key] = seat.return_level
            if activity == "soccer":
                await room.arena.leave(record)
                await room.soccer.join(record)
            else:
                await room.soccer.leave(record)
                await room.arena.join(record)
            go: dict[str, str] = {"type": "dispatch_go", "activity": activity}
            if activity == "arena":
                go["arenaMode"] = arena_mode or "balloon"
                go["arenaField"] = arena_field or "grid"
            await TeacherDispatch._send(record, go)
        return True

    @staticmethod
    async def after_start(room: Any, activity: DispatchActivity) -> None:
        """開賽後同步名單階段，並鎖住全房的自行進場。"""
        await TeacherDispatch._sync_state(room, activity)
        await TeacherDispatch.sync_gate(room)

    @staticmethod
    async def finish(room: Any, activity: DispatchActivity, reason: str) -> None:
        """賽局結束。切關時不把人送回舊關（廣播的新關卡才算數）。"""
        queue = _queue(room, activity)
        if reason == "level_switch":
            await TeacherDispatch._release_waiting(room, activity)
            queue.playing.clear()
            queue.pending_return.clear()
            await TeacherDispatch._sync_state(room, activity)
            await TeacherDispatch.sync_gate(room)
            return
        pending = dict(queue.playing)
        queue.playing.clear()
        game = _game(room, activity)
        for key, level in pending.items():
            record = TeacherDispatch._by_key(room, key)
            back = TeacherDispatch._return_level(room, level, record)
            if record is not None:
                await game.leave(record)
            if record is not None and record.connected:
                if back:
                    await TeacherDispatch._send(
                        record, {"type": "load_level", "levelId": back}
                    )
                await TeacherDispatch._send(record, {"type": "dispatch_release"})
            else:
                queue.pending_return[key] = back
        await TeacherDispatch._sync_state(room, activity)
        await TeacherDispatch.sync_gate(room)

    @staticmethod
    async def on_teachers_left(room: Any) -> None:
        """這間房沒有老師了：清掉還沒進場的名單，學生恢復可飛。進行中的比賽留著。"""
        logger.info("[Dispatch] 房 %s 沒有老師，釋放等待名單", room.code)
        for activity in _ACTIVITIES:
            await TeacherDispatch._release_waiting(room, activity)
            await TeacherDispatch._sync_state(room, activity)
        await TeacherDispatch.sync_gate(room)

    @staticmethod
    async def on_register(room: Any, record: StudentRecord) -> None:
        """重連：還在名單上就再看一次看板；賽後錯過回關的補送。不在名單上就不鎖。"""
        key = game_player_key(record)
        for activity in _ACTIVITIES:
            queue = _queue(room, activity)
            touched = False
            for seat in queue.waiting:
                if seat.key == key:
                    seat.student_id = record.id
                    seat.name = record.name
                    seat.emoji = record.emoji
                    touched = True
            if touched:
                await TeacherDispatch._send(record, TeacherDispatch._hold(activity))
                await TeacherDispatch._sync_state(room, activity)
            if key in queue.pending_return and not TeacherDispatch.match_is_live(
                room, activity
            ):
                back = TeacherDispatch._return_level(room, queue.pending_return.pop(key), record)
                if back:
                    await TeacherDispatch._send(record, {"type": "load_level", "levelId": back})
                await TeacherDispatch._send(record, {"type": "dispatch_release"})
        if TeacherDispatch.gate_locked(room):
            await TeacherDispatch._send(record, {"type": "dispatch_gate", "locked": True})

    @staticmethod
    async def drop(room: Any, record: StudentRecord) -> None:
        """換房或被踢：從兩條名單移除，不再佔名額。"""
        key = game_player_key(record)
        changed: list[DispatchActivity] = []
        for activity in _ACTIVITIES:
            queue = _queue(room, activity)
            before = len(queue.waiting)
            queue.waiting = [seat for seat in queue.waiting if seat.key != key]
            had_playing = key in queue.playing or key in queue.pending_return
            queue.playing.pop(key, None)
            queue.pending_return.pop(key, None)
            if len(queue.waiting) != before or had_playing:
                changed.append(activity)
        if changed:
            await TeacherDispatch._send(record, {"type": "dispatch_release"})
        for activity in changed:
            await TeacherDispatch._sync_state(room, activity)
        await TeacherDispatch.sync_gate(room)

    @staticmethod
    async def sync_teacher(room: Any, ws: Any, *, force: bool) -> None:
        """老師連上或切房。force 時連閒置也送，切房才清得掉上一間的名單。"""
        for activity in _ACTIVITIES:
            phase = TeacherDispatch._phase(room, activity)
            queue = _queue(room, activity)
            if force or phase != "idle" or queue.playing or queue.pending_return:
                await send_safe(ws, TeacherDispatch._dump(TeacherDispatch._payload(room, activity)))

    @staticmethod
    async def sync_gate(room: Any) -> None:
        locked = TeacherDispatch.gate_locked(room)
        state = _loads(room)
        if locked == state.gate_locked:
            return
        state.gate_locked = locked
        await TeacherDispatch._broadcast_students(room, {"type": "dispatch_gate", "locked": locked})

    # ---------- 內部 ----------

    @staticmethod
    def _active_ids(room: Any, activity: DispatchActivity) -> set[str]:
        game = _game(room, activity)
        return {player.record.id for player in game.players.values() if player.active}

    @staticmethod
    def _chapter(level_id: str | None) -> str | None:
        if not level_id or ClassLevelSend.is_activity(level_id):
            return None
        return level_id

    @staticmethod
    def _return_level(
        room: Any, stored: str | None, record: StudentRecord | None
    ) -> str | None:
        return (
            TeacherDispatch._chapter(stored)
            or (TeacherDispatch._chapter(record.level) if record is not None else None)
            or TeacherDispatch._chapter(room.roster.current_level_id)
        )

    @staticmethod
    def _by_key(room: Any, key: str) -> StudentRecord | None:
        for record in room.roster.students:
            if record.name != "?" and game_player_key(record) == key:
                return record
        return None

    @staticmethod
    def _pull_other(room: Any, activity: DispatchActivity, key: str) -> bool:
        other: DispatchActivity = "arena" if activity == "soccer" else "soccer"
        queue = _queue(room, other)
        before = len(queue.waiting)
        queue.waiting = [seat for seat in queue.waiting if seat.key != key]
        return len(queue.waiting) != before

    @staticmethod
    def _hold(activity: DispatchActivity) -> dict[str, str]:
        return {
            "type": "dispatch_hold",
            "activity": activity,
            "title": TeacherDispatch.title(activity),
        }

    @staticmethod
    def _add_notice(
        activity: DispatchActivity,
        cap: int,
        rejected_cap: list[str],
        rejected_off: list[str],
    ) -> str | None:
        title = TeacherDispatch.title(activity)
        if rejected_cap:
            who = "、".join(rejected_cap)
            return f"{title}最多 {cap} 人。未派送：{who}。"
        if rejected_off:
            who = "、".join(rejected_off)
            return f"未連線，未派送：{who}。"
        return None

    @staticmethod
    def _phase(room: Any, activity: DispatchActivity) -> str:
        if TeacherDispatch.match_is_live(room, activity):
            return "live"
        if _queue(room, activity).waiting:
            return "waiting"
        return "idle"

    @staticmethod
    def _payload(
        room: Any, activity: DispatchActivity, notice: str | None = None
    ) -> dict[str, Any]:
        queue = _queue(room, activity)
        msg: dict[str, Any] = {
            "type": "dispatch_state",
            "activity": activity,
            "phase": TeacherDispatch._phase(room, activity),
            "cap": TeacherDispatch.cap(activity),
            "waiting": [
                {"id": seat.student_id, "name": seat.name, "emoji": seat.emoji}
                for seat in queue.waiting
            ],
        }
        if notice:
            msg["notice"] = notice
        return msg

    @staticmethod
    def _dump(msg: dict[str, Any]) -> str:
        return json.dumps(msg, ensure_ascii=False)

    @staticmethod
    async def _send(record: StudentRecord, msg: dict[str, Any]) -> None:
        if record.ws is not None and record.connected:
            await send_safe(record.ws, TeacherDispatch._dump(msg))

    @staticmethod
    async def _broadcast_students(room: Any, msg: dict[str, Any]) -> None:
        data = TeacherDispatch._dump(msg)
        for record in room.roster.students:
            if record.connected and record.ws is not None:
                await send_safe(record.ws, data)

    @staticmethod
    async def _sync_state(
        room: Any, activity: DispatchActivity, notice: str | None = None
    ) -> None:
        await room.roster.send_raw_to_teachers(
            TeacherDispatch._dump(TeacherDispatch._payload(room, activity, notice))
        )

    @staticmethod
    async def _release_waiting(room: Any, activity: DispatchActivity) -> None:
        queue = _queue(room, activity)
        seats = list(queue.waiting)
        queue.waiting.clear()
        for seat in seats:
            record = TeacherDispatch._by_key(room, seat.key)
            if record is not None:
                await TeacherDispatch._send(record, {"type": "dispatch_release"})
