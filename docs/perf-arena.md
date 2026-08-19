# 大亂鬥效能量測（L-03：16 機 ≥50fps）

量測日期：2026-08-19　機器：Apple Silicon Mac（macOS 27）　分支：main（rewrite/babylon）

原則：**先量、有數據才決定要不要優化；不達標才動手，只做最小必要優化。**
本次結論摘要：

| 維度 | 結果 | 判定 |
|---|---|---|
| 伺服器（16 機 balloon / tag） | tick 平均 0.8 ms、p95 < 3 ms、最大 5.9 ms（門檻 24 ms = 80 ms 的 30%）；CPU 2–3% | **過**，不動 |
| 伺服器（32 機 tag，餘裕測試） | tick 平均 3.0 ms、p95 6.6 ms、最大 17.8 ms；CPU 5% | 過（16 機餘裕 ≥ 2 倍） |
| 客戶端 grid 場地（16 vs 1 分身） | fps 退化 8%、draw call 101 → 189 | **過**，不動分身 |
| 客戶端 playground 場地（16 vs 1） | fps 退化 19%（<40%）；但 draw call 722 → 939，**1 個分身時就 >500** | 超標 → 做最小優化（glb 靜態 mesh 合併） |
| playground 優化後 | draw call 131（1 機）/ 217（16 機）；swiftshader fps 不變（軟體光柵是像素瓶頸） | draw call 過；fps 絕對值需實機驗收 |

---

## 1. 方法

### 1.1 伺服器（headless 就準）

- 起 `apps/api`：`TEACHER_AUTH_DISABLED=1 PORT=3300`。為了**不改 repo 檔案**，用一支 wrapper 在同一 process 內
  monkeypatch `ArenaGame.tick`（perf_counter 計時）與 `BaseGame._broadcast`（累計 payload 位元組 × 收件人數、各 type 訊息大小），
  再啟 uvicorn；每 5 秒 dump 一筆統計（tick n / mean / p50 / p95 / max、每秒送出位元組、CPU%）。
  CPU% 用 `os.times()` 差分（本 process user+sys ÷ 牆鐘），並以 `ps -o %cpu` 對 python 子行程抽樣交叉驗證（兩者一致：5.2% vs 5.5%）。
- 假客戶端（`websockets`，apps/api dev 依賴已有）：1 假老師 + N 假學生。
  學生：`register` → `arena_join` → 每 80 ms `arena_pos`（朝最近氣球飛，速度 6 單位/秒，遠低於防作弊上限 18）
  → 距氣球 < 1.4 送 `arena_pop`（與 client 判定同）；追蹤 `arena_state` / `arena_balloon` 維護氣球表。
  老師：`POST /auth/teacher` 取 ticket → `/teacher` WS → 全員到齊後 `arena_start`（3 分鐘）→ 60 秒後 `arena_stop`。
- 客戶端側量：`arena_players` 到達間隔（mean / stdev / p95 / max）、各 type 訊息大小、每學生每秒收位元組、pop 成功數。
- 兩種模式都跑：balloon（16 機）、tag（16 機、3 鬼）；另加 32 機 tag 看餘裕（tag 碰撞判定 O(鬼 × 跑者)）。

### 1.2 客戶端（swiftshader 只看相對退化，絕對值需實機）

- 前端 `vite build` 到暫存目錄，由同一個 API 以 `STATIC_DIR=` 服務（同源 WS，與正式部署相同路徑）。
- headless Chrome（`--headless=new --use-angle=swiftshader --enable-unsafe-swiftshader`，1280×800）開
  `/?autologin=1&arena=1`；後端另掛 N 個假學生製造分身；假老師等「假學生 + 瀏覽器」到齊後 `arena_start`。
- CDP `Runtime.evaluate` 每秒採樣：`engine.getFps()`、`scene.getActiveMeshes().length`、`scene.meshes.length`、
  draw call（在 `scene.onBeforeRenderObservable` 讀 `engine._drawCalls.current` 後 `fetchNewFrame()`，等同 SceneInstrumentation）。
  等 `arenaState.status === 'running'` 後正式採 40 秒（每組 41 個樣本）。
