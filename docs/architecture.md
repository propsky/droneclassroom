# CREAFLY 架構說明（重構版）

> 本次重構的**現況架構文件**（怎麼跑、放哪裡、規則是什麼）。
> 重寫的「為什麼」與階段規劃見 [rewrite-plan.md](rewrite-plan.md)。
> 舊版說明見根目錄 README.md（描述的是 `legacy/`）。

## 快速開始

```bash
pnpm install        # JS workspace 依賴
pnpm dev            # 學生端 :5173 + 老師後台 :5174（Vite）+ 後端 :3000（REST + WS）
pnpm typecheck      # 全 workspace 型別檢查（TS + ruff）
pnpm test           # Vitest（shared / simulator / teacher）+ pytest（api）
pnpm test:e2e       # Playwright 跨瀏覽器 smoke
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
│   │       ├── net/      # WS client（協定相容 legacy、退避重連）、帳號 / 進度 / 錄製上傳
│   │       ├── multiplayer/ soccer/  # 大亂鬥 / 足球（多人 + 單人練習）
│   │       └── ui/       # HUD / overlay（純 TS + DOM，UI 框架刻意延後定案）
│   ├── teacher/          # @creafly/teacher — 老師後台 + 關卡編輯器（Vite + TS，無框架）
│   └── api/              # @creafly/api — FastAPI 後端（Python + uv；PostgreSQL 選配）
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

- **`apps/api`（FastAPI）是唯一後端**：Pydantic 驗證進站訊息；名冊 / 房間 / 賽局在記憶體。**PostgreSQL（SQLAlchemy 2 + Alembic）為選配**：設 `DATABASE_URL` 才啟用老師 / 班級 / 學生帳號、進度、關卡目錄與稽核（表結構見 [db-schema.md](db-schema.md)，migration 以 `uv run creafly-migrate` 另行執行）；未設定時以無資料庫模式運作（訪客 / 教室 LAN 照常上課）。多人賽局（大亂鬥/足球）在 `app/games/`。
- :3000 同 port 供 HTTP 靜態 + WS。過渡期的 Node 版後端（`apps/server`）已於 2026-07-15 移除（歷史見 git log），legacy 版行為參照 `legacy/server.js`。

### 安全與防作弊（2026-07-15 起）

- **老師認證＝短效 ticket**：後台輸入 PIN → `POST /auth/teacher`（同 IP 5 次/分限流）→ HMAC 簽名 ticket（TTL 預設 4h，secret 每次啟動隨機）→ WS `/teacher?ticket=` 驗證，無效 close 4401。`TEACHER_PASSWORD` 未設定時啟動隨機產生 6 位 PIN 印在 console。**「改網址就是老師」的洞已修除。**
- **Origin 白名單**：WS 升級與登入端點檢查 Origin（無 Origin 的非瀏覽器工具放行；同 host / localhost / 私有網段預設放行——教室 LAN 場景刻意的；`ALLOWED_ORIGINS` 可加白），拒絕 close 4403 / HTTP 403。
- **防作弊＝標記不阻擋**：`complete_level` 對照伺服器觀察的關卡經過時間，離譜（宣稱用時 < 觀察一半、<1s、沒 progress 就交、未知關卡）→ 該生標 `suspect`，老師端顯示 ⚠️；標記跟著名字走，重整頁面/同名重連不洗白。位置級驗證（限速/邊界）留給 Phase 2c 多人在 `games/` 做。
- 學生端刻意不設帳密（國小教室場景）；正式競賽的帳號/RBAC 見 rewrite-plan Phase 4。

### 過關輸入錄製與伺服器重播驗證（J-01 / J-02）

- **錄製**（帳號學生，`core/inputRecorder.ts`，格式 `@creafly/shared` `inputRecording.ts` v2）：從計時開始到過關，記錄每 tick 的 `ControlFrame`、所有不經 `ControlFrame` 直接改狀態的操作（起降鍵 / 重置 / 急停 / 回家 / 模式切換 / 執行與停止程式，於 `physics.ts` / `level.ts` / `program.ts` 的 `recordAction`）、同一畫面連跑多 tick 的區段（程式模式 async 指令鏈的微任務排空時點），並逐 tick 累積狀態 hash。過關時經 REST `POST /auth/student/replay-log` 上傳，`complete_level` 只帶參照與 hash（WS 4KB 上限）。
- **重播**：伺服器以 Node 執行打包的 `core/`（Docker 映像內建 `/app/replay/verify-recording.mjs`），**用伺服器資料庫的關卡定義**重跑，判定集中在 `core/replayVerify.ts`：hash 相符、確實過關、宣告用時不短於模擬時間、錄製關卡與過關關卡一致。結果三態：可疑（標 suspect）/ 無法驗證（舊版前端、前後端 `simVersion` 不同、老師剛改過關卡、程式模式）/ 通過。驗證器自身失敗一律不算學生的錯。
- **安全：伺服器絕不執行學生端送來的程式碼**。程式模式錄製裡的 code 是任意字串，`new Function` 等同遠端執行任意程式 → 含 `run` 操作的錄製一律判「無法驗證」；驗證器另以 `node --disallow-code-generation-from-strings` 啟動、只傳 PATH 等必要環境變數（不含資料庫 / AWS 機密）作為縱深防禦。上傳端點先驗身分、限量串流讀取（2MB）並限制每生每分鐘 20 筆。要驗證程式模式需改為伺服器端從 Blockly 工作區重新產生程式碼或使用沙箱直譯器，屬後續工作。
- **線上與重播共用 `core/simTick.ts`**；`core/replayParity.test.ts` 以真實操作情境守住兩邊一致。新增任何直接改無人機狀態的操作都必須呼叫 `recordAction` 並在 `replayRunner.ts` 對應重演。
- **`REPLAY_ENFORCE`**（預設關）：開啟後「未附錄製（非離線補傳）」與「無法驗證」也標可疑；PWA 新版於下次開啟才生效，確認錄製上傳穩定後再開。

### 多房間（`app/rooms.py`）

- **一個 Room = 獨立名冊（Roster）+ 獨立賽局（ArenaGame / SoccerGame）+ 設定（名稱 / 密碼 / 人數上限 / 鎖房）**，`RoomManager` 持有 `dict[房間碼 → Room]`、統一 tick 所有房的賽局並推房間列表給老師。**預設房 `MAIN`**（`DEFAULT_ROOM_CODE`）啟動即存在、不可關閉——不帶房間碼的學生走預設房，既有 URL / 流程原封不動；`app.state.roster/arena/soccer` 保留為預設房的別名。
- 房間碼 4 碼、去 0/O/1/I（`ROOM_CODE_LENGTH` / `ROOM_CODE_ALPHABET`），上限 `ROOM_MAX_ROOMS`（預設 20）；非預設房 0 人且無賽局閒置逾 `ROOM_IDLE_CLOSE_SEC`（預設 1h）自動關。
- **學生**：連線 `?room=` 或 `register{roomCode, roomPassword}` 指定房 → 門檢（不存在 / 鎖房 / 滿員 / 密碼）→ `room_joined` 或 `room_rejected`（不斷線可重試，連錯密碼 5 次才斷）；之後訊息全路由到該房。同名重連只在房內比對。
- **老師**：一條 WS 管多間，`RoomManager` 記每位老師「目前選定的房」；老師訊息帶 `roomCode` 就路由到該房、缺省用選定房；`room_create/close/update/kick/select/list_req` 管房，踢人 / 關房對學生 close **4001**（`WS_CLOSE_KICKED`）。名冊 / 賽局扇出只到選定該房的老師，`room_list` 則推所有老師（同一 loop tick 內合併）。
- **一班多房（分房）**：班級 = 名冊與進度的持久歸屬；房 = 上課場次。班級可同時開主房（`is_main`，code = 班級碼）＋至多 `ROOM_MAX_SUB_ROOMS`（預設 5）間分房（`room_create_sub`，獨立產碼、繼承班級密碼與人數上限）。老師 `room_move_student` 移動學生（退出賽局 → 換名冊 → 學生收 `room_joined`，client 退出多人模式）；帳號學生的分房指派與分房清單持久化在 `Team.settings["rooms"]`（`room_open_team` 連同還原，登入自動進被指派的分房）。關分房 = 學生移回主房不斷線、分組解散；關主房 = 分房一併卸載。廣播 `allRooms: true` 套用到班級所有房（老師端「整班廣播」開關）。權限：開分房 / 移動限班級擁有者（預設房作為移動來源例外 — 撈回停在 MAIN 的迷路學生）。

### 教師後台（`apps/teacher`）

Vite + TS（無框架，同 simulator 慣例），dev :5174、生產由 api 以 `/teacher` 供檔（assets 掛 `/teacher-assets/`，`TEACHER_DIST` 設定）。相對 legacy 修掉三個 bug：關卡下拉三章全列（`GET /api/levels`）、顯示真 LAN 位址（`GET /api/info`，不再打 api.ipify.org）、人數上限來自 `MAX_STUDENTS` 設定。大亂鬥/足球分頁版面已備、待 2c 啟用。

## 工作慣例

- 所有 UI 文字、註解、commit 訊息用繁體中文（zh-Hant）。
- 測試：Vitest（`packages/shared`、`apps/simulator` 的 `src/**/*.test.ts`、`apps/teacher`）、pytest（`apps/api`；真實 PostgreSQL 測試只在設了 `TEST_DATABASE_URL` 時執行，不讀 `.env` 的 `DATABASE_URL`）、Playwright（`apps/simulator/e2e`）。視覺以 headless Chrome 截圖驗證（macOS 需 `--use-angle=swiftshader --enable-unsafe-swiftshader`）。
- 實作「缺少的功能」前先查 rewrite-plan §4 的 Phase 清單——很多是刻意延後，不是遺漏。
