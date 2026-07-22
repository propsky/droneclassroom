"""static.py — 靜態檔案伺服（no-store）。

- 生產：優先服務 apps/simulator/dist（存在時，StaticFiles 掛在 / 最後面）
- GET /teacher → static/teacher.html（legacy 原樣複製，Phase 2 再重寫）
- path traversal：StaticFiles 本身已做正規化防護；/teacher 為固定檔案路徑
- 教室現場改檔即刷新：所有回應一律 no-store（由 middleware 統一加 headers）
"""

import logging
from collections.abc import Awaitable, Callable

from fastapi import FastAPI, Request, Response
from fastapi.responses import FileResponse, PlainTextResponse
from starlette.staticfiles import StaticFiles

from .config import Settings

logger = logging.getLogger("creafly.api.static")

# 教室現場改檔即刷新：一律不快取（沿用 legacy）
NO_STORE_HEADERS = {
    "Cache-Control": "no-store, no-cache, must-revalidate",
    "Pragma": "no-cache",
    "Expires": "0",
}


async def no_store_middleware(
    request: Request, call_next: Callable[[Request], Awaitable[Response]]
) -> Response:
    """所有 HTTP 回應（含 StaticFiles 與 404）統一加 no-store headers。"""
    response = await call_next(request)
    response.headers.update(NO_STORE_HEADERS)
    return response


def register_static_routes(app: FastAPI, settings: Settings) -> None:
    """註冊靜態路由。順序重要：/teacher 在前、StaticFiles 掛 / 最後。"""

    # 新版老師後台（apps/teacher vite build）：目錄存在時 /teacher 服務其 index.html，
    # assets 掛 /teacher-assets（vite base 設 /teacher-assets/，由 apps/teacher 配合）；
    # 不存在時 fallback legacy teacher.html（過渡期）
    teacher_index = settings.teacher_dist / "index.html"
    use_teacher_dist = settings.teacher_dist.is_dir()
    if use_teacher_dist:
        app.mount(
            "/teacher-assets",
            StaticFiles(directory=settings.teacher_dist),
            name="teacher-assets",
        )
    else:
        logger.info("[HTTP] 找不到 %s，/teacher 使用 legacy teacher.html", settings.teacher_dist)

    @app.get("/teacher", include_in_schema=False)
    @app.get("/teacher/", include_in_schema=False)
    async def teacher_page() -> Response:
        """老師後台：新版 dist 優先，否則 legacy teacher.html（皆為固定路徑，無 traversal）。"""
        if use_teacher_dist and teacher_index.is_file():
            return FileResponse(teacher_index, media_type="text/html; charset=utf-8")
        if not settings.teacher_html.is_file():
            return PlainTextResponse("404 Not Found: /teacher", status_code=404)
        return FileResponse(settings.teacher_html, media_type="text/html; charset=utf-8")

    # /lesson 教案投影頁（legacy 原樣搬入：自足靜態頁 + 通關碼閘門，Phase 3 再議重寫）
    lesson_html = settings.teacher_html.parent / "lesson.html"
    lessons_data = settings.teacher_html.parent / "lessons-data.js"

    @app.get("/lesson", include_in_schema=False)
    @app.get("/lesson/", include_in_schema=False)
    async def lesson_page() -> Response:
        """老師教案投影頁（固定路徑，無 traversal）。"""
        if not lesson_html.is_file():
            return PlainTextResponse("404 Not Found: /lesson", status_code=404)
        return FileResponse(lesson_html, media_type="text/html; charset=utf-8")

    @app.get("/lessons-data.js", include_in_schema=False)
    async def lessons_data_js() -> Response:
        """lesson.html 引用的教案資料（固定路徑）。"""
        if not lessons_data.is_file():
            return PlainTextResponse("404 Not Found", status_code=404)
        return FileResponse(lessons_data, media_type="text/javascript; charset=utf-8")

    if settings.static_dir.is_dir():
        # 生產：simulator 已 build → 以 dist 為根服務學生端
        app.mount("/", StaticFiles(directory=settings.static_dir, html=True), name="static")
    else:
        logger.info("[HTTP] 找不到 %s，僅服務 /teacher 與 WebSocket", settings.static_dir)

        @app.get("/", include_in_schema=False)
        async def dev_hint() -> Response:
            """開發模式提示：學生端由 Vite dev server 服務。"""
            return PlainTextResponse(
                "404 Not Found: 開發模式請由 Vite dev server 開啟學生端（apps/simulator），"
                "本伺服器提供 /teacher 與 WebSocket",
                status_code=404,
            )
