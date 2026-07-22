"""ws.py — WebSocket endpoints 與進站訊息 guard。

角色以 URL path 區分（沿用 legacy）：/ 或 /ws = 學生（/ws 是 vite dev proxy
進來的路徑）、/teacher = 老師；其餘路徑以 1008 拒絕。

每則進站訊息先過 guard 再處理（對齊 apps/server/src/guards.ts）：
1. 每 socket 每秒 60 則上限（超過「靜默」丟棄，不 log 以免洗版）
2. 訊息大小上限 4KB（超過丟棄）
3. JSON parse + 必須是物件且帶字串 type 欄位
4. type 白名單 + Pydantic 欄位型別驗證（失敗丟棄並 log）

arena / soccer 賽局訊息在驗證後分派給 app.state.arena / app.state.soccer
（games/，狀態自持）。老師的賽局控制訊息（arena_start / soccer_start …）
只在老師 endpoint 分派 —— ticket 機制已保證 /teacher 連線＝老師。
"""

import json
import logging
import time
from typing import TYPE_CHECKING, Any

import anyio
from fastapi import FastAPI, WebSocket
from pydantic import ValidationError
from starlette.websockets import WebSocketDisconnect

from .auth import WS_CLOSE_BAD_ORIGIN, WS_CLOSE_UNAUTHORIZED, TeacherAuth, origin_allowed
from .config import Settings
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
    CompleteLevelMsg,
    ProgressMsg,
    RegisterMsg,
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
)
from .roster import Roster

if TYPE_CHECKING:
    from .games import ArenaGame, SoccerGame

logger = logging.getLogger("creafly.api.ws")

MAX_MESSAGE_BYTES = 4 * 1024  # 單則訊息大小上限
MAX_MESSAGES_PER_SEC = 60  # 每 socket 每秒訊息數上限


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
    """老師 WS 必須帶有效 ticket（?ticket=）：無效 / 過期 → accept 後以 4401 關閉。"""
    auth: TeacherAuth = ws.app.state.auth
    if auth.verify_ticket(ws.query_params.get("ticket", "")):
        return True
    logger.info("[WS] 老師連線 ticket 無效或過期，拒絕連線")
    await ws.accept()
    await ws.close(code=WS_CLOSE_UNAUTHORIZED, reason="invalid or expired ticket")
    return False


# ---------- 學生連線 ----------


async def _student_endpoint(ws: WebSocket) -> None:
    """學生 WS：welcome → register / progress / complete_level / 賽局訊息迴圈。"""
    roster: Roster = ws.app.state.roster
    arena: ArenaGame = ws.app.state.arena
    soccer: SoccerGame = ws.app.state.soccer
    if not await _origin_ok(ws):
        return
    await ws.accept()
    record = await roster.add_student(ws)  # 內含發送 welcome
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
            match valid:
                case RegisterMsg():
                    await roster.register(record, valid.name, valid.emoji)
                case ProgressMsg():
                    await roster.progress(record, valid.levelId)
                case CompleteLevelMsg():
                    await roster.complete_level(record, valid.levelId, valid.timeMs)
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
            # 賽局先清（前鋒遞補 / 排行更新要在名冊移除前算），再走名冊斷線流程
            await arena.drop(record)
            await soccer.drop(record)
            await roster.remove_student(record)


# ---------- 老師連線 ----------


async def _teacher_endpoint(ws: WebSocket) -> None:
    """老師 WS：Origin + ticket 驗證後收完整名冊，之後可下 broadcast 與賽局控制。

    賽局控制訊息（arena_start / soccer_start …）只在這裡分派 ——
    ticket 機制已保證 /teacher 連線＝老師，學生 endpoint 收到一律驗證失敗丟棄。
    """
    roster: Roster = ws.app.state.roster
    arena: ArenaGame = ws.app.state.arena
    soccer: SoccerGame = ws.app.state.soccer
    if not await _origin_ok(ws):
        return
    if not await _teacher_ticket_ok(ws):
        return
    await ws.accept()
    await roster.add_teacher(ws)
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
            match valid:
                case TeacherBroadcastMsg():
                    # 老師廣播（load_level / set_mode / reset_all / race_start / show_message）
                    if valid.payload.type in ("load_level", "race_start", "reset_all"):
                        # 智能停止：賽局（含倒數）進行中老師切關 → 先結束該賽局
                        # （end 廣播 reason:'level_switch'）再轉發關卡廣播。
                        # 同一 handler 內依序 await，學生保證先收到 end 再收到關卡廣播
                        await arena.stop("level_switch")
                        await soccer.stop("level_switch")
                    await roster.broadcast_to_students(valid.payload)
                # ----- 大亂鬥 -----
                case ArenaStartMsg():
                    await arena.start(valid)
                case ArenaStateReqMsg():
                    await arena.send_snapshot_to(ws)
                case ArenaStopMsg():
                    await arena.stop()
                # ----- 足球 -----
                case SoccerStartMsg():
                    await soccer.start(valid.durationSec, valid.mode)
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
    except WebSocketDisconnect:
        pass
    finally:
        roster.remove_teacher(ws)


# ---------- 未知路徑 ----------


async def _reject_endpoint(ws: WebSocket, path: str) -> None:
    """未知 WS 路徑：拒絕連線（對齊 Node 版 close 1008）。"""
    logger.info("[WS] 未知路徑 /%s，拒絕連線", path)
    await ws.accept()
    await ws.close(code=1008, reason="unknown path")


def register_ws_routes(app: FastAPI) -> None:
    """註冊 WS 路由。順序重要：具體路徑在前、拒絕用的 catch-all 在最後。"""
    app.add_api_websocket_route("/teacher", _teacher_endpoint)
    app.add_api_websocket_route("/", _student_endpoint)
    app.add_api_websocket_route("/ws", _student_endpoint)
    app.add_api_websocket_route("/{path:path}", _reject_endpoint)
