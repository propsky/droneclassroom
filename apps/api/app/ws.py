"""ws.py — WebSocket endpoints 與進站訊息 guard。

角色以 URL path 區分（沿用 legacy）：/ 或 /ws = 學生（/ws 是 vite dev proxy
進來的路徑）、/teacher = 老師；其餘路徑以 1008 拒絕。

每則進站訊息先過 guard 再處理（對齊 apps/server/src/guards.ts）：
1. 每 socket 每秒 60 則上限（超過「靜默」丟棄，不 log 以免洗版）
2. 訊息大小上限 4KB（超過丟棄）
3. JSON parse + 必須是物件且帶字串 type 欄位
4. type 白名單 + Pydantic 欄位型別驗證（失敗丟棄並 log）

名冊 / 賽局都是「每房一份」（rooms.py）：
- 學生：連線 URL 沒帶 ?room= → 連上即進預設房（既有流程原封不動）；有帶 → 等 register
  才進房。register 可帶 roomCode / roomPassword，通過門檢（存在 / 未鎖 / 未滿 / 密碼）
  才進房並收 room_joined，被拒收 room_rejected 但不斷線（可改碼重試；連錯密碼
  MAX_BAD_PASSWORD_TRIES 次才斷，防暴力）。之後所有訊息路由到該房的名冊 / 賽局。
  帳號模式：register 帶 studentToken → 名字 / emoji 以 DB 為準、自動進所屬班級的房
  （roomCode 忽略、免房間密碼）；房沒開回 room_rejected reason:'closed'；
  token 無效退回訪客路徑照舊處理（不斷線）。
- 老師：一條 WS 管多間；帶 roomCode 的訊息路由到該房、缺省用目前選定的房。
  賽局控制訊息（arena_start / soccer_start …）只在老師 endpoint 分派 ——
  ticket 機制已保證 /teacher 連線＝老師。
  有 DB 時老師開的房是持久化班級（rooms.py）：管理類訊息（room_update / room_close /
  room_kick / room_open_team / room_archive_team）限班級擁有者，不是就忽略 + log；
  預設房 MAIN 與無 DB 的記憶體房仍所有老師共用。
"""

import json
import logging
import time
from datetime import UTC, datetime
from typing import Any

import anyio
from fastapi import FastAPI, WebSocket
from pydantic import ValidationError
from starlette.websockets import WebSocketDisconnect

from .accounts import resolve_session, resolve_student_session
from .auth import WS_CLOSE_BAD_ORIGIN, WS_CLOSE_UNAUTHORIZED, TeacherAuth, origin_allowed
from .config import Settings
from .db.models import Student, Teacher, Team
from .entitlement import build_register_entitlement
from .levels_catalog import resolve_team_allowed_ids
from .progress import latest_completion, load_progress, progress_sync_msg, save_completion
from .protocol import (
    STUDENT_MESSAGE_ADAPTER,
    TEACHER_MESSAGE_ADAPTER,
    ArenaJoinMsg,
    ArenaLeaveMsg,
    ArenaPopMsg,
    ArenaPosMsg,
    ArenaStartMsg,
    ArenaStateReqMsg,
    ArenaStopMsg,
    CompleteAckMsg,
    CompleteLevelMsg,
    LevelLoadDeniedMsg,
    LevelLoadOkMsg,
    LevelLoadReqMsg,
    LevelStartMsg,
    PingMsg,
    PongMsg,
    ProgressMsg,
    RegisterMsg,
    RejectReason,
    RoomArchiveTeamMsg,
    RoomCloseMsg,
    RoomCreateMsg,
    RoomCreateSubMsg,
    RoomJoinedMsg,
    RoomKickMsg,
    RoomListReqMsg,
    RoomMoveStudentMsg,
    RoomOpenTeamMsg,
    RoomRejectedMsg,
    RoomSelectMsg,
    RoomUpdateMsg,
    ShowMessagePayload,
    SoccerGoalMsg,
    SoccerJoinMsg,
    SoccerLeaveMsg,
    SoccerPosMsg,
    SoccerResetMsg,
    SoccerSetStrikerMsg,
    SoccerSetTeamMsg,
    SoccerStartMsg,
    SoccerStateReqMsg,
    SoccerStopMsg,
    TeacherBroadcastMsg,
    TeacherBroadcastPayload,
)
from .replay_logs import load_replay_recording
from .replay_verify import verify_input_log
from .rest import known_level_ids
from .rooms import Room, RoomLimitError, RoomManager
from .roster import StudentRecord, send_safe

