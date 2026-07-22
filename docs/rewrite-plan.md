# CREAFLY 模擬器重寫計畫 — Three.js → Babylon.js + Monorepo 化

> 狀態：進行中
> 分支：`rewrite/babylon-monorepo`
> 建立日期：2026-07-15
> 目標：**徹底移除 Three.js，以 Babylon.js + TypeScript 重寫模擬器**，效果與現有 demo 相同或更好；同時把單檔架構重組為業界標準的 monorepo，為未來（React/Vue、Havok、FastAPI 後端、伺服器權威物理）鋪路。

---

## 1. 為什麼重寫（背景摘要）

現有 demo（v1.5）的核心問題，重寫時逐一解決：

| 現有問題 | 重寫對策 |
|---|---|
| `main.js` 單檔 5249 行、全域狀態 20+ 個、上帝迴圈 | 模組化 TS，依子系統切檔，明確 import 依賴 |
| 物理無 delta time，**綁定螢幕幀率**（144Hz 螢幕飛 2.4 倍快） | **固定時步 60Hz 模擬 + 渲染插值**（accumulator pattern） |
| 程式模式繞過物理、純 tween | 統一走同一物理狀態，指令層下目標、物理層執行 |
| Blockly 生成碼 `eval()` 直接執行 | `new Function` + 顯式 API 注入 + abort/timeout（後續階段再遷 Worker） |
| 遊戲邏輯直接操作 DOM（~100 處 getElementById） | 核心層與 UI 層分離：核心發事件，HUD 層訂閱 |
| 邏輯與渲染引擎耦合 | 核心狀態（DroneState、關卡判定）為純 TS，渲染是訂閱者 |
| CDN 依賴（教室斷網即掛） | npm 安裝 + Vite 打包，產物完全自足 |
| 無型別、無建置、無測試 | TypeScript strict + Vite + Vitest（核心邏輯可測） |

**可攜資產（直接沿用，不重新發明）**：
- `levels/chapter{1,2,3}.json` 關卡 schema（座標系不變）
- `cf_*` Action API 語意契約（Blockly 積木的執行介面）
- Blockly 積木定義與 toolbox 結構、`lessons-data.js` 教案
- WebSocket 訊息協定語意（重構版 client 與 legacy server 可互通，降低切換風險）

---

## 2. Monorepo 架構

採 **pnpm workspaces**（業界成熟方案；`node_modules` 嚴格隔離，天然解決「套件互相影響」問題）。暫不引入 Turborepo/Nx——目前只有 2 個 app + 1 個共用包，等建置圖變複雜再加，避免過度工程。

```
droneclassroom/
├── pnpm-workspace.yaml
├── package.json                  # 根：只放 workspace scripts 與共用 devDependencies（typescript）
├── tsconfig.base.json            # 共用 TS 設定（strict）
├── docs/
│   └── rewrite-plan.md           # 本文件
├── packages/
│   └── shared/                   # @creafly/shared — 零依賴純型別與純函數
│       ├── src/levels.ts         #   關卡 JSON schema 型別 + 載入驗證
│       ├── src/protocol.ts       #   WS 訊息協定型別（student/teacher/server 三向）
│       └── src/math.ts           #   heading/角度等純函數
├── apps/
│   ├── simulator/                # @creafly/simulator — 學生端（Babylon.js + Vite + TS）
│   │   ├── index.html
│   │   ├── public/levels/        #   關卡 JSON（從舊版複製，schema 不變）
│   │   ├── public/assets/        #   HDRI / glb / 音樂
│   │   └── src/
│   │       ├── core/             #   ★ 框架無關核心（不 import Babylon、不碰 DOM）
│   │       │   ├── droneState.ts #     物理狀態單一真相來源
│   │       │   ├── physics.ts    #     固定時步物理（60Hz tick）
│   │       │   ├── level.ts      #     關卡載入 + rings/passZones/balloons 判定
│   │       │   ├── program.ts    #     cf_* Action API + 程式執行器（abort/timeout）
│   │       │   └── events.ts     #     型別化 event bus（核心 → UI/渲染）
│   │       ├── render/           #   Babylon 渲染層（訂閱 core）
│   │       │   ├── scene.ts      #     engine/scene/光影/環境
│   │       │   ├── drone.ts      #     程式化幾何無人機（對齊 CREAFLY 配色）
│   │       │   ├── levelMeshes.ts#     圈/障礙/氣球/passZone 視覺
│   │       │   └── cameras.ts    #     第三人稱跟隨 / FPV / 俯視 / 環繞
│   │       ├── input/            #   鍵盤 / nipplejs / Gamepad（校正精靈後續階段）
│   │       ├── blockly/          #   積木定義 + toolbox + 程式碼生成
│   │       ├── net/              #   WS client（重連 backoff，協定同 legacy）
│   │       ├── ui/               #   HUD / toast / modal（純 TS + DOM，暫不引框架）
│   │       └── main.ts           #   組裝入口
│   └── api/                      # @creafly/api — 後端（FastAPI + uv；原規劃的 Node 過渡版已直接跳過）
│       └── src/
│           ├── index.ts          #   http 靜態（修 path traversal）+ WS upgrade
│           ├── protocol.ts       #   re-export @creafly/shared 協定 + 執行期驗證
│           ├── students.ts       #   學生註冊/名冊/進度
│           └── games/            #   arena / soccer 賽局（後續階段從 legacy 移植）
└── legacy/                       # 舊版完整保留（可獨立跑，做效果對比基準）
    ├── index.html / main.js / server.js / teacher.html ...
```

