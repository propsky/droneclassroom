"""games/base.py — 賽局共用底盤：扇出、倒數推進、時鐘 / 亂數注入、位置級防作弊。

位置級防作弊（legacy 沒有，本次新增）：
- 進站座標 clamp 到場地邊界（超界不丟棄，直接用 clamp 值 — 邊界磨蹭是常態不是作弊）
- 相鄰兩次位置回報換算速度，超過上限 → 忽略該次更新並記一次 strike
- strike 累積達門檻 → 沿用 roster 既有 suspect 機制標記（標記不阻擋，老師端顯示 ⚠️）
"""

import json
import logging
import math
import random
import time
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from typing import Any, Protocol

from fastapi import WebSocket

from ..roster import Roster, StudentRecord, send_safe

logger = logging.getLogger("creafly.api.games")

# ---------- 防作弊門檻（具名常數 + 理由）----------

# 合法極速：legacy client 手感常數換算 —— 極速 ≈ THRUST / (1 - DRAG) = 0.15 單位/影格，
# 60fps ≈ 9 單位/秒；鬼抓人的鬼再加速 ×1.5 ≈ 13.5，取整 12 單位/秒作為「玩家能達到的上限」
MAX_LEGIT_SPEED = 12.0
# 再放 50% 裕度：吸收回報間隔抖動與瞬間增速，只抓「明顯瞬移」、不抓臨界值附近的正常飛行
SPEED_MARGIN = 1.5
SPEED_LIMIT = MAX_LEGIT_SPEED * SPEED_MARGIN  # 18 單位/秒
# 相鄰回報間隔下限：client 約 10–20Hz 回報，網路抖動會把兩則回報擠到只差幾 ms，
# 直接用實際間隔當分母會把正常移動誤判成瞬移，故取 50ms 下限
MIN_POS_INTERVAL_MS = 50.0
# strike 累積達此門檻 → 標 suspect：單次超速可能是網路異常，連續多次才視為竄改
STRIKE_SUSPECT_LIMIT = 5

COUNTDOWN_STEP_MS = 1000.0  # 3-2-1 倒數的間隔（legacy setTimeout 1000）


@dataclass(frozen=True)
class FieldBounds:
    """場地邊界（clamp 用）：x/z 對稱（±max）、y 給上下限。"""

    max_x: float
    max_z: float
    min_y: float
    max_y: float


class GamePlayer(Protocol):
    """賽局玩家共同欄位（arena / soccer 的 dataclass 都符合）。"""

    record: StudentRecord
    x: float
    y: float
    z: float
    yaw: float
    last_pos_ms: float | None
    strikes: int


def clamp(v: float, lo: float, hi: float) -> float:
    """夾在 [lo, hi] 區間。"""
    return max(lo, min(hi, v))


