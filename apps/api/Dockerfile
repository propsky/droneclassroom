# CREAFLY 後端（FastAPI + uv）
# build context = repo 根目錄（要打包 apps/simulator/public/levels 的關卡資料），
# 見 .dockerignore 的 context 白名單與 workflow 的 context: .
FROM ghcr.io/astral-sh/uv:python3.13-bookworm-slim

WORKDIR /app

# 先裝依賴（利用 layer cache：pyproject/lock 沒變就不重裝）
COPY apps/api/pyproject.toml apps/api/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

# 程式碼、內建靜態頁（/lesson、teacher fallback）、關卡資料、資料庫 migration
COPY apps/api/app ./app
COPY apps/api/static ./static
COPY apps/api/alembic.ini ./alembic.ini
COPY apps/api/alembic ./alembic
COPY apps/simulator/public/levels ./levels
RUN uv sync --frozen --no-dev

ENV PORT=3000
# 關卡資料位置（/api/levels 與防作弊「已知關卡」皆讀此處）
ENV LEVELS_DIR=/app/levels
EXPOSE 3000

# 資料庫 migration 不在啟動時自動跑：部署時另外執行
#   docker run --rm --env-file creafly.env <image> uv run creafly-migrate
CMD ["uv", "run", "creafly-api"]
