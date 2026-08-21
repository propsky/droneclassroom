"""app.db — 資料庫層（SQLAlchemy 2 async + asyncpg + Alembic）。

規格：docs/db-schema.md。只在 Settings.database_url 有值時啟用；
未設定時 app 以無資料庫模式運作，本套件不會被 lifespan 觸碰。

- base.py：DeclarativeBase + 約束命名慣例
- models.py：七張表（organizations / teachers / teams / students / progress / sessions /
  audit_events）
- session.py：engine / sessionmaker 建立與 FastAPI dependency
- audit.py：稽核事件 append-only 寫入
- cli.py：`uv run creafly-migrate`（Alembic 薄殼）
"""