logger = logging.getLogger("creafly.api.ws")

MAX_MESSAGE_BYTES = 4 * 1024  # 單則訊息大小上限
MAX_MESSAGES_PER_SEC = 60  # 每 socket 每秒訊息數上限
MAX_BAD_PASSWORD_TRIES = 5  # 同一連線連續錯房間密碼幾次就斷線（防暴力猜密碼）
WS_CLOSE_POLICY_VIOLATION = 1008  # RFC 6455 標準碼：未知路徑 / 連錯密碼過多


class RateLimiter:
    """固定視窗速率限制（每秒歸零），對齊 Node 版 guards.createRateLimiter。"""

    __slots__ = ("count", "window_start")

    def __init__(self) -> None:
        self.window_start = 0.0
        self.count = 0

    def allow(self, now: float | None = None) -> bool:
        """回傳 True = 允許處理；False = 超速，呼叫端應靜默丟棄。"""
        if now is None:
            now = time.monotonic()
        if now - self.window_start >= 1.0:
            self.window_start = now
            self.count = 0
        self.count += 1
        return self.count <= MAX_MESSAGES_PER_SEC


def _frame_to_text(frame: dict[str, Any]) -> str | None:
    """WS frame → utf8 字串；超過大小上限或非法編碼回 None（丟棄）。"""
    text = frame.get("text")
    if text is not None:
        if len(text.encode("utf-8")) > MAX_MESSAGE_BYTES:
            return None
        return text
    data: bytes = frame.get("bytes") or b""
    if len(data) > MAX_MESSAGE_BYTES:
        return None
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        return None


def _parse_json_object(text: str) -> dict[str, Any] | None:
    """JSON parse + 必須是物件且帶字串 type 欄位；否則回 None（丟棄）。"""
    try:
        value = json.loads(text)
    except (ValueError, RecursionError):
        return None
    if not isinstance(value, dict) or not isinstance(value.get("type"), str):
        return None
    return value


async def _next_message(ws: WebSocket, limiter: RateLimiter) -> dict[str, Any] | None:
    """收下一則通過 guard 的訊息；連線結束時拋 WebSocketDisconnect。

    被 guard 擋下的訊息直接丟棄、繼續等下一則。
    """
    while True:
        frame = await ws.receive()
        if frame["type"] == "websocket.disconnect":
            raise WebSocketDisconnect(code=frame.get("code", 1000))
        if not limiter.allow():  # 超速 → 靜默丟棄
            continue
        text = _frame_to_text(frame)
        if text is None:  # 超過 4KB / 非法編碼 → 丟棄
            continue
        msg = _parse_json_object(text)
        if msg is None:  # 非 JSON 物件 / 無 type → 丟棄
            continue
        return msg


# ---------- 升級時的檢查（Origin / ticket）----------


async def _origin_ok(ws: WebSocket) -> bool:
    """Origin 白名單：不通過時 accept 後立即以 4403 關閉（讓 client 收得到 code）。"""
    settings: Settings = ws.app.state.settings
    origin = ws.headers.get("origin")
    if origin_allowed(origin, ws.headers.get("host"), settings.allowed_origins_set):
        return True
    logger.info("[WS] Origin 不在白名單，拒絕連線：%s", origin)
    await ws.accept()
    await ws.close(code=WS_CLOSE_BAD_ORIGIN, reason="origin not allowed")
    return False


async def _teacher_ticket_ok(ws: WebSocket) -> bool:
    """老師 WS 必須帶有效 ticket（?ticket=）：無效 / 過期 → accept 後以 4401 關閉。

    有資料庫：ticket = DB session token（/auth/teacher/login 發的），查 sessions 表
    （未撤銷 / 未過期、老師 active），通過後 ws.state.teacher_id 記下老師 id
    （班級擁有者判定 / 班級清單用）。
    無資料庫：退回舊 HMAC ticket（POST /auth/teacher PIN 登入），ws.state.teacher_id = None。
    """
    ticket = ws.query_params.get("ticket", "")
    ws.state.teacher_id = None
    maker = ws.app.state.db_sessionmaker
    if maker is None:
        auth: TeacherAuth = ws.app.state.auth
        ok = auth.verify_ticket(ticket)
    else:
        settings: Settings = ws.app.state.settings
        async with maker() as session:
            row = await resolve_session(
                session,
                ticket,
                ttl=settings.session_ttl_sec,
                touch_interval=settings.session_touch_interval_sec,
            )
            teacher = (
                await session.get(Teacher, row.principal_id)
                if row is not None and row.principal_type == "teacher"
                else None
            )
            ok = teacher is not None and teacher.status == "active"
            await session.commit()  # 滑動延長落地
        if ok:
            ws.state.teacher_id = teacher.id
    if ok:
        return True
    logger.info("[WS] 老師連線 ticket 無效或過期，拒絕連線")
    await ws.accept()
    await ws.close(code=WS_CLOSE_UNAUTHORIZED, reason="invalid or expired ticket")
    return False


