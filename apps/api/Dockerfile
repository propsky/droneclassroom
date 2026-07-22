# CREAFLY 後端（FastAPI + uv）
FROM ghcr.io/astral-sh/uv:python3.13-bookworm-slim

WORKDIR /app

# 先裝依賴（利用 layer cache：pyproject/lock 沒變就不重裝）
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

# 再放程式碼與內建靜態頁（/lesson、teacher fallback）
COPY app ./app
COPY static ./static
RUN uv sync --frozen --no-dev

ENV PORT=3000
EXPOSE 3000

CMD ["uv", "run", "creafly-api"]