- 對照組：同機器 **1 個分身**（1 假學生）；實驗組：**15 個分身**（15 假學生 + 瀏覽器自己 = 16 機）。
  場地各跑 grid 與 playground（glb + Havok）。

### 1.3 已知量測限制

- swiftshader 是 CPU 軟體光柵：fps 受**像素著色**主宰（PBR 場景 5–6 fps、格線 20 fps），**draw call 數量幾乎不反映在 fps 上**；
  實機 GPU 情況相反 —— draw call（每次 draw 的 CPU/驅動開銷）常是行動裝置瓶頸。因此 swiftshader 只拿來看「相對退化」與 draw call / mesh 數，
  絕對 fps 一律以實機為準（§5）。
- headless 進場時 `?arena=1` 在 800 ms 觸發，比關卡清單載完早，會殘留 1-0 關卡 intro / 少量關卡物件（幾顆 mesh），對兩組一致、不影響相對比較。
- 假學生 pop 頻率（8.5 次/秒全班）遠高於真實學生，`arena_scores` 流量是高估的上界。
- 假學生不會回應碰撞 / 傳送，位置為直線飛行；伺服器負載面與真實相同（每 80 ms 一筆 pos）。

---

## 2. 伺服器數據

### 2.1 tick 耗時 / CPU / 送出流量（每 5 秒視窗，取賽局進行中的視窗彙總）

| 情境 | tick 平均 | tick p50 | tick p95（最差視窗） | tick 最大 | CPU%（平均） | 送出 bytes/s（全體） | 送出 msgs/s |
|---|---|---|---|---|---|---|---|
| idle（無人） | 0.008 ms | 0.008 | 0.014 | 0.016 | 0.2 | 0 | 0 |
| balloon 16 機 | **0.79 ms** | 0.6–0.9 | 1.45 ms | 3.6 ms | **2.6%** | ~800 KB/s | 520–640 |
| tag 16 機（3 鬼） | **0.79 ms** | 0.45–0.8 | 2.9 ms | 5.9 ms | **2.1%** | ~560 KB/s | 210–260 |
| tag 32 機（6 鬼，餘裕） | 3.0 ms | — | 6.6 ms | 17.8 ms | 5.2%（ps 5.5%，峰 8.3%） | ~2.4 MB/s | — |

門檻：tick < 80 ms 的 30% = 24 ms。16 機最差單次 5.9 ms、32 機最差 17.8 ms，都在門檻內；CPU 單核 2–5%，餘裕充足。
tag 的鬼×跑者碰撞判定在 16 機是 3×13=39 次距離運算 / tick，32 機也只有 6×26=156 次，**不需要空間分格**。

### 2.2 客戶端收到的 `arena_players` 節奏（抖動）與訊息大小

| 情境 | 到達間隔 mean | stdev（各學生平均） | p95 | 最大 | 每學生收 bytes/s |
|---|---|---|---|---|---|
| balloon 16 | 81.9 ms | **0.9 ms** | 83.3 | 86.3 | 47 KB/s（含高頻 arena_scores） |
| tag 16 | 81.9 ms | 1.1 ms | 83.8 | 88.4 | 33 KB/s |
| tag 32 | 84.3 ms | 2.5 ms | 88.5 | 113.8 | 72 KB/s |

（`asyncio.sleep(0.08)` 加 tick 本身 ≈ 82 ms 週期，是設計值不是延遲。）

各 type 訊息大小（16 機，avg / max bytes）：`arena_players` 2444 / 2472（每 80 ms 一則）、`arena_scores` 2217 / 2263（每次 pop / 抓捕）、
`arena_state` 3981 / 5235、`arena_go` 2854、`arena_end` 4398、`arena_balloon` 67 / 87、`arena_caught` 85。
32 機時 `arena_players` 4743 bytes。

