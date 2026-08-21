"""Alembic 環境：async engine（asyncpg），連線字串取自 Settings.database_url。

target_metadata = Base.metadata（app/db/models.py 七張表）。
autogenerate 會漏表達式索引 / 部分索引 / CHECK 內容比對，新增 migration 後務必人工檢視。
"""

import asyncio
from logging.config import fileConfig

from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import create_async_engine

from alembic import context
from app.config import Settings
from app.db import models  # noqa: F401 — 匯入讓所有 model 註冊到 Base.metadata
from app.db.base import Base

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def _database_url() -> str:
    """環境變數 DATABASE_URL 或 apps/api/.env；沒設就直接報錯，不讓 migration 默默跑到錯的庫。"""
    url = Settings().database_url
    if not url:
        raise RuntimeError("未設定 DATABASE_URL，無法執行 migration（環境變數或 apps/api/.env）")
    return url


def run_migrations_offline() -> None:
    """離線模式：只輸出 SQL 不連線（`alembic upgrade head --sql`）。"""
    context.configure(
        url=_database_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        # 比對 server_default，讓 DEFAULT 變動也能被 autogenerate 察覺
        compare_server_default=True,
    )
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    # 不走 alembic.ini 的 sqlalchemy.url（configparser 會把 % 當插值），直接建 engine
    connectable = create_async_engine(_database_url(), poolclass=pool.NullPool)
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await connectable.dispose()


def run_migrations_online() -> None:
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