# ---------- 學生連線 ----------


async def _apply_broadcast(room: Room, payload: TeacherBroadcastPayload) -> None:
    """把一則老師廣播套用到一間房（單房與 allRooms 整班共用同一條路徑）。"""
    if payload.type in ("load_level", "race_start", "reset_all"):
        # 智能停止：賽局（含倒數）進行中老師切關 → 先結束該賽局
        # （end 廣播 reason:'level_switch'）再轉發關卡廣播。
        # 同一 handler 內依序 await，學生保證先收到 end 再收到關卡廣播
        await room.arena.stop("level_switch")
        await room.soccer.stop("level_switch")
    if payload.type in ("load_level", "race_start"):
        # 記住課程關卡：遲到 / 重整的學生連上時補載入
        room.roster.current_level_id = payload.levelId
    if payload.type == "lock_level":
        # 鎖定狀態存伺服器（遲到者補送），並回送看著這房的老師同步開關 UI
        room.roster.level_locked = payload.locked
        await room.roster.send_raw_to_teachers(payload.model_dump_json())
    await room.roster.broadcast_to_students(payload)


async def _notify_not_in_game(room: Room, player_ids: set[str], text: str) -> None:
    """賽局開始時提醒「在房內但沒加入賽局」的學生（賽局訊息只發給已 join 者）。"""
    data = ShowMessagePayload(type="show_message", text=text).model_dump_json()
    for s in room.roster.students:
        if s.ws is not None and s.connected and s.id not in player_ids:
            await send_safe(s.ws, data)


