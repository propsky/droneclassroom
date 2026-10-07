# CREAFLY 後端（FastAPI + uv）
# build context = repo 根目錄（要打包 apps/simulator/public/levels 的關卡資料），
# 見 .dockerignore 的 context 白名單與 workflow 的 context: .

# ---- 重播驗證器（J-02）：simulator core 打包成單檔，執行期只需 node ----
# 依賴圖只有 core/ + @creafly/shared（零 npm 依賴），只裝 esbuild 不必 pnpm install 整個前端
FROM node:22-bookworm-slim AS replay-verifier
WORKDIR /build
RUN npm install --no-save --no-package-lock --no-audit --no-fund esbuild@0.28.1
COPY tsconfig.base.json ./
COPY packages/shared/src ./packages/shared/src
COPY apps/simulator/tsconfig.json ./apps/simulator/tsconfig.json
COPY apps/simulator/src ./apps/simulator/src
COPY apps/simulator/scripts ./apps/simulator/scripts
RUN node apps/simulator/scripts/build-replay-verifier.mjs /build/out/verify-recording.mjs

# ---- 執行期 ----
FROM ghcr.io/astral-sh/uv:python3.13-bookworm-slim

WORKDIR /app

# node 執行檔動態連結 libstdc++ / libgcc（python slim 不保證內建）
RUN apt-get update \
    && apt-get install -y --no-install-recommends libstdc++6 libgcc-s1 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=replay-verifier /usr/local/bin/node /usr/local/bin/node
COPY --from=replay-verifier /build/out/verify-recording.mjs /app/replay/verify-recording.mjs
ENV REPLAY_VERIFIER_BUNDLE=/app/replay/verify-recording.mjs

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
