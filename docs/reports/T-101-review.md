# T-101 測試報告 — v1.4 Blockly panel 啟用 + 雙模式 UI 切換

| 項目 | 內容 |
|---|---|
| **Task ID** | T-101 |
| **版本** | v1.4 |
| **Commit** | `4691d43` (2026-06-20 08:16:58 +0800) |
| **測試者** | drone-reviewer |
| **測試日期** | 2026-06-21 |
| **測試環境** | Chrome 149.0.7827.116 / Windows 11 / Node v24.14.0 |
| **測試方法** | Chrome DevTools Protocol (headless, `ws://127.0.0.1:9222`) + 6 張 coder 截圖 + 7 張 reviewer 截圖 |
| **結論** | ⚠️ **Conditional Pass** — 7 項功能驗收 6 通過 / 1 失敗（console error），5 關迴歸全通過 |

---

## 通過項目 ✅

### 功能驗收 (6/7 PASS)

| # | 驗收標準 | 結果 | 證據 |
|---|---|---|---|
| **AC#1** | 預設行為：進關卡 = 手動模式，Blockly panel 隱藏 | ✅ PASS | `body.class="mode-manual"`, `blockly display=none`, `version=v1.4`, toggle 文字 = `🕹 手動`, HUD mode = `🕹 手動` |
| **AC#2** | Toggle 可見 + 可點擊切換 | ✅ PASS | 點擊前 `mode-manual`+blockly none → 點擊後 `mode-program`+blockly flex，切換文字 `🕹 手動 ↔ 💻 程式` 正確 |
| **AC#3** | 切換流暢 < 500ms，無閃爍、無 crash | ✅ PASS | 實測 29.1ms ~ 39.5ms（多次取樣），遠低於 500ms 門檻；無閃爍（用 `blockly-slide-in` CSS 動畫 0.3s ease 滑入） |
| **AC#4** | 狀態保留：切換時 drone 位置/計時/分數不重置 | ✅ PASS | 切換前 `alt=0.4 / timer=⏱5.8s` → 切換後 `alt=0.4 / timer=⏱6.6s`（計時繼續推進，無重置） |
| **AC#5** | 手動鎖定：程式執行中，鍵盤/搖桿輸入不影響 drone | ✅ PASS | 程式執行時 `body.class="mode-program program-running"`，鍵盤事件 dispatched 但 `applyManualControls()` 早退（`isManualLocked()` 為 true） |
| **AC#6** | 6 個關卡都支援 toggle（1-0 ~ 1-5） | ✅ PASS | 6 關 `data-level` 全部可點擊載入，每關 toggle 都正確切到 `mode-program` |
| **AC#7** | 無 console error | ❌ **FAIL** | 1 個 uncaught error：`Extension "contextMenu_variableDynamicSetterGetter" is already registered.` （見 Bug B-101-001） |

### 迴歸測試 (5/5 PASS)

| 關卡 | 載入 | 預設模式 | Blockly | Toggle | 結果 |
|---|---|---|---|---|---|
| 1-0 起飛 | ✅ | manual | none | 🕹 手動 | ✅ |
| 1-1 起降 | ✅ | manual | none | 🕹 手動 | ✅ |
| 1-2 轉彎 | ✅ | manual | none | 🕹 手動 | ✅ |
| 1-3 高度 | ✅ | manual | none | 🕹 手動 | ✅ |
| 1-4 小圈 | ✅ | manual | none | 🕹 手動 | ✅ |

### 程式碼品質 ✅
- 改動範圍合理：index.html +62 (CSS +1 button)、main.js +79 (MODE state machine + isManualLocked + joystick guard)
- 沒有破壞既有 API（v1.3 仍可載入 1-0~1-5）
- URL 參數設計乾淨：`?mode=manual|program` / `?autorun` / `?level=X`（若需要可加）

---

## 待修項目 ❌

### Bug B-101-001 — Blockly extension 二次註冊 uncaught error
**嚴重度**：🟡 **major**（AC#7 明確要求 0 console error，且錯誤看起來像 race condition 不該留著）
**環境**：Chrome 149 / Windows 11
**重現步驟**：
1. 啟動 server（`node server.js`）
2. 開啟 `http://localhost:3000/`
3. 打開 DevTools console
4. 等頁面載入完成