class BaseGame:
    """賽局共用底盤：狀態自持（實例掛 app.state），無模組級全域可變狀態。"""

    def __init__(self, roster: Roster) -> None:
        self.roster = roster
        # 時鐘 / 亂數可注入（測試用假時鐘 / 固定種子）；預設 wall-clock epoch 毫秒
        # （endTime 走線上給 client 與 Date.now() 比對，必須是 epoch 毫秒 — 對齊 legacy）
        self.now_ms: Callable[[], float] = lambda: time.time() * 1000
        self.rng = random.Random()
        self.status = "idle"
        self._countdown_n = 0
        self._countdown_next_ms = 0.0

    # ---------- 扇出 ----------

    @staticmethod
    def _dump(msg: dict[str, Any]) -> str:
        return json.dumps(msg, ensure_ascii=False)

    async def _send(self, record: StudentRecord, msg: dict[str, Any]) -> None:
        """對單一學生送出（斷線靜默略過）。"""
        if record.ws is not None:
            await send_safe(record.ws, self._dump(msg))

    async def _send_ws(self, ws: WebSocket, msg: dict[str, Any]) -> None:
        """對指定 socket 送出（老師的 state_req 回覆用）。"""
        await send_safe(ws, self._dump(msg))

    async def _broadcast(self, players: Iterable[GamePlayer], msg: dict[str, Any]) -> None:
        """對一批賽局玩家扇出同一則訊息。"""
        data = self._dump(msg)
        for p in players:
            if p.record.ws is not None:
                await send_safe(p.record.ws, data)

    async def _broadcast_teachers(self, msg: dict[str, Any]) -> None:
        """對所有老師扇出（排行 / 勝負老師後台也要看）。"""
        await self.roster.send_raw_to_teachers(self._dump(msg))

    # ---------- 3-2-1 倒數 ----------
    # legacy 用 setTimeout 鏈；改由 tick() 推進：測試可注入時鐘，且倒數中把 status
    # 改回 idle（reset）倒數就自然停住 —— legacy 沒做的「倒數中可取消」靠這個補上。

    async def _begin_countdown(self) -> None:
        """立即送 n=3，之後由 _tick_countdown 每滿 1 秒遞減。呼叫端先把 status 設好。"""
        self._countdown_n = 3
        self._countdown_next_ms = self.now_ms() + COUNTDOWN_STEP_MS
        await self._send_countdown(3)

    async def _tick_countdown(self) -> None:
        """倒數推進：時間到遞減並廣播；數完呼叫 _go()。"""
        while self.status == "countdown" and self.now_ms() >= self._countdown_next_ms:
            self._countdown_n -= 1
            if self._countdown_n > 0:
                await self._send_countdown(self._countdown_n)
                self._countdown_next_ms += COUNTDOWN_STEP_MS
            else:
                await self._go()
                return

    async def _send_countdown(self, n: int) -> None:
        raise NotImplementedError

    async def _go(self) -> None:
        raise NotImplementedError

    # ---------- 位置級防作弊 ----------

    async def _apply_pos(
        self,
        player: GamePlayer,
        bounds: FieldBounds,
        x: float,
        y: float,
        z: float,
        yaw: float,
        game_name: str,
    ) -> bool:
        """套用一次位置回報：clamp 到場地邊界 + 速度上限檢查。

        超速 → 忽略該次更新並記 strike，回 False。
        伺服器主導的傳送（GO 出生點 / 被抓 respawn）由呼叫端把 last_pos_ms 設回
        None 重置測速基準，避免合法瞬移被誤判。
        """
        now = self.now_ms()
        cx = clamp(x, -bounds.max_x, bounds.max_x)
        cy = clamp(y, bounds.min_y, bounds.max_y)
        cz = clamp(z, -bounds.max_z, bounds.max_z)
        if player.last_pos_ms is not None:
            dt_sec = max(MIN_POS_INTERVAL_MS, now - player.last_pos_ms) / 1000.0
            speed = math.dist((cx, cy, cz), (player.x, player.y, player.z)) / dt_sec
            if speed > SPEED_LIMIT:
                await self._strike(
                    player,
                    f"{game_name}位置回報超速 {speed:.1f} 單位/秒 > {SPEED_LIMIT:.0f}，忽略",
                )
                return False
        player.x, player.y, player.z, player.yaw = cx, cy, cz, yaw
        player.last_pos_ms = now
        return True

    async def _strike(self, player: GamePlayer, reason: str) -> None:
        """記一次違規；累積達門檻 → roster 標 suspect（標記不阻擋）。"""
        player.strikes += 1
        record = player.record
        logger.warning(
            "[防作弊] %s%s %s（strike %d/%d）",
            record.name,
            record.emoji,
            reason,
            player.strikes,
            STRIKE_SUSPECT_LIMIT,
        )
        if player.strikes >= STRIKE_SUSPECT_LIMIT:
            await self.roster.flag_suspect(record, f"賽局位置級違規累積 {player.strikes} 次")