### 套件隔離與協調原則
- **pnpm 嚴格 `node_modules`**：app 只能 import 自己 `package.json` 宣告的依賴，幽靈依賴直接報錯 —— 這就是「安裝包不互相影響」的機制保證。
- `@creafly/shared` 以 `workspace:*` 被兩個 app 引用；**shared 不准有任何 runtime 依賴**（純型別 + 純函數），避免前後端被同一個第三方包綁死。
- 前端依賴（babylonjs、blockly、nipplejs）只存在於 `apps/simulator`；後端（`apps/api`）的 Python 依賴由 uv 獨立管理。根目錄只放 `typescript` 等共用 devDependency。
- 版本統一：TS 版本由根管理；各 app 的 tsconfig `extends` 根目錄 `tsconfig.base.json`。
- 未來 FastAPI 後端進場時，Python 側用 `uv` 管理、放 `apps/api/`，與 pnpm 互不干涉（mixed-language monorepo 的標準做法）。

### 為什麼不拆多 repo？
現階段前後端協定/關卡 schema 高頻共演化，monorepo 讓一個 PR 同時改協定兩端 + 型別即時對齊，是正確選擇。等正式版 Rust core / FastAPI 團隊分工明確後再考慮拆分。

---

## 3. 關鍵技術決策

### 3.1 座標系：Babylon 開右手系，關卡資料零遷移
`scene.useRightHandedSystem = true`，維持舊版「右手系、機頭 -Z、yaw 正向 = 左轉」的慣例。**所有關卡 JSON、faceYaw 判定、教案文字完全不用改。**

### 3.2 物理：固定時步 60Hz，手感常數直接沿用
舊版常數（`THRUST=0.012`、`DRAG=0.92`、每幀 `position += velocity`）是 per-frame 值。重構版把「幀」定義為**固定的 1/60s 模擬 tick**（accumulator pattern，渲染幀率無關），常數原封沿用 → **60Hz 螢幕上的手感 100% 一致**，高刷螢幕從「飛太快」變成「正確」。渲染以 alpha 插值消除抖動。

程式模式不再繞過物理直接 lerp position，改為：cf_* 指令產生「目標位置/朝向 + 時長」的 motion plan，由物理 tick 逐步逼近（對外行為與舊版 tween 等價，但狀態流單一）。

### 3.3 物理引擎：本階段不上 Havok
本階段目標是**效果對齊**，舊版碰撞（球 vs AABB 推出、距離判定、BVH 網格）在重構版以純 TS 重現（AABB/距離部分）；遊樂場 glb 的網格碰撞與 Havok 一起排入 Phase 3。核心預留 `PhysicsBackend` 介面，Havok / 未來 Rust-WASM 以此介面接入，UI 與遊戲層零改動。

### 3.4 Blockly 執行：`new Function` + 注入式 API
生成碼包成 `new Function('CREAFLY', 'async (…)')`，只看得到顯式注入的 cf_* API（不再依賴 eval 的詞法作用域）。保留協作式 abort + 迴圈積木 30s timeout。Worker 化（徹底解決同步死迴圈）列 Phase 3。

### 3.5 UI：本階段不引入 React/Vue
HUD/面板以純 TS + DOM 元件實作，但**核心層已透過 event bus 與 UI 解耦**——之後團隊定案 React 或 Vue 3，只需重寫 `ui/` 目錄，核心不動。（框架選型見 docs 前次評估：非架構問題，依團隊熟練度決定。）

### 3.6 WS 協定：與 legacy server 二進位相容
重構版 simulator 說的協定與舊版完全相同（`register`/`progress`/`complete_level`/arena/soccer 系列），意味著**過渡期可以新舊 client 混班連同一台 server**。協定型別化進 `@creafly/shared`，server 端加上執行期驗證（修掉 broadcast 原封轉發問題）。envelope/版本欄位等破壞性協定升級留給 FastAPI 階段。

---

## 4. 分階段里程碑

### Phase 1 — 單人核心對齊（✅ 2026-07-15 完成）
- [x] Monorepo 骨架、legacy 搬遷
- [x] `@creafly/shared`：關卡 schema + WS 協定型別
- [x] Babylon 場景：地面/格線/起飛台/雲/光影/霧/假陰影（HDRI 失敗降級純色）
- [x] 程式化無人機模型（CREAFLY 配色、對轉螺旋槳、LED、視覺傾斜）
- [x] 固定時步物理 + 手動控制（鍵盤 / nipplejs / Gamepad 基本對映）
- [x] 關卡系統：chapter1 全 7 關（rings / passZones / balloons / returnHome / faceYaw / 障礙 AABB）
- [x] 相機：第三人稱跟隨 + FPV
- [x] Blockly 程式模式：Phase 1 積木全數 + cf_* API + 執行/停止（blockly v11 npm 包、media 本地化）
- [x] HUD：狀態列 / 任務進度 / 過關 / toast / 關卡選單 / 登入
- [x] Web Audio 音效 + WS client（連 legacy 協定；`?autologin=1` 開發後門）
- [x] `apps/server`：TS 重寫靜態伺服 + 學生名冊/進度（修 path traversal、broadcast 白名單、限流）
- [x] headless 截圖對比 legacy 效果對齊；WS 端對端（register→welcome→名冊）通過