流量估算：16 機每人 ~30 KB/s（players）+ scores 視 pop 頻率，全班合計 0.5–0.8 MB/s ≈ 4–6 Mbps，教室 Wi-Fi 可承受；
若日後要省，`arena_players` 的 `name` / `emoji` 每 tick 重送是最大冗餘（但改它動到協定，本次不動）。

---

## 3. 客戶端數據（swiftshader，1280×800）

| 情境 | build | fps 平均 | fps 中位 | fps 最低 | active mesh（中位） | total mesh | draw call（中位 / 最大） | 分身數 |
|---|---|---|---|---|---|---|---|---|
| grid，1 分身 | base | 19.3 | 19.5 | 15.3 | 91 | 122 | 101 / 107 | 1 |
| grid，15 分身（16 機） | base | 17.7 | 18.2 | 14.8 | 178 | 204 | 189 / 197 | 15 |
| playground，1 分身 | base | 5.7 | 5.7 | 5.0 | 714 | 889 | **722 / 727** | 1 |
| playground，15 分身 | base | 4.6 | 4.5 | 3.4 | 931 | 975 | **939 / 946** | 15 |
| playground，1 分身 | **merge** | 5.7 | 5.6 | 5.3 | 122 | 159 | **131 / 138** | 1 |
| playground，15 分身 | **merge** | 5.1 | 4.8 | 4.5 | 208 | 239 | **217 / 226** | 15 |

判讀：
- **grid：16 機相對 1 機退化 8%**（19.3 → 17.7），draw call 189 < 500 → 過。每個分身 7 顆 mesh（盒身 + 錐 + 4 馬達球 + 名牌）≈ 6–7 draw call，
  15 個分身 +88 draw call、+87 active mesh，成本線性且小。**分身不需要合併 / 共用名牌貼圖 / thin instance**（優先序 1–3 皆未觸發）。
- **playground：16 機相對 1 機退化 19%**（<40%），但 draw call 在只有 1 個分身時就 722、16 機 939 —— 超標來源是 glb 本身
  （764 顆獨立小 mesh、34 種 PBR 材質，每顆一個 draw call），不是分身。
  → 做**最小必要優化**：載入後依「材質 + 頂點屬性」分組 `Mesh.MergeMeshes`（§4）。合併後 draw call 131 / 217，回到門檻內；
  swiftshader 的 fps 不變（軟體光柵瓶頸在像素），實機 GPU 上 draw call 減少 ~700 才會體現（每 draw 數十 µs 的 CPU 開銷 → 每幀省 10–20 ms 級）。

---

## 4. 做了什麼（含 before/after）

### 4.1 playground glb 靜態 mesh 合併 — `apps/simulator/src/render/playground.ts`

- 新增 `mergeStaticMeshes(root, meshes)`：跳過 instance / 有骨架 / 無頂點的 mesh；其餘依 `material.uniqueId | 頂點屬性組合 | sideOrientation`
  分組，組內 ≥2 顆才 `Mesh.MergeMeshes(group, disposeSource=true, allow32BitsIndices=true)`（材質沿用第一顆，來源 mesh dispose、材質保留），
  合併結果 `freezeWorldMatrix()`；合併失敗（理論上不會）保留原始 mesh。
- 碰撞 triangle soup **仍用原始 mesh 在合併前烤**（幾何相同，Havok 註冊不變）；`this.meshes` 換成合併後清單，
  `applyVisibility` / `hide` / `disposeAll` 照舊運作。
- before/after（同機、同流程）：

  | | mesh 數（scene.meshes，含 50 氣球）| draw call（1 分身 / 15 分身） | 視覺 |
  |---|---|---|---|
  | before | 884–975 | 722 / 939 | `docs/images/perf-arena-playground-before.jpg` |
  | after | 150–239 | 131 / 217 | `docs/images/perf-arena-playground-after.jpg`，逐物件比對一致（滑梯 / 鞦韆 / 攀爬架 / 地面貼圖 / 半透明玻璃）|

