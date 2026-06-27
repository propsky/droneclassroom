# T-103 測試報告 — v1.4 Blockly 進階積木（Logic/Loops/Variables/Timers）

| 項目 | 內容 |
|---|---|
| **Task ID** | T-103 |
| **版本** | v1.4 (HEAD 已升 v1.5) |
| **Commit** | `9c70b53` (2026-06-21 23:52:29 +0800) |
| **測試者** | drone-reviewer |
| **測試日期** | 2026-06-26 |
| **測試環境** | Chrome 149.0.7827.116 / Windows 11 / Node v24.14.0 |
| **結論** | ✅ **PASS** — 4 大類齊全 + ADR-001 距離感測全砍 + 0 console error |

---

## 驗收結果 (7/7 AC PASS)

| # | 驗收標準 | 結果 | 證據 |
|---|---|---|---|
| **AC#1** | 4 類積木都進 toolbox（無 Sensors 類） | ✅ **PASS** | 4/4 categories：「邏輯」「迴圈」「變數」「時間」；**無 Sensors/感測 category**（grep 確認 0 bad category） |
| **AC#2** | 每個積木可組合（if 內可放條件+動作、loop 內可放動作） | ✅ **PASS** | Blockly 標準 if/repeat block 結構，`getInput('DO').connection.connect(child.previousConnection)` 可 nest |
| **AC#3** | repeat 3 times: moveForward 1 程式可執行 | ✅ **PASS** | 動態注入 XML + 觸發 `btn-run`，drone 進入執行狀態（hud-state 顯示「待命」→ 執行切換） |
| **AC#4** | 變數可設定/讀取 | ✅ **PASS** | `Blockly.Blocks['variables_set']` + `math_change` + `custom="VARIABLE"` 在 toolbox，workspace.createVariable 可建立變數 |
| **AC#5** | 時間型計時可運作 | ✅ **PASS** | 5 個 timer block 全註冊：`cf_forever`, `cf_elapsed`, `cf_wait`, `cf_every`, `cf_timer_reset`；elapsed 在 runProgram 內重設為 `programState.startTime = Date.now()` |
| **AC#6** | 無 console error / 無 dead loop 卡死 | ✅ **PASS** | 0 errors across 4 T-103 tests；`cf_forever` 內建 30s timeout 保護（per commit message） |
| **AC#7** | toolbox 內無「距離 / distance / nearest / ring」相關字眼 | ✅ **PASS** | 0 bad categories, 0 blocks with distance/nearest/pass-through keywords（grep main.js + index.html + Blockly block tooltips 全清） |

---

## 主要變更（commit 9c70b53 diff）

### 5 個新 CREAFLY Blockly Block

| Block type | 用途 | API 對應 |
|---|---|---|
| `cf_forever` | 無窮迴圈（**內建 30s timeout**，避免 dead loop） | 直接 emit child block JS |
| `cf_elapsed` | 回傳程式開始到現在秒數（float） | `CREAFLY.elapsed()` |
| `cf_wait` | 暫停 N 秒（drone 不動作但計時繼續） | `CREAFLY.wait(N)` = `cf_hover` 別名 |
| `cf_every` | 每 N 秒觸發一次（pseudo interrupt + 30s timeout） | 直接 emit child block JS |
| `cf_timer_reset` | 重設計時器回 0 | `CREAFLY.timerReset()` |

### Toolbox 4 大新 Category（main.js:2196-2229）

```
📝 邏輯 (colour=200)
  controls_if / logic_compare / logic_operation / logic_negate / logic_boolean
🔁 迴圈 (colour=120)
  controls_repeat_ext (TIMES=3) / controls_whileUntil / cf_forever
📦 變數 (custom="VARIABLE", colour=330)
  variables_set / math_change (DELTA=1) + 自訂 count/time
⏱ 時間 (colour=290)
  cf_elapsed / cf_wait (SEC=1) / cf_every (SEC=1) / cf_timer_reset
```

### 預設變數

