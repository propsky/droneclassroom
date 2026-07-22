"""main.py — FastAPI 應用組裝與啟動入口。

HTTP 與 WS 共用同一個 port（Railway 等 PaaS 只對外開一個 port）。
路由順序：WS / REST / 特定路由（/teacher）先註冊、StaticFiles 掛 / 最後。
"""

import asyncio
import contextlib
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI

from .auth import TeacherAuth, generate_pin
from .config import Settings
from .games import ArenaGame, SoccerField, SoccerGame
from .rest import known_level_ids, load_levels
from .rest import router as rest_router
from .roster import Roster
from .static import no_store_middleware, register_static_routes
from .ws import register_ws_routes

logger = logging.getLogger("creafly.api")


async def _game_tick_loop(app: FastAPI, interval: float) -> None:
    """賽局主迴圈：固定週期推進 arena / soccer（legacy setInterval 80ms 的對應）。

    tick 內任何例外只 log 不讓 task 死掉 —— 一場賽局出錯不能拖垮整堂課。
    """
    while True:
        await asyncio.sleep(interval)
        try:
            await app.state.arena.tick()
            await app.state.soccer.tick()
        except Exception:  # noqa: BLE001 — 見 docstring
            logger.exception("[Games] tick 發生例外，略過本輪")


def create_app(settings: Settings | None = None) -> FastAPI:
    """組裝 FastAPI app；settings 可注入（測試用），預設讀環境變數。"""
    cfg = settings or Settings()

    # 教師密碼：TEACHER_PASSWORD 未設定 → 啟動隨機產生 6 位數 PIN（lifespan 印出）
    generated_pin = generate_pin() if not cfg.teacher_password else None
    auth = TeacherAuth(password=cfg.teacher_password or generated_pin, ttl=cfg.ticket_ttl)

    # 關卡清單啟動時載入一次（/api/levels 快取 + 防作弊已知關卡清單）
    levels = load_levels(cfg.levels_dir)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        # 所有可變狀態封裝在 app.state（測試隔離：每個 create_app 一份名冊 / 賽局）
        app.state.roster = Roster(known_levels=known_level_ids(levels))
        app.state.arena = ArenaGame(app.state.roster)
        # 足球場地尺寸資料驅動（環境變數 SOCCER_HALF_X … 可調，見 config.py）
        app.state.soccer = SoccerGame(app.state.roster, field=SoccerField.from_settings(cfg))
        # 賽局主迴圈（interval=0 → 不啟動，測試手動 tick）
        ticker: asyncio.Task[None] | None = None
        if cfg.game_tick_interval > 0:
            ticker = asyncio.create_task(_game_tick_loop(app, cfg.game_tick_interval))
        logger.info("CREAFLY Drone Simulator running at http://localhost:%d/", cfg.port)
        logger.info("老師後台：http://localhost:%d/teacher", cfg.port)
        logger.info(
            "WebSocket 與 HTTP 共用 port %d（path: / 或 /ws 學生、/teacher 老師）", cfg.port
        )
        if generated_pin:
            logger.warning("=" * 50)
            logger.warning("🔑 教師後台 PIN：%s", generated_pin)
            logger.warning("（TEACHER_PASSWORD 未設定，本次啟動隨機產生，重啟會換一組）")
            logger.warning("=" * 50)
        yield
        if ticker is not None:
            ticker.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await ticker

    app = FastAPI(title="CREAFLY Classroom API", lifespan=lifespan, openapi_url=None)
    app.state.settings = cfg
    app.state.auth = auth
    app.state.levels = levels

    app.middleware("http")(no_store_middleware)
    register_ws_routes(app)
    app.include_router(rest_router)
    register_static_routes(app, cfg)
    return app


app = create_app()


def run() -> None:
    """`uv run creafly-api` — 啟動伺服器（PORT 環境變數可覆寫，預設 3000）。"""
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    cfg = Settings()
    uvicorn.run("app.main:app", host="0.0.0.0", port=cfg.port)


if __name__ == "__main__":
    run()