async def _student_endpoint(ws: WebSocket) -> None:
    """學生 WS：welcome →（進房）→ register / progress / complete_level / 賽局訊息迴圈。

    room = 目前所在的房（None = 帶 ?room= 連上但還沒 register 通過）；
    所有名冊 / 賽局訊息都路由到 room 的 roster / arena / soccer。
    """
    rooms: RoomManager = ws.app.state.rooms
    if not await _origin_ok(ws):
        return
    await ws.accept()
    record = await rooms.new_student(ws)  # 配發 id + 發 welcome
    # 連線 URL 的 ?room=：作為 register 缺省 roomCode；沒帶 → 連上即進預設房（舊流程）
    url_room: str | None = ws.query_params.get("room") or None
    room: Room | None = None
    if url_room is None:
        room = rooms.default
        await room.roster.add_student(record)
    bad_password_tries = 0
    limiter = RateLimiter()
    try:
        while True:
            msg = await _next_message(ws, limiter)
            try:
                valid = STUDENT_MESSAGE_ADAPTER.validate_python(msg)
            except ValidationError:
                logger.info(
                    "[WS] 學生訊息驗證失敗，丟棄：type=%s（%s）", msg["type"], record.name
                )
                continue
            # 心跳基準：任何有效訊息都算「有回應」；ping 另外標記此 client 會送心跳
            record.last_seen = time.monotonic()
            if isinstance(valid, PingMsg):
                record.pinged = True
                await send_safe(ws, PongMsg(t=valid.t).model_dump_json())
                continue
            if isinstance(valid, RegisterMsg):
                # ----- 帳號模式（studentToken）：名字 / emoji 以 DB 為準、自動進所屬班級的房；
                #       token 無效退回訪客路徑照舊處理（不斷線）-----
                name, emoji, student_id = valid.name, valid.emoji, None
                skip_password = False
                team_id: int | None = None
                account = (
                    await _resolve_student_token(ws, valid.studentToken)
                    if valid.studentToken
                    else None
                )
                if account is not None:
                    student, team = account
                    name, emoji, student_id = student.name, student.emoji, student.id
                    team_id = team.id
                    skip_password = True  # token 已驗明身分（本來就是這班的學生），免房間密碼
                    # 進房路由：老師有指派分房且該分房開著 → 分房；否則主房
                    target = rooms.route_room_for(team.id, student.id)
                    if target is None:
                        # 班級的房沒開：老師開房學生才進得來（跟實體課一致）
                        await _send_rejected(ws, "closed")
                        continue
                else:
                    target = rooms.get(valid.roomCode or url_room)
                # ----- 進房門檢 → 進房 / 換房 → 報到 -----
                reason = _join_check(
                    target, room, record, name, valid.roomPassword, skip_password=skip_password
                )
                if reason is not None:
                    await _send_rejected(ws, reason)
                    bad_password_tries = bad_password_tries + 1 if reason == "bad_password" else 0
                    if bad_password_tries >= MAX_BAD_PASSWORD_TRIES:
                        logger.info("[WS] %s 連錯房間密碼太多次，斷線", record.id)
                        await ws.close(code=WS_CLOSE_POLICY_VIOLATION, reason="bad password")
                        break
                    continue
                bad_password_tries = 0
                assert target is not None  # _join_check 已排除
                if target is not room:
                    if room is not None:
                        await _leave_room(room, record)
                    room = target
                    await room.roster.add_student(record)
                record.student_id = student_id
                # ----- 帳號模式：撈歷史進度（progress 表）——
                #       名冊初始 level / time 帶最近完成的關卡（老師看到延續的進度），
                #       register 後下行 progress_sync（跨裝置成績同步）-----
                progress_rows = (
                    await load_progress(ws.app.state.db_sessionmaker, student_id)
                    if student_id is not None
                    else []
                )
                latest = latest_completion(progress_rows)
                if latest is not None and record.level is None:
                    record.level = latest.level_id
                    record.time = (
                        float(latest.best_time_ms) if latest.best_time_ms is not None else None
                    )
                await room.roster.register(record, name, emoji)
                known = getattr(ws.app.state, "known_levels", None) or known_level_ids(
                    ws.app.state.levels
                )
                team_level_ids: list[str] | None = None
                maker = ws.app.state.db_sessionmaker
                if maker is not None and team_id is not None:
                    async with maker() as session:
                        team_level_ids = await resolve_team_allowed_ids(
                            session, team_id, known
                        )
                entitlement = build_register_entitlement(
                    ws.app.state.settings,
                    known,
                    student_id=student_id,
                    team_level_ids=team_level_ids,
                )
                record.allowed_level_ids = (
                    frozenset(entitlement.levelIds)
                    if entitlement is not None and entitlement.mode != "open"
                    else None
                )
                joined = RoomJoinedMsg(room=room.info(), entitlement=entitlement)
                await send_safe(ws, joined.model_dump_json(exclude_none=True))
                if student_id is not None:
                    # 空進度也送：client 以此確認同步完成（進房即知道哪些關已完成）
                    await send_safe(ws, progress_sync_msg(progress_rows).model_dump_json())
                continue
            if room is None:
                # 帶 ?room= 連上但還沒進房：其餘訊息一律忽略（先 register）
                continue
            roster, arena, soccer = room.roster, room.arena, room.soccer
            match valid:
                case ProgressMsg():
                    await roster.progress(record, valid.levelId)
                case LevelStartMsg():
                    # 計時真正起算（按開始 / 倒數結束）→ 校正防作弊觀察起點
                    roster.level_start(record, valid.levelId)
                case LevelLoadReqMsg():
                    allowed = record.allowed_level_ids
                    if allowed is not None and valid.levelId not in allowed:
                        await send_safe(
                            ws,
                            LevelLoadDeniedMsg(levelId=valid.levelId).model_dump_json(),
                        )
                    else:
                        await send_safe(
                            ws,
                            LevelLoadOkMsg(levelId=valid.levelId).model_dump_json(),
                        )
                case CompleteLevelMsg():
                    replay_reason: str | None = None
                    maker = ws.app.state.db_sessionmaker
                    if (
                        valid.replayLogRef
                        and valid.replayHash
                        and record.student_id is not None
                        and maker is not None
                    ):
                        async with maker() as session:
                            rec = await load_replay_recording(
                                session, valid.replayLogRef, record.student_id
                            )
                        if rec is None:
                            replay_reason = "找不到輸入錄製"
                        else:
                            replay_reason = verify_input_log(rec, valid.replayHash)
                    reasons = await roster.complete_level(
                        record, valid.levelId, valid.timeMs, offline=valid.offline
                    )
                    if replay_reason:
                        reasons = [*reasons, replay_reason]
                        record.suspect = True
                        if replay_reason not in record.suspect_reasons:
                            record.suspect_reasons.append(replay_reason)
                    # 帳號學生且有 DB → 入庫（progress + 稽核）；落地才回 complete_ack。
                    # 訪客 / 無 DB：行為與從前完全相同（不入庫、不回 ack）
                    if record.student_id is not None and maker is not None:
                        if (
                            record.allowed_level_ids is not None
                            and valid.levelId not in record.allowed_level_ids
                        ):
                            logger.info(
                                "[WS] %s 完成未授權關卡 %s，略過入庫",
                                record.id,
                                valid.levelId,
                            )
                            continue
                        saved = await save_completion(
                            maker,
                            student_id=record.student_id,
                            team_id=room.team_id,
                            msg=valid,
                            suspect_reasons=reasons,
                        )
                        if saved and valid.clientEventId:
                            await send_safe(
                                ws,
                                CompleteAckMsg(
                                    clientEventId=valid.clientEventId
                                ).model_dump_json(),
                            )
                # ----- 大亂鬥 -----
                case ArenaJoinMsg():
                    await soccer.leave(record)  # 與足球互斥（legacy 只有足球→大亂鬥單向，補齊雙向）
                    await arena.join(record)
                case ArenaLeaveMsg():
                    await arena.leave(record)
                case ArenaPosMsg():
                    await arena.pos(record, valid)
                case ArenaPopMsg():
                    await arena.pop(record, valid)
                # ----- 足球 -----
                case SoccerJoinMsg():
                    await arena.leave(record)  # 與大亂鬥互斥（legacy soccerJoin 行為）
                    await soccer.join(record)
                case SoccerLeaveMsg():
                    await soccer.leave(record)
                case SoccerPosMsg():
                    await soccer.pos(record, valid)
                case SoccerGoalMsg():
                    await soccer.goal(record)
    except WebSocketDisconnect:
        pass
    finally:
        # 斷線清理必須完整跑完（賽局移除 → 前鋒遞補 → 名冊更新），否則老師端狀態會殘缺。
        # 連線 task 可能被 cancel（server shutdown / TestClient 收尾），故 shield 保護
        with anyio.CancelScope(shield=True):
            if room is not None:
                # 賽局先清（前鋒遞補 / 排行更新要在名冊移除前算），再走名冊斷線流程
                await room.arena.disconnect(record)
                await room.soccer.disconnect(record)
                await room.roster.remove_student(record)