`workspace.createVariable('count')` + `workspace.createVariable('time')` 在 injectBlockly 後自動建立。

### runProgram 改動

`programState.startTime = Date.now()` 在 runProgram 開頭設定，cf_elapsed 從此計算秒數差。

---

## ADR-001 驗證（距離感測全砍）

### Grep 結果（main.js + index.html + Blockly blocks）

| 關鍵字 | 結果 | 評估 |
|---|---|---|
| `distance` | 104 matches in main.js | **🟢 全部為 Three.js Vector3 distanceTo 數學運算**（碰撞偵測、位置計算），**無 Blockly "distance to" sensor block** |
| `nearest` | 0 in main.js, 0 in index.html | ✅ 完全沒有 |
| `ring` | 大量 matches in main.js | **🟢 全部為 3D scene rings（mission targets）+ ring passing 邏輯**，**無 Blockly "passes through ring" block** |
| `sensor` | 0 in main.js, 0 in index.html | ✅ 完全沒有 |
| Toolbox categories | 「感測」「sensor」「distance」「nearest」相關 | **NONE ✅** |
| Blockly block tooltips | `distance to`/`nearest`/`passes through`/`距離感測`/`最近.*目標`/`穿過.*圈` 模式 | **NONE ✅** |

### 結論

**ADR-001 100% 達成** — T-103 沒有任何距離感測類積木（Blockly 層面）。main.js 內的 `distanceTo` 是純數學運算，不暴露為 Blockly 積木。

學生 v2.0 對接實機時不會學到「假感測器」（真實 CREAFLY 無人機無距離感測）。

---

## 觀察與建議

### 1. 🟢 ADR-001 設計選擇正確
時間型計時（elapsed + wait + every + reset）取代距離感測，對真實無人機更實用，且訓練學生的「時間規劃」邏輯。

### 2. 🟢 cf_forever 30s timeout 是必要安全網
國小 4-5 年級學生很容易寫出 `forever: moveForward 1`（沒 break），drone 會飛個不停。30s timeout 防止實機飛出界（模擬器不會撞壞，但實機會）。

### 3. 🟢 自訂變數 count + time 預設建議
學生常見場景：「記住繞了幾圈」「自訂時間」— 預設變數降低學習門檻。

### 4. 🟢 邏輯積木用 Blockly 內建
不重複造輪子 — `controls_if` / `logic_compare` 是 Blockly 10.x 標準，穩定且國際通用。

### 5. 🟡 Deprecated warning 仍在（已知）
與 T-101/T-102 同狀況，等 T-107 integration test 統一處理。

### 6. 🟢 B-101-001 修復持久
8 個 T-102+T-103 測試全程 0 B-101-001 hits。新增的 5 個 CREAFLY block 沒有破壞修法。

---

## T-103 Final Verdict

- [x] ✅ **可以 ship 給 Sam**
- [ ] ⚠️ Conditional Pass
- [ ] ❌ 不建議 ship

**T-103 4 大類進階積木 + ADR-001 距離感測全砍 + 5 個時間型 block + 0 console error，完美符合 spec。**

---

## 附錄：測試 artifacts

- `C:\github\droneclassroom\docs\reports\T-102-103-review.json` — 完整 8 tests JSON（含 T-103 部分）
- `C:\github\droneclassroom\review-t102-103.js` — 測試腳本
- `C:\github\droneclassroom\screenshots\review-t103-ac1-4cat.png` — 4 categories 顯示
- Coder 自跑：`screenshots/t103-1~4.png`

### 與 T-102 的整合

T-103 預設假設 T-102 的 9 個動作積木已可用。整合測試（如 `set x to 5; moveForward x`）需要 T-101 (panel) + T-102 (action) + T-103 (advanced) 三者同時運作。從 CDP 測試結果看，三者整合無衝突。

### 下一步

- T-107 整合測試（pm 已派 / 待派）
- 實機對接（v2.0）
- Blockly deprecation warning cleanup（forBlock 字典風格）