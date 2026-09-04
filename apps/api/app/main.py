"""main.py — FastAPI 應用組裝與啟動入口。

HTTP 與 WS 共用同一個 port（Railway 等 PaaS 只對外開一個 port）。
路由順序：WS / REST / 特定路由（/teacher）先註冊、StaticFiles 掛 / 最後。
"""

import asyncio
import contextlib
import logging
import re
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from .auth import TeacherAuth, generate_pin
from .config import Settings
from .db.session import create_engine, create_sessionmaker
from .levels_api import router as levels_router
from .levels_catalog import ensure_all_teams_catalog, ensure_system_levels, fetch_known_level_ids
from .mailer import Mailer
from .rest import known_level_ids, load_levels
from .rest import router as rest_router
from .rooms import RoomManager
from .static import no_store_middleware, register_static_routes
from .students_api import router as students_router
from .ws import register_ws_routes

logger = logging.getLogger("creafly.api")


async def _game_tick_loop(app: FastAPI, interval: float) -> None:
    """賽局主迴圈：固定週期推進所有房間的 arena / soccer（legacy setInterval 80ms 的對應），
    順帶檢查閒置房自動關閉（RoomManager.tick）。

    tick 內任何例外只 log 不讓 task 死掉 —— 一場賽局出錯不能拖垮整堂課。
    """
    while True:
        await asyncio.sleep(interval)
        try:
            await app.state.rooms.tick()
        except Exception:  # noqa: BLE001 — 見 docstring
            logger.exception("[Games] tick 發生例外，略過本輪")


def create_app(settings: Settings | None = None) -> FastAPI:
    """組裝 FastAPI app；settings 可注入（測試用），預設讀環境變數。"""
    cfg = settings or Settings()

    # 教師 PIN（只在無資料庫模式使用，有 DATABASE_URL 時走 /auth/teacher/login 帳號登入）：
    # TEACHER_PASSWORD 未設定 → 啟動隨機產生 6 位數 PIN（lifespan 印出）；
    # TEACHER_AUTH_DISABLED=1 → 免登入模式（測試用），不產 PIN、密碼檢查全放行
    generated_pin = (
        generate_pin()
        if not cfg.teacher_password and not cfg.teacher_auth_disabled and not cfg.database_url
        else None
    )
    auth = TeacherAuth(
        password=cfg.teacher_password or generated_pin or "",
        ttl=cfg.ticket_ttl,
        disabled=cfg.teacher_auth_disabled,
    )

    # 關卡清單啟動時載入一次（/api/levels 快取 + 防作弊已知關卡清單）
    levels = load_levels(cfg.levels_dir)
    json_known = known_level_ids(levels)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        known = json_known
        # 資料庫（選配）：有 DATABASE_URL 才建 engine；連不上只 log 不擋啟動
        # （教室現場沒網路也要能上課；/api/health 的 db 欄位會反映 error）
        if cfg.database_url:
            app.state.db_engine = create_engine(cfg.database_url)
            app.state.db_sessionmaker = create_sessionmaker(app.state.db_engine)
            try:
                async with app.state.db_engine.connect() as conn:
                    await conn.execute(text("SELECT 1"))
                logger.info("資料庫已連線")
                async with app.state.db_sessionmaker() as session:
                    n = await ensure_system_levels(session, cfg.levels_dir)
                    if n:
                        logger.info("官方關卡已同步至 levels 表（%d 筆）", n)
                    known = await fetch_known_level_ids(session, json_known)
                await ensure_all_teams_catalog(app.state.db_sessionmaker)
            except Exception:  # noqa: BLE001 — 見上方註解
                logger.exception("資料庫連線失敗（伺服器照常啟動，資料庫功能暫不可用）")
        else:
            logger.info("未設定 DATABASE_URL，以無資料庫模式啟動")
        app.state.known_levels = known
        # 所有可變狀態封裝在 app.state（測試隔離：每個 create_app 一份房間管理器）。
        # 房間模型見 rooms.py：每房一份名冊 + 賽局；預設房啟動即存在（不帶房間碼 = 舊流程）；
        # 有 DB 時老師開的房持久化為班級（teams 表），故把 sessionmaker 注入。
        # 足球場地尺寸資料驅動（環境變數 SOCCER_HALF_X … 可調，見 config.py）
        app.state.rooms = RoomManager(
            cfg, known_levels=known, db=app.state.db_sessionmaker
        )
        # 向後相容別名 = 預設房的名冊 / 賽局（既有測試與單房部署直接用）
        app.state.roster = app.state.rooms.default.roster
        app.state.arena = app.state.rooms.default.arena
        app.state.soccer = app.state.rooms.default.soccer
        # 賽局主迴圈（interval=0 → 不啟動，測試手動 tick）
        ticker: asyncio.Task[None] | None = None
        if cfg.game_tick_interval > 0:
            ticker = asyncio.create_task(_game_tick_loop(app, cfg.game_tick_interval))
        logger.info("CREAFLY Drone Simulator running at http://localhost:%d/", cfg.port)
        logger.info("老師後台：http://localhost:%d/teacher", cfg.port)
        logger.info(
            "WebSocket 與 HTTP 共用 port %d（path: / 或 /ws 學生、/teacher 老師）", cfg.port
        )
        if cfg.teacher_auth_disabled:
            logger.warning(
                "⚠️ 教師後台免登入模式（TEACHER_AUTH_DISABLED=1）— 僅供測試，正式環境請關閉"
                + ("；任意帳密皆登入預設老師 dev@local" if cfg.database_url else "")
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
        if app.state.db_engine is not None:
            await app.state.db_engine.dispose()

    app = FastAPI(title="CREAFLY Classroom API", lifespan=lifespan, openapi_url=None)
    app.state.settings = cfg
    app.state.mailer = Mailer(cfg)
    app.state.auth = auth
    app.state.levels = levels
    app.state.known_levels = json_known
    # 資料庫 engine / sessionmaker：lifespan 內依 database_url 建立；None = 無資料庫模式
    app.state.db_engine = None
    app.state.db_sessionmaker = None

    app.middleware("http")(no_store_middleware)

    # CORS：前後分離部署（前端在 Pages、後端在此）時，瀏覽器的 REST 請求需要
    # 跨網域許可。白名單來源與 WS Origin 檢查同一份 ALLOWED_ORIGINS 設定：
    # 明確項目進 allow_origins（hostname 自動補 https/http 兩種），
    # `*.網域` 萬用項目編成 allow_origin_regex（Pages preview 部署用）。
    allow_origins: list[str] = []
    wildcard_patterns: list[str] = []
    for entry in cfg.allowed_origins_set:
        if entry.startswith("*."):
            wildcard_patterns.append(r"https?://.+\." + re.escape(entry[2:]))
        elif "://" in entry:
            allow_origins.append(entry)
        else:
            allow_origins.extend([f"https://{entry}", f"http://{entry}"])
    if allow_origins or wildcard_patterns:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=allow_origins,
            allow_origin_regex="|".join(wildcard_patterns) or None,
            # DELETE：移除學生；authorization：Bearer session token（老師 / 學生端點）
            allow_methods=["GET", "POST", "PATCH", "DELETE"],
            allow_headers=["content-type", "authorization"],
        )

    register_ws_routes(app)
    app.include_router(rest_router)
    app.include_router(levels_router)
    app.include_router(students_router)
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
