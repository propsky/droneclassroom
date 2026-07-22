"""測試共用 fixture — 每個測試一個獨立 app（名冊 / 認證 / 限流 / 賽局皆隔離）。"""

import asyncio
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app

TEACHER_PASSWORD = "test123"


class FakeClock:
    """可注入的假時鐘（epoch 毫秒）：賽局測試手動推進時間，不 sleep。"""

    def __init__(self, ms: float = 1_700_000_000_000.0) -> None:
        self.ms = ms

    def __call__(self) -> float:
        return self.ms

    def advance(self, ms: float) -> None:
        self.ms += ms


@pytest.fixture
def client(tmp_path: Path) -> Iterator[TestClient]:
    """TestClient（以 context manager 進出，確保 lifespan 建立 app.state.roster）。

    - static_dir 指向空的暫存目錄，測試不依賴 simulator 是否已 build
    - teacher_dist 指向不存在目錄 → /teacher fallback legacy teacher.html
    - teacher_password 固定 test123（不設定會走隨機 PIN，測試無法登入）
    - levels_dir 用預設（repo 內 apps/simulator/public/levels 三章）
    - game_tick_interval=0：不起賽局主迴圈，賽局測試注入假時鐘、手動 tick
    """
    static_dir = tmp_path / "dist"
    static_dir.mkdir()
    (static_dir / "index.html").write_text("<html>student</html>", encoding="utf-8")
    settings = Settings(
        port=3000,
        static_dir=static_dir,
        teacher_dist=tmp_path / "no-teacher-dist",
        teacher_password=TEACHER_PASSWORD,
        game_tick_interval=0,
    )
    app = create_app(settings)
    with TestClient(app) as c:
        yield c


@pytest.fixture
def teacher_ticket(client: TestClient) -> str:
    """登入拿一張有效的老師 ticket（連 /teacher WS 用）。"""
    r = client.post("/auth/teacher", json={"password": TEACHER_PASSWORD})
    assert r.status_code == 200
    return r.json()["ticket"]


@pytest.fixture
def clock(client: TestClient) -> FakeClock:
    """把 arena / soccer 換成同一顆假時鐘（epoch 毫秒），賽局測試手動推進。"""
    c = FakeClock()
    client.app.state.arena.now_ms = c
    client.app.state.soccer.now_ms = c
    return c


def settle(client: TestClient) -> None:
    """讓 event loop 先消化剛送出的 fire-and-forget 訊息（arena_pos 等無回應訊息）。

    對「送出後只改伺服器狀態、不回訊息」的訊息，send 之後、斷言 / tick 之前呼叫，
    確保 handler coroutine 已處理完佇列中的訊息。
    """
    for _ in range(10):
        client.portal.call(asyncio.sleep, 0)


def tick(client: TestClient) -> None:
    """手動推進一輪賽局 tick（在 app 的 event loop 內執行，與 WS handler 同步序）。"""
    settle(client)  # 先消化未處理完的進站訊息，tick 才看得到最新位置
    client.portal.call(client.app.state.arena.tick)
    client.portal.call(client.app.state.soccer.tick)


def recv_until(ws, msg_type: str) -> dict:
    """一直收到指定 type 為止（跳過穿插的排行 / 位置廣播），避免測試對訊息順序過敏。"""
    for _ in range(200):  # 防呆：不讓測試無限阻塞
        msg = ws.receive_json()
        if msg["type"] == msg_type:
            return msg
    raise AssertionError(f"200 則內沒收到 {msg_type}")
