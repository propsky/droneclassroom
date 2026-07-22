"""games — 多人賽局（arena 大亂鬥 / soccer 無人機足球），伺服器權威。

Phase 2 完成：legacy server.js 的賽局邏輯移植為 GameHandler 實作，
狀態各自封裝在 handler 實例（掛 app.state.arena / app.state.soccer），
無模組級全域可變狀態。

接法（見 ws.py / main.py）：
- ws.py 依訊息型別把已通過 Pydantic 驗證的 arena_* / soccer_* 分派給對應 handler
- 學生斷線時呼叫 drop()（斷線清理：移除玩家、前鋒遞補、更新排行）
- main.py lifespan 起一個 asyncio task，每 GAME_TICK 秒呼叫 tick()
  推進賽局（倒數、氣球重生、tag 碰撞、判勝、全量位置廣播）
- 測試把 now_ms / rng 換成假時鐘 / 固定種子並手動呼叫 tick()，不用 sleep
"""

from typing import Protocol

from fastapi import WebSocket

from ..roster import StudentRecord
from .arena import ArenaGame
from .base import BaseGame
from .soccer import SoccerField, SoccerGame

__all__ = ["ArenaGame", "BaseGame", "GameHandler", "SoccerField", "SoccerGame"]


class GameHandler(Protocol):
    """賽局處理器共同介面（ArenaGame / SoccerGame 皆符合）。"""

    async def join(self, record: StudentRecord) -> None:
        """學生加入賽局。"""
        ...

    async def leave(self, record: StudentRecord) -> None:
        """學生主動離開（進度 / 分隊等賽局內狀態依各賽局規則保留）。"""
        ...

    async def drop(self, record: StudentRecord) -> None:
        """學生斷線清理（整筆移除）。"""
        ...

    async def send_snapshot_to(self, ws: WebSocket) -> None:
        """回一份完整快照（老師 *_state_req）。"""
        ...

    async def tick(self) -> None:
        """推進賽局狀態（倒數、碰撞判定、計分廣播）。時間來源為 handler 的 now_ms。"""
        ...
