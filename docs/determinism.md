# G-04 跨環境 bit 級確定性 — 實作與驗證

> 狀態：Gate 通過（2026-07-31）｜驗證指令：`pnpm --filter @creafly/simulator verify:determinism`

## 這是什麼

同樣的初始狀態（seed）＋同樣的每 tick 輸入序列，在**任何 JS 引擎**重演模擬，
所有浮點結果 bit 級相同。這是競賽成績驗證（伺服器重演輸入序列證明成績真偽）、
回放系統與跨裝置公平性的地基。

## 非確定性來源與對策（全部已處理）

| 來源 | 對策 |
|---|---|
| `Math.sin/cos` 各引擎實作不同 | `@creafly/shared/detmath`：fdlibm（netlib）移植，只用 IEEE-754 強制正確捨入的運算與整數位元操作；對照原生 Math 誤差 ≤ 1 ULP（47 萬點驗證） |
| `Math.hypot` 演算法未被規格固定 | `detHypot2/3` 以 `sqrt(x²+y²)` 重寫（乘加與 sqrt 皆正確捨入；模擬座標量級無溢位疑慮） |
| `Math.pow(x, 2)` 未保證正確捨入 | `easeInOut` 改乘法 |
| `Math.random` 無種子 | `@creafly/shared/rng` mulberry32（純 32 位整數運算）；`core/rng.ts` 單一入口，預設牆鐘播種（體驗不變）、回放時 `seedRng(seed)` |
| 牆鐘時間滲入判定 | 模擬時間 = tick 計數 × TICK_MS（`droneState.simNowMs`）；圈圈浮動、判定、墨水取樣、`cf_elapsed`（程式流程控制）全走模擬時間 |
| 程式模式 async 排程 | 指令鏈以「每 tick 固定次數微任務讓出」推進；Promise job 順序為規格強制 FIFO → 跨引擎一致（回放場景實測含 async 指令鏈） |

**保留牆鐘（刻意）**：成績計時 `levelElapsedMs`（wall-clock 語意 + 暫停補償）、
1-0 duration 熱身倒數、多人賽局的伺服器 `endTime` 對時 —— 皆不在模擬確定性路徑上。

## 範圍界定

- 涵蓋：單人關卡的手動物理、AABB 障礙碰撞、關卡判定（圈/zone/氣球/faceYaw）、
  程式模式（motion plan / cf_* / 迴圈與時間積木 / 畫筆）。
- **不涵蓋：Havok**（閉源 WASM，無法自證）——遊樂場網格碰撞與足球不在保證內；
  多人賽局本來就是伺服器權威判定，不依賴 client 確定性。

## Gate 驗證（`apps/simulator/scripts/`）

`verify:determinism` 做四層驗證：

1. **單元基準**：detmath + PRNG 雜湊 30 萬值 → 必須等於寫死的基準 hash
   （任何環境、任何 Node 版本）。
2. **回放場景**（`replay-scenario.ts`）：純 core 驅動 1200 tick 腳本化手動飛行
   （起飛/前進/轉彎/蛇行/撞障礙/穿 3 圈含 faceYaw）＋程式段
   （async 指令鏈、`cf_random`、`cf_elapsed` 條件、隨機筆色），逐 tick FNV-1a 雜湊全狀態。
3. **同引擎可重現**：Node 跑兩次 hash 相同。
4. **跨引擎 bit 級**：esbuild 打包單檔 → 同一 bundle 丟給 **jsc**
   （JavaScriptCore = iPad Safari 的引擎）→ hash 必須與 Node(V8) 完全相同。
   非 macOS 環境找不到 jsc 時此層跳過並警告。

## 後續（驗證服務里程碑再做）

- 正式回放格式（錄製真實學生輸入 → 上傳 → Node 重演驗證成績）；
  屆時 pump 的微任務排程策略需與瀏覽器主迴圈對齊（本文件的固定讓出策略為 Gate 用）。
- CI 三引擎（加 SpiderMonkey）矩陣；目前 V8 ≡ JSC 已涵蓋教室實際裝置
  （iPad = JSC、PC Chrome/Edge = V8）。