> Phase 1 驗收備註：`pnpm -r typecheck` 零錯誤、`pnpm build` 零 CDN 依賴；
> core/ 為純 TS 已以 Node 直跑 10 項行為測試（cf_* 座標/yaw 語意、AABB 推出、慣性）。
> 實機 120Hz 螢幕手感一致性由固定時步保證，建議課前人工試飛一次確認。

### Phase 2 — 完整功能對齊
- [x] **2b 教師後台重寫（✅ 2026-07-15，提前於 2a）**：`apps/teacher`（Vite+TS）+
  api 安全層——老師 PIN→短效 ticket（HMAC、TTL 4h、登入限流）、Origin 白名單、
  防作弊 suspect 標記（跟名字走不可洗白）、`GET /api/levels`（三章全列）/
  `GET /api/info`（真 LAN 位址、人數上限設定化）。46 個 pytest。
- [x] **2a 畫畫教室（✅ 2026-07-15）**：ch2 俯視 + ch3 環繞、GreasedLine 粗墨水、
  畫筆積木（紫 285）、guide 虛線參考線。全部由關卡 JSON 驅動——修掉 legacy 寫死
  的俯視鏡位（改 guide bbox 自動取景 + 選配 `topdownCam` 覆寫）；過關/成績走
  既有 rings/passZones 管線，後端無感知。與 legacy 同關卡截圖對比通過。
- [x] **2c 大亂鬥多人（✅ 2026-07-15）**：FastAPI games/（balloon/tag 狀態機、
  倒數可取消——修 legacy bug）+ Babylon 客戶端（分身/內插綁 60Hz tick/計分板）；
  位置級防作弊（clamp/速度上限/pop 距離驗證/strike→suspect）
- [x] **2d 足球 + Havok（✅ 2026-07-16）**：PhysicsBackend 抽象層（SimpleBackend
  預設、Havok lazy WASM、失敗降級、未來 Rust 同介面）；單人 7 drill + 多人 3v3
  （進球 client/server 雙判定一致）；**機對機球體碰撞為新增**（legacy 沒有，
  接觸性運動的「撞擋卡位」實感），?nocontact=1 可關
- [x] 搖桿校正精靈（校正中鎖輸入——修 legacy 亂飛問題）、BLE pyController
  （TS module 化）、/lesson 教案頁、glb 遊樂場場景（Havok 網格碰撞）
  —— 皆已完成（2026-07-15/16）

> **Phase 2 全部完成（2026-07-16）**：重構版功能面全面對齊 legacy 並在物理、
> 安全、防作弊、資料驅動上超越。`legacy/` 的功能參照任務已結束，
> 可擇期整包移除（建議教室實測一輪後）。

### Phase 3 — 超越舊版
- Havok 接入 `PhysicsBackend`（glb 場景網格碰撞）
- Blockly 生成碼移入 Web Worker
- UI 框架定案（React/Vue 3）並改寫 `ui/`
- WebGPU 渲染路徑驗證

### Phase 4 — 後端演進（FastAPI 已提前進場：2026-07-15）
- [x] `apps/api`（FastAPI + uv）：協定相容的主線後端 — Pydantic 進站驗證、
  in-memory 名冊（同名重連/close 4000/進度繼承）、broadcast 白名單、
  60 則/秒限流 + 4KB 上限、no-store 靜態伺服、16 個 pytest + ruff 乾淨。
  **刻意無資料庫**：帳號/成績持久化需求出現時才引入 PostgreSQL + SQLAlchemy + Alembic。
- [x] `apps/api/app/games/` 預留 GameHandler Protocol — Phase 2 多人賽局（arena/soccer）直接在此實作，不再移植到 Node
- [x] `apps/server`（Node 版）已移除（2026-07-15，使用者決定不留備援；teacher.html 收斂為 api 一份 + legacy 原版）
- [ ] 認證/短效 ticket、房間抽象、Redis、正式協定升級（envelope/版本欄位）→ 競賽版再議

---

## 5. 驗收標準（Phase 1）

1. `pnpm install && pnpm dev` 一鍵起前端 + 後端
2. chapter1 七關全部可以手動模式通關，判定行為與 legacy 一致
3. 程式模式：舊教案的積木解答原樣拼出來即可通關（cf_* 語意不變）
4. 60Hz 與 120Hz 螢幕手感一致（legacy 做不到，重構版的「更好」）
5. 建置產物零 CDN 依賴，斷網教室可用
6. headless 截圖：場景構圖、無人機外觀、HUD 資訊與 legacy 對比無遺漏
