"""真實 PostgreSQL 測試的連線來源。

刻意只讀環境變數 TEST_DATABASE_URL，不讀 apps/api/.env 的 DATABASE_URL：
.env 通常指向開發 / 正式 RDS，`pnpm test` 不該默默對它建立與清除測試資料，
連不上時也不該讓整套測試卡住。要跑 DB 測試請指向專用測試庫：

    TEST_DATABASE_URL=postgresql+asyncpg://… uv run pytest
"""

import os

TEST_DATABASE_URL: str | None = os.environ.get("TEST_DATABASE_URL") or None
