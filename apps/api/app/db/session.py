"""session.py — async engine / sessionmaker 與 FastAPI dependency。

engine 由 main.py lifespan 建立、掛在 app.state.db_engine / app.state.db_sessionmaker，
關閉時 dispose。未設定 DATABASE_URL 時兩者皆為 None，get_session 回 503。
"""

from collections.abc import AsyncIterator

from fastapi import HTTPException, Request
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)


def create_engine(database_url: str) -> AsyncEngine:
    """建 async engine。pool 設定保守：教室一台伺服器、RDS 與其他服務共用實例，不搶連線；
    pool_pre_ping 擋掉 RDS 閒置斷線後拿到死連線的問題。
    """
    return create_async_engine(
        database_url,
        pool_size=5,
        max_overflow=5,
        pool_pre_ping=True,
    )


def create_sessionmaker(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    """expire_on_commit=False：commit 後仍可讀取物件屬性，不會在 async 環境觸發隱式 lazy load。"""
    return async_sessionmaker(engine, expire_on_commit=False)


async def get_session(request: Request) -> AsyncIterator[AsyncSession]:
    """FastAPI dependency：每個請求一個 AsyncSession；資料庫未啟用時回 503。

    用法：`session: AsyncSession = Depends(get_session)`。交易由端點自行 commit；
    離開時 session 關閉（未 commit 的變更 rollback）。
    """
    maker: async_sessionmaker[AsyncSession] | None = getattr(
        request.app.state, "db_sessionmaker", None
    )
    if maker is None:
        raise HTTPException(status_code=503, detail="資料庫未啟用")
    async with maker() as session:
        yield session