- 功能驗證（headless 腳本）：進 playground → 老師改開 grid（25 顆合併 mesh 全隱藏、格線地面回來）→ 再開 playground（重顯）
  → `exitArena()`（mesh 全 dispose、`__root__` 消失、碰撞卸下 `probe(0,0.3,0).bumped=false`）→ 再進場（重載成功、碰撞 `bumped=true`）。
  計分 / 進出場 / 抓捕邏輯不在此檔，未動；協定未動。

### 4.2 `?fps=1` 實機驗收後門 — `apps/simulator/src/ui/fpsMeter.ts` + `main.ts` 兩行

- 帶 `?fps=1` 才建一個右下角小字（`#fps-meter`，`pointer-events:none`），每秒寫 `fps NN`（`engine.getFps()` 由 main.ts 注入，ui 層不引 Babylon）。
  沒帶參數零 DOM、零計時器。

### 4.3 沒做的（有數據支持不做）

- 分身名牌貼圖共用 / 降解析度、分身 mesh 合併、thin instances：grid 16 機退化 8%、draw call 189，未觸發門檻。
- 伺服器 tag 空間分格：16 機 39 次距離運算 / tick，tick 0.8 ms，遠不需要。
- 協定瘦身（`arena_players` 去掉每 tick 重送的 name/emoji）：流量可承受，且動協定，不在本次範圍。

---

## 5. 實機驗收腳本（老師用 iPad）

目標：**16 台同時在大亂鬥時，每台 ≥ 50 fps**（swiftshader 數字不代表實機）。

1. 老師電腦起後端與前端（正式部署或 `pnpm dev`），確認學生裝置能連上。
2. 拿一台 iPad（挑班上**最舊的機型**當基準），Safari 開學生端網址並加參數：
   `https://<學生端網址>/?arena=1&fps=1`（已登入過可只加 `?fps=1`，再按右下「大亂鬥」進場）。
   右下角會出現 `fps NN` 小字，每秒更新。
3. 其餘 15 台照常登入 → 進大亂鬥；老師後台開始一場 balloon（grid 場地）。
4. 進行中觀察 iPad 右下 fps 30 秒：**穩定 ≥ 50 為過**；同時記下 1–2 台其他 iPad 的數字。
5. 老師停止 → 改開 **playground** 場地再跑一次（Havok WASM + glb 首次載入會有幾秒 toast「載入遊樂場場景中…」，就緒後再看 fps）。
6. 對照組（可選）：只留 iPad 一台在場內跑同樣流程，比較 16 機 vs 1 機的 fps 差距（本次 headless 相對退化 grid 8% / playground 19%，實機應同級或更小）。
7. 若某台 iPad 明顯低於 50：先看是否 Safari 低電量模式 / 分割畫面 / 開了很多分頁；再看該台在 grid 是否也低（是 → 裝置本身，不是分身數量）。
   結果請回填到進度表 L-03，附機型 + iPadOS 版本 + fps。

---

## 6. 重現量測（腳本在 session scratchpad，需要時可重建；流程如 §1）

```bash
# 伺服器
cd apps/api && TEACHER_AUTH_DISABLED=1 PORT=3300 uv run creafly-api      # 或用 monkeypatch wrapper 量 tick
uv run python fake_clients.py --students 16 --mode balloon --duration 60   # 1 老師 + 16 學生
uv run python fake_clients.py --students 16 --mode tag --ghosts 3 --duration 60
# 客戶端（先 vite build --outDir <dir>，API 以 STATIC_DIR=<dir> 服務）
uv run python fake_clients.py --students 15 --no-teacher --duration 100     # 只掛分身
uv run python cdp_fps.py --url "http://localhost:3300/?autologin=1&arena=1" --wait-status running --seconds 40
uv run python teacher_only.py --wait-players 16 --field playground          # 老師開場
```

Chrome 旗標：`--headless=new --use-angle=swiftshader --enable-unsafe-swiftshader --remote-debugging-port=9333 --window-size=1280,800`。
