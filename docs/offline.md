# L-01 真離線可玩（單機模式）— Service Worker 預快取

> 狀態：完成（2026-08-19）｜驗證：`pnpm build` 後以 headless Chrome 離線實測（見「驗證方式」）

## 這是什麼

學生端（`apps/simulator`）在**曾經線上開過一次**之後，斷網也能開起來玩 16 關單機關卡 ——
含關掉分頁重開、關掉瀏覽器重開、甚至一開機就沒網路。

做法：`vite-plugin-pwa`（Workbox `generateSW`）在 `pnpm build` 時產出 `dist/sw.js` +
`dist/manifest.webmanifest`；`src/pwa.ts` 於正式 build 註冊 Service Worker。
**不動遊戲代碼**——只有 `vite.config.ts`、`src/pwa.ts`（新）、`main.ts` 一行 `initPwa()`、
`index.html` 三個 `<meta>/<link>`、`public/icon*.{svg,png}` 圖標。

## 涵蓋範圍

| 項目 | 離線 | 說明 |
|---|---|---|
| 首頁 / JS / CSS（含所有 lazy chunk） | ✅ 預快取 | 約 7.3 MB（未壓縮；Pages 傳輸為 gzip/brotli） |
| 16 關關卡 JSON（`levels/chapter*.json`） | ✅ 預快取 | |
| Blockly 積木編輯器（含 `blockly-media/` 圖標與點擊音效） | ✅ 預快取 | |
| PWA 圖標 / manifest | ✅ 預快取 | 可「加到主畫面」以 standalone 開啟 |
| 手動飛行、程式模式（`cf_*` API）、關卡判定、成績計時 | ✅ | 純本地邏輯 |
| HDRI 天空（`assets/env/*.hdr`，1.7 MB） | ⚠️ 用過才存 | 見「已知限制」；缺少時退回純色天空，不影響遊玩 |
| 遊樂場場景 glb（5.7 MB）、Havok WASM（2 MB） | ⚠️ 用過才存 | 大亂鬥 / 足球本來就要連線 |
| 背景音樂 mp3（13.7 MB） | ⚠️ 用過才存 | 預設關閉；瀏覽器多以 Range 請求串流，通常不會進快取 |

## 不涵蓋範圍（刻意）

- **多人 / 老師連線**：大亂鬥、足球對戰、老師後台鎖關與即時監看都需要 WebSocket，離線不可用。
  Header 的連線指示會顯示「未連線」，這是既有行為，未另加 UI。
- **老師後台 `/teacher/`**：與學生端同一個 Pages 專案，但**不**被 SW 接管
  （`navigateFallbackDenylist` + `NetworkOnly`），離線不可用。
- **後端 API**：`/api/*`、`/auth/*`（同網域）與 `VITE_API_URL` 指定的網域全部 `NetworkOnly`，
  **永遠不快取**——線上一定拿到新資料，離線就是失敗（不會回舊資料）。
  WebSocket 握手本來就不經過 Service Worker。

## 首次載入需網路的資產（已知限制）

runtime cache（CacheFirst）只存「請求過」的資產，第一次仍要有網路：

| 資產 | 何時請求 | 進快取時機 | 離線缺少時 |
|---|---|---|---|
| `assets/env/pretoria_gardens_1k.hdr` | 每次開場 | **第二次線上開啟**（首次載入時 SW 還在安裝、尚未接管頁面） | 純色天空 |
| `assets/maps/playground_2b.glb` | 進大亂鬥 / 遊樂場 | 線上進過一次 | 需連線的功能，無影響 |
| `assets/HavokPhysics-*.wasm` | 進遊樂場 / 足球 | 線上進過一次 | 同上 |
| `assets/music/*.mp3` | 按「音樂：開」 | 通常不會（Range 請求 206 不入快取） | 無音樂 |

各 runtime cache 都設了 `maxEntries` / `maxAgeSeconds`（90 天）避免無限膨脹：
`creafly-wasm`(4)、`creafly-scene-assets`(12)、`creafly-music`(4)。

## 更新機制

- 每次開啟頁面瀏覽器都會向伺服器檢查 `sw.js`；新版部署後（precache 清單變了）新 SW 在**背景下載**
  全部新資產，然後**等待**（`skipWaiting:false`）—— 目前開著的分頁繼續用舊版，
  不會上課上到一半被 reload、也不會 lazy chunk 404。
- 下載完成時 toast 一則「已下載最新版本，下次開啟自動更新」；把所有分頁關掉再開就是新版。
- 首次安裝完成 toast「已可離線使用（單機模式）」。
- 舊版的預快取由 `cleanupOutdatedCaches` 自動清掉。
- **dev 不啟用**（`devOptions.enabled=false`，且 `initPwa` 只在 `import.meta.env.PROD` 註冊），
  `pnpm dev` 不會被快取干擾。若本機曾用 `vite preview` 裝過 SW，開 dev 前請到
  DevTools → Application → Service Workers 取消註冊（dev 與 preview 不同 port，通常互不影響）。

## 驗證方式

1. `pnpm typecheck && pnpm build:pages`：`apps/simulator/dist/` 應有 `sw.js`、`workbox-*.js`、
   `manifest.webmanifest`；`dist/teacher/` 照舊；`sw.js` 內 precache 清單不含 `teacher/`、不含 `.wasm`。
2. headless 離線實測（CDP 腳本，本次驗收 31/31 通過）：
   - `vite preview` 起產物 → headless Chrome（`--use-angle=swiftshader --enable-unsafe-swiftshader`）
     載入首頁 → 輪詢 `navigator.serviceWorker.ready` 與 precache 條目數（110）
   - `Network.emulateNetworkConditions({offline:true})` **並把 preview 伺服器殺掉**（頁面層級的離線模擬
     不會作用在 SW 端的 fetch，殺伺服器才是真離線）→ reload → `window.CREAFLY` 存在、
     `levelState.levels.length === 16`、`loadLevel('1-1')`、`runProgram('await CREAFLY.takeoff(3); await CREAFLY.land();')`
     起飛到 3 m 再落地
   - 關分頁開新分頁（一開始就離線）、關瀏覽器重開（同 profile、一開始就離線）：同上皆通過
   - `/api/info`：線上不寫入任何 cache；離線 fetch 直接失敗（不回舊資料）；`/teacher/` 離線亦不被
     fallback 成模擬器首頁；未載過的 glb 離線不可得（符合已知限制）
   - 更新流程：改 `dist/index.html` 與 `sw.js` 對應 revision 模擬新版 → reload → 新 SW `waiting`、
     目前分頁仍舊版、toast 出現 → 關閉全部分頁重開 → 新版生效
3. 手動：Chrome DevTools → Application → Service Workers 勾 Offline，重新整理應能開起來玩。