def _join_check(
    target: Room | None,
    current: Room | None,
    record: StudentRecord,
    name: str,
    password: str | None,
    *,
    skip_password: bool = False,
) -> RejectReason | None:
    """register 門檢：房不存在 → not_found；換房或首次報到 → 該房 reject_reason；
    已在房內的重新 register（改名 / 換 emoji）不再檢查。回 None = 放行。

    skip_password：帳號模式（studentToken 已驗明身分）免房間密碼。"""
    if target is None:
        return "not_found"
    if target is not current or record.name == "?":
        return target.reject_reason(record, name, password, skip_password=skip_password)
    return None


async def _resolve_student_token(ws: WebSocket, token: str) -> tuple[Student, Team] | None:
    """register 的 studentToken → (學生, 班級)；順便滑動延長 session、更新 last_seen_at。

    無 DB / token 無效 / 學生 removed / 班級封存 / DB 出錯 → None（呼叫端退回訪客路徑，
    不斷線 —— 帳號解析失敗不能讓學生連不上課）。
    """
    maker = ws.app.state.db_sessionmaker
    if maker is None:
        return None
    settings: Settings = ws.app.state.settings
    try:
        async with maker() as session:
            resolved = await resolve_student_session(session, token, settings=settings)
            if resolved is None:
                return None
            _, student, team = resolved
            student.last_seen_at = datetime.now(UTC)
            await session.commit()  # 滑動延長 + last_seen_at 落地
            return student, team
    except Exception:  # noqa: BLE001 — 見 docstring
        logger.exception("[WS] studentToken 解析失敗，退回訪客路徑")
        return None


