# CREAFLY 架構說明（重構版）

> 本次重構的**現況架構文件**（怎麼跑、放哪裡、規則是什麼）。
> 重寫的「為什麼」與階段規劃見 [rewrite-plan.md](rewrite-plan.md)。
> 舊版說明見根目錄 README.md（描述的是 `legacy/`）。

## 快速開始

```bash
pnpm install        # JS workspace 依賴
pnpm dev            # 前端 :5173（Vite）+ 後端 :3000（WS）
pnpm typecheck      # 全 workspace 型別檢查
pnpm build          # 產出 apps/simulator/dist（零 CDN 依賴，可離線）
pnpm legacy         # 跑舊版（node legacy/server.js，:3000）
```

VSCode 直接按 **F5**（「🚁 F5 全端啟動」）：後端 + 前端 + Chrome 一鍵起，前後端皆可下中斷點。

- 學生端：`http://localhost:5173/`（dev）；生產由後端 :3000 供 dist
- 老師後台：`http://localhost:3000/teacher`
- 開發後門：`?autologin=1` 跳過登入 modal（headless 驗證用）

## Monorepo 佈局

```
droneclassroom/
├── apps/
│   ├── simulator/        # @creafly/simulator — 學生端（Babylon.js 8 + Vite + TS）
│   │   └── src/
│   │       ├── core/     # ★ 框架無關純 TS：不 import Babylon、不碰 DOM
│   │       │   ├── droneState.ts   # 狀態單一真相來源（手感常數）
│   │       │   ├── physics.ts      # 60Hz 固定時步物理
│   │       │   ├── level.ts        # 關卡載入 + 判定
│   │       │   ├── program.ts      # cf_* Action API + 程式執行器
│   │       │   └── events.ts       # 型別化 event bus（核心 → 訂閱者）
│   │       ├── render/   # Babylon 渲染層（訂閱 core）
│   │       ├── input/    # 鍵盤 / nipplejs / Gamepad 三路疊加
│   │       ├── blockly/  # 積木定義 + toolbox（v11 npm 包、media 本地化）
│   │       ├── net/      # WS client（協定相容 legacy、退避重連）
│   │       └── ui/       # HUD / overlay（純 TS + DOM，UI 框架刻意延後定案）
│   └── api/              # @creafly/api — FastAPI 後端（Python + uv）
├── packages/
│   └── shared/           # @creafly/shared — 關卡 schema / WS 協定型別 / 純函數（零依賴）
├── legacy/               # 舊版 Three.js 單檔版，完整可跑，效果對齊基準
└── docs/
    ├── rewrite-plan.md   # 重寫計畫與 Phase 1–4 里程碑
    └── architecture.md    # 本文件
```

## 架構規則

1. **`core/` 是框架無關純 TS**：擁有 droneState、物理、關卡邏輯、cf_* API；對外只透過 event bus。render（Babylon）與 ui（DOM）是訂閱者。之後上 React/Vue 只重寫 `ui/`。
2. **物理是 60Hz 固定時步**（accumulator + 渲染插值）。手感常數（THRUST=0.012 / LIFT=0.015 / DRAG=0.92）是 per-tick 值、刻意與 legacy per-frame 相同。**絕不把模擬綁到 rAF 幀率。**
3. **座標慣例**：Babylon 開 `useRightHandedSystem`；機頭 -Z、yaw 正向 = 左轉。關卡 JSON 與 legacy 共用、**永不重標座標**。
4. **cf_* API 是契約**：Blockly 生成碼經 `new Function('CREAFLY', …)` 注入執行（絕不 eval）。新積木 = `core/program.ts` 加一個 cf_* 函式。
5. **關卡是資料**：`apps/simulator/public/levels/chapter*.json`（型別在 `@creafly/shared`）。改任務只改 JSON。
6. **WS 協定**型別化於 `packages/shared/src/protocol.ts`，與 legacy 線上格式相容（過渡期新舊 client 可混連）；伺服器端對所有進站訊息做驗證。
7. **套件隔離**：pnpm 嚴格 node_modules——前端依賴只在 simulator、後端依賴只在各自 app；`@creafly/shared` 永遠零 runtime 依賴。Python 側用 uv 管理（`apps/api`），與 pnpm 互不干涉。

## 後端

- **`apps/api`（FastAPI）是唯一後端**：Pydantic 驗證進站訊息、in-memory 名冊（**目前無資料庫，刻意的**——帳號/成績持久化需求出現時才引入 PostgreSQL，見 rewrite-plan Phase 4）。多人賽局（大亂鬥/足球）Phase 2 直接在此實作。
- :3000 同 port 供 HTTP 靜態 + WS。過渡期的 Node 版後端（`apps/server`）已於 2026-07-15 移除（歷史見 git log），legacy 版行為參照 `legacy/server.js`。

### 安全與防作弊（2026-07-15 起）

- **老師認證＝短效 ticket**：後台輸入 PIN → `POST /auth/teacher`（同 IP 5 次/分限流）→ HMAC 簽名 ticket（TTL 預設 4h，secret 每次啟動隨機）→ WS `/teacher?ticket=` 驗證，無效 close 4401。`TEACHER_PASSWORD` 未設定時啟動隨機產生 6 位 PIN 印在 console。**「改網址就是老師」的洞已修除。**
- **Origin 白名單**：WS 升級與登入端點檢查 Origin（無 Origin 的非瀏覽器工具放行；同 host / localhost / 私有網段預設放行——教室 LAN 場景刻意的；`ALLOWED_ORIGINS` 可加白），拒絕 close 4403 / HTTP 403。
- **防作弊＝標記不阻擋**：`complete_level` 對照伺服器觀察的關卡經過時間，離譜（宣稱用時 < 觀察一半、<1s、沒 progress 就交、未知關卡）→ 該生標 `suspect`，老師端顯示 ⚠️；標記跟著名字走，重整頁面/同名重連不洗白。位置級驗證（限速/邊界）留給 Phase 2c 多人在 `games/` 做。
- 學生端刻意不設帳密（國小教室場景）；正式競賽的帳號/RBAC 見 rewrite-plan Phase 4。

### 教師後台（`apps/teacher`）

Vite + TS（無框架，同 simulator 慣例），dev :5174、生產由 api 以 `/teacher` 供檔（assets 掛 `/teacher-assets/`，`TEACHER_DIST` 設定）。相對 legacy 修掉三個 bug：關卡下拉三章全列（`GET /api/levels`）、顯示真 LAN 位址（`GET /api/info`，不再打 api.ipify.org）、人數上限來自 `MAX_STUDENTS` 設定。大亂鬥/足球分頁版面已備、待 2c 啟用。

## 工作慣例

- 所有 UI 文字、註解、commit 訊息用繁體中文（zh-Hant）。
- 無單元測試框架的部分以 headless Chrome 截圖驗證（macOS 需 `--use-angle=swiftshader --enable-unsafe-swiftshader`）；`core/` 為純 TS 可直接 Node 跑行為測試；`apps/api` 用 pytest。
- 實作「缺少的功能」前先查 rewrite-plan §4 的 Phase 清單——很多是刻意延後，不是遺漏。