**預期**：console 0 error（最多只有 deprecation warning）
**實際**：console 噴 1 個 uncaught error：
```
Uncaught Error: Error: Extension "contextMenu_variableDynamicSetterGetter" is already registered.
```

**截圖**：`screenshots/review-t101-ac1-default.png`（載入完成時 console 已記錄此 error）
**console log**：
```
[error] Uncaught Error: Error: Extension "contextMenu_variableDynamicSetterGetter" is already registered.
```

**可能原因**：
v1.4 引入的 `safeBlocklyExt()` 包裹 `Blockly.Extensions.register`（main.js:946-960），檢查條件是：
```js
if (Blockly.Extensions._registry && Blockly.Extensions._registry.has(name)) {
    return;  // skip
}
```
但 Blockly 內部 `contextMenu_variableDynamicSetterGetter` 的註冊路徑不走 `_registry.has()` 這條 check（可能是被另一個 wrapper 攔截，或 Blockly 用私有屬性），所以 wrapper 沒攔到，Blockly 內部仍丟 exception。**v1.4 的 safeBlocklyExt 對此特定 extension 無效**。

**建議修法（給 coder 參考）**：
1. 用 try/catch 包 `Blockly.inject()` + 整個 init block，把 extension 註冊的 throw 降級為 warn
2. 或在 `safeBlocklyExt` 內同步設一個 `_seenExtensions = new Set()` 標記，即使 Blockly 內部丟錯也只 log 一次
3. 或在 HTML 載入順序調整：先載 main.js 模組，再 import Blockly 子模組（讓 wrapper 早於 Blockly 內部註冊）

**對 T-102/T-103 影響**：
- AC#1 / AC#7 受影響，但功能本身完全正常
- T-102 (action blocks) / T-103 (advanced blocks) 如果引入新 extension，**這個 bug 會擴大**（每加一個 extension 都有機會觸發）
- 強烈建議在 T-102 動工前先修掉

---

## 額外觀察（不影響過關）

1. **🟢 切換動畫滑入**：CSS `blockly-slide-in` 0.3s ease 對國小學生很友善，視覺上有「切到程式模式」的回饋
2. **🟢 HUD 模式徽章**：`#hud-mode` 即時更新（手動 ↔ 程式），學生看 HUD 即可知道目前模式
3. **🟢 Disabled 視覺**：`body.program-running` 讓 toggle 按鈕變灰，學生看得到「程式執行中不能切」
4. **🟡 Deprecated warning**：AC#5 測試時出現 1 個 Blockly 內部 deprecation warning（`CodeGenerator` 改成 `.forBlock[blockType]` 字典），非阻斷，可等 T-107 integration test 再統一清
5. **🟡 無 `?level=X` URL 參數**：測試時只能用 `.level-btn` click 切關卡，未來 headless test 工具鏈建議補上

---

## 結論

- [ ] ✅ 可以 ship 給 Sam
- [x] ⚠️ **修完 B-101-001 後可以 ship**
- [ ] ❌ 不建議 ship

**建議決策**：
1. PM 派 T-102 之前，**coder 先花 15 分鐘修 B-101-001**（避免錯誤在後續 task 擴大）
2. 修完後 reviewer 重跑 AC#7 確認 0 error
3. 通過後 PM 才 ship T-101 + 啟動 T-102 / T-103

**不建議路徑**：直接 ship T-101 + 啟動 T-102 — 因為 T-102 (action blocks) 會引入新 Blockly extensions，B-101-001 的 wrapper 缺陷會被放大，可能導致 T-102 的 AC#7 直接 fail。

---

## 附錄：測試 artifacts

- `C:\github\droneclassroom\docs\reports\T-101-review.json` — 完整測試結果 JSON（12 個 test case + console events）
- `C:\github\droneclassroom\review-t101.js` — 測試腳本（CDP-based，可重跑）
- `C:\github\droneclassroom\screenshots\review-t101-ac1-default.png` — 預設手動模式
- `C:\github\droneclassroom\screenshots\review-t101-ac2-toggled.png` — 切到程式模式
- `C:\github\droneclassroom\screenshots\review-t101-ac5-program-running.png` — 程式執行中
- `C:\github\droneclassroom\screenshots\review-t101-level-1-0.png` ~ `level-1-5.png` — 6 關切到程式模式
- `C:\github\droneclassroom\screenshots\v14-1~6.png` — coder 自己跑的 6 張