async def _send_rejected(ws: WebSocket, reason: RejectReason) -> None:
    await send_safe(ws, RoomRejectedMsg(reason=reason).model_dump_json())


async def _leave_room(room: Room, record: StudentRecord) -> None:
    """學生換房：從舊房的賽局與名冊整筆移出（連線不動）。"""
    await room.arena.drop(record)
    await room.soccer.drop(record)
    await room.roster.detach(record)


# ---------- 老師連線 ----------


async def _teacher_endpoint(ws: WebSocket) -> None:
    """老師 WS：Origin + ticket 驗證後收房間列表與預設房名冊，之後可下 broadcast / 賽局控制 /
    房間管理。

    帶 roomCode 的訊息路由到該房（不存在 → 丟棄並 log），缺省用目前選定的房。
    賽局控制訊息（arena_start / soccer_start …）只在這裡分派 ——
    ticket 機制已保證 /teacher 連線＝老師，學生 endpoint 收到一律驗證失敗丟棄。
    """
    rooms: RoomManager = ws.app.state.rooms
    if not await _origin_ok(ws):
        return
    if not await _teacher_ticket_ok(ws):
        return
    await ws.accept()
    teacher_id: int | None = ws.state.teacher_id  # 帳號 id（有 DB）；無 DB 為 None
    await rooms.add_teacher(ws, teacher_id)
    limiter = RateLimiter()
    try:
        while True:
            msg = await _next_message(ws, limiter)
            try:
                valid = TEACHER_MESSAGE_ADAPTER.validate_python(msg)
            except ValidationError:
                # broadcast payload 不在白名單、欄位型別不符、或未知 type → 丟棄並 log
                logger.info("[WS] 老師訊息驗證失敗，丟棄：type=%s", msg["type"])
                continue
            # ----- 房間管理（不需目標房或自帶 roomCode）-----
            match valid:
                case RoomCreateMsg():
                    try:
                        room = await rooms.create(valid.settings, teacher_id)
                    except RoomLimitError as e:
                        logger.info("[Room] 開房失敗：%s", e)
                        continue
                    await rooms.select(ws, room)  # 開完自動切過去
                    rooms.notify()  # 其他老師的列表也要有新房
                    continue
                case RoomOpenTeamMsg():
                    # 班級載入成 Room（已開著只切換）；非擁有者 / 已封存 / 無 DB → 忽略
                    try:
                        room = await rooms.open_team(teacher_id, valid.teamId)
                    except RoomLimitError as e:
                        logger.info("[Room] 開班級 #%d 失敗：%s", valid.teamId, e)
                        continue
                    if room is None:
                        continue
                    await rooms.select(ws, room)
                    rooms.notify()
                    continue
                case RoomArchiveTeamMsg():
                    if await rooms.archive_team(teacher_id, valid.teamId):
                        await rooms.send_room_list(ws)  # 班級清單變了（房沒變時 notify 不會推）
                    continue
                case RoomCreateSubMsg():
                    # 一班多房：在班級主房下開分房（限擁有者、主房要先開著）
                    parent = rooms.get_by_team(valid.teamId)
                    if parent is None or not rooms.can_manage(parent, teacher_id):
                        logger.info(
                            "[Room] 老師 %s 開分房被拒（班級 #%d 未開房或非擁有者）",
                            teacher_id,
                            valid.teamId,
                        )
                        continue
                    try:
                        sub = await rooms.create_sub_room(parent, valid.name)
                    except RoomLimitError as e:
                        logger.info("[Room] 開分房失敗：%s", e)
                        continue
                    await rooms.select(ws, sub)  # 建完自動切過去（與 room_create 一致）
                    continue
                case RoomListReqMsg():
                    await rooms.send_room_list(ws)
                    continue
            # 其餘訊息都要有目標房：roomCode 指定 → 該房；缺省 → 目前選定的房
            code = getattr(valid, "roomCode", None)
            room = rooms.get(code) if code else rooms.selected(ws)
            if room is None:
                logger.info("[Room] 房間 %s 不存在，丟棄老師訊息 type=%s", code, valid.type)
                continue
            # 管理類訊息對班級房限擁有者（預設房 / 記憶體房所有老師共用）
            if isinstance(valid, RoomUpdateMsg | RoomKickMsg | RoomCloseMsg) and not (
                rooms.can_manage(room, teacher_id)
            ):
                logger.info(
                    "[Room] 老師 %s 非班級房 %s 擁有者，忽略 type=%s",
                    teacher_id,
                    room.code,
                    valid.type,
                )
                continue
            roster, arena, soccer = room.roster, room.arena, room.soccer
            match valid:
                case RoomSelectMsg():
                    await rooms.select(ws, room)
                case RoomUpdateMsg():
                    await rooms.update(room, valid.settings, teacher_id)
                case RoomKickMsg():
                    target = roster.find(valid.studentId)
                    if target is not None:
                        await rooms.kick(room, target)
                case RoomMoveStudentMsg():
                    # 移動學生（一班多房分組）：來源要可管理（預設房例外 — 撈回停在
                    # MAIN 的學生），目標也要可管理；帳號學生移入分房會持久化指派
                    dst = rooms.get(valid.toRoomCode)
                    target = roster.find(valid.studentId)
                    if (
                        dst is None
                        or target is None
                        or dst is room
                        or not rooms.can_manage(dst, teacher_id)
                        or not (room is rooms.default or rooms.can_manage(room, teacher_id))
                    ):
                        logger.info(
                            "[Room] 老師 %s 移動學生被拒（%s → %s）",
                            teacher_id,
                            room.code,
                            valid.toRoomCode,
                        )
                        continue
                    await rooms.move_student(room, target, dst)
                case RoomCloseMsg():
                    if not await rooms.close(room):
                        logger.info("[Room] 預設房 %s 不可關閉", room.code)
                case TeacherBroadcastMsg():
                    # 老師廣播（load_level / set_mode / reset_all / race_start /
                    # show_message / lock_level）→ 該房全體學生；
                    # allRooms 且目標房屬於班級 → 該班級所有房（主房＋分房）一次套用
                    targets = (
                        rooms.team_rooms(room.team_id)
                        if valid.allRooms and room.team_id is not None
                        else [room]
                    )
                    for target_room in targets:
                        await _apply_broadcast(target_room, valid.payload)
                # ----- 大亂鬥 -----
                case ArenaStartMsg():
                    await arena.start(valid)
                    # 賽局訊息只發給已 join 的學生 → 沒進大亂鬥畫面的人會完全沒反應；
                    # 用廣播橫幅提醒他們加入（老師「按了開始學生卻沒動靜」的第三大成因）
                    await _notify_not_in_game(
                        room, set(arena.players), "🎈 老師開始了大亂鬥！點右下角「大亂鬥」加入"
                    )
                case ArenaStateReqMsg():
                    await arena.send_snapshot_to(ws)
                case ArenaStopMsg():
                    await arena.stop()
                # ----- 足球 -----
                case SoccerStartMsg():
                    await soccer.start(valid.durationSec, valid.mode)
                    await _notify_not_in_game(
                        room,
                        set(soccer.players),
                        "⚽ 老師開始了足球對戰！點右下角「足球對戰」加入",
                    )
                case SoccerStateReqMsg():
                    await soccer.send_snapshot_to(ws)
                case SoccerStopMsg():
                    await soccer.stop()
                case SoccerSetStrikerMsg():
                    await soccer.set_striker(valid.studentId)
                case SoccerSetTeamMsg():
                    await soccer.set_team(valid.studentId, valid.team)
                case SoccerResetMsg():
                    await soccer.reset(valid.clearTeams)
            rooms.notify()  # 賽局狀態 / 設定可能變了 → 房間列表（沒變不推）
    except WebSocketDisconnect:
        pass
    finally:
        rooms.remove_teacher(ws)


# ---------- 未知路徑 ----------


async def _reject_endpoint(ws: WebSocket, path: str) -> None:
    """未知 WS 路徑：拒絕連線（對齊 Node 版 close 1008）。"""
    logger.info("[WS] 未知路徑 /%s，拒絕連線", path)
    await ws.accept()
    await ws.close(code=WS_CLOSE_POLICY_VIOLATION, reason="unknown path")


def register_ws_routes(app: FastAPI) -> None:
    """註冊 WS 路由。順序重要：具體路徑在前、拒絕用的 catch-all 在最後。"""
    app.add_api_websocket_route("/teacher", _teacher_endpoint)
    app.add_api_websocket_route("/", _student_endpoint)
    app.add_api_websocket_route("/ws", _student_endpoint)
    app.add_api_websocket_route("/{path:path}", _reject_endpoint)
