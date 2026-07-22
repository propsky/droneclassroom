"""rest.py — REST 端點，對齊 packages/shared/src/rest.ts。

- POST /auth/teacher：教師登入（密碼 → HMAC ticket），含 Origin 檢查與登入限流
- GET  /api/levels：三章關卡清單（老師後台下拉選單 / 廣播用），啟動時載入一次快取
- GET  /api/info：教室現場資訊（LAN IP / port / 人數上限 / 版本）
"""

import contextlib
import ipaddress
import json
import logging
import socket
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from .auth import TeacherAuth, origin_allowed
from .config import Settings

logger = logging.getLogger("creafly.api.rest")

API_VERSION = "2.0.0"

router = APIRouter()


# ---------- 回應模型（欄位名對齊 rest.ts，camelCase）----------


class TeacherLoginRequest(BaseModel):
    """POST /auth/teacher 請求。"""

    password: str


class TeacherLoginResponse(BaseModel):
    """POST /auth/teacher 回應（401 時無 body）。"""

    ticket: str
    expiresIn: int  # noqa: N815 — 線上格式沿用 camelCase


class LevelBrief(BaseModel):
    """關卡清單項目（只帶後台需要的 id / name，不含 rings 等場景資料）。"""

    id: str
    name: str


class ChapterLevels(BaseModel):
    """一章的關卡清單。"""

    chapter: int
    name: str
    levels: list[LevelBrief]


class LevelsResponse(BaseModel):
    """GET /api/levels 回應。"""

    chapters: list[ChapterLevels]


class InfoResponse(BaseModel):
    """GET /api/info 回應。"""

    lanAddresses: list[str]  # noqa: N815
    port: int
    maxStudents: int  # noqa: N815
    version: str


# ---------- 關卡載入（啟動時一次，關卡是靜態資料、改檔重啟即可）----------


def load_levels(levels_dir: Path) -> LevelsResponse:
    """讀 levels_dir 下所有 chapter*.json → LevelsResponse。

    單一檔案格式錯誤只略過並 log，不讓整個伺服器起不來。
    """
    chapters: list[ChapterLevels] = []
    for path in sorted(levels_dir.glob("chapter*.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            chapters.append(
                ChapterLevels(
                    chapter=data["chapter"],
                    name=data["name"],
                    levels=[
                        LevelBrief(id=lvl["id"], name=lvl["name"]) for lvl in data["levels"]
                    ],
                )
            )
        except (OSError, ValueError, KeyError, TypeError):
            logger.warning("[REST] 關卡檔格式錯誤，略過：%s", path)
    if not chapters:
        logger.warning("[REST] %s 下找不到任何 chapter*.json，/api/levels 將回空清單", levels_dir)
    chapters.sort(key=lambda c: c.chapter)
    return LevelsResponse(chapters=chapters)


def known_level_ids(levels: LevelsResponse) -> frozenset[str]:
    """所有已知關卡 id（防作弊：complete_level 帶未知 levelId → suspect）。"""
    return frozenset(lvl.id for ch in levels.chapters for lvl in ch.levels)


# ---------- LAN 位址（老師投影給學生抄的網址）----------


def lan_addresses() -> list[str]:
    """列出本機私有網段 IPv4；任何一步失敗都吞掉、最壞回空陣列不 crash。"""
    candidates: set[str] = set()
    with contextlib.suppress(OSError):
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            candidates.add(info[4][0])
    with contextlib.suppress(OSError):
        # UDP connect 不會真的發包，只為了取得預設路由介面的本機位址
        probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            probe.connect(("8.8.8.8", 80))
            candidates.add(probe.getsockname()[0])
        finally:
            probe.close()
    result: list[str] = []
    for addr in candidates:
        with contextlib.suppress(ValueError):
            ip = ipaddress.ip_address(addr)
            if ip.is_private and not ip.is_loopback and not ip.is_link_local:
                result.append(addr)
    return sorted(result)


# ---------- 端點 ----------


@router.post("/auth/teacher")
async def teacher_login(request: Request, body: TeacherLoginRequest) -> TeacherLoginResponse:
    """教師登入：Origin 檢查 → 同 IP 限流 → 密碼比對 → 發 ticket。"""
    settings: Settings = request.app.state.settings
    auth: TeacherAuth = request.app.state.auth
    if not origin_allowed(
        request.headers.get("origin"), request.headers.get("host"), settings.allowed_origins_set
    ):
        raise HTTPException(status_code=403, detail="Origin 不在白名單")
    ip = request.client.host if request.client else "?"
    if not auth.allow_login_attempt(ip):
        logger.warning("[AUTH] 登入嘗試過於頻繁，暫時封鎖（IP：%s）", ip)
        raise HTTPException(status_code=429, detail="登入嘗試過於頻繁，請一分鐘後再試")
    if not auth.check_password(body.password):
        logger.info("[AUTH] 教師登入失敗：密碼錯誤（IP：%s）", ip)
        raise HTTPException(status_code=401, detail="密碼錯誤")
    logger.info("[AUTH] 教師登入成功（IP：%s）", ip)
    return TeacherLoginResponse(ticket=auth.issue_ticket(), expiresIn=auth.ttl)


@router.get("/api/levels")
async def get_levels(request: Request) -> LevelsResponse:
    """三章關卡清單（啟動時載入的快取）。"""
    levels: LevelsResponse = request.app.state.levels
    return levels


@router.get("/api/info")
async def get_info(request: Request) -> InfoResponse:
    """教室現場資訊：LAN IP / port / 學生人數上限 / 版本。"""
    settings: Settings = request.app.state.settings
    return InfoResponse(
        lanAddresses=lan_addresses(),
        port=settings.port,
        maxStudents=settings.max_students,
        version=API_VERSION,
    )
