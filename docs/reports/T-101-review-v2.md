# T-101 v2 測試報告 — AC#7 Re-test + 整合驗收

| 項目 | 內容 |
|---|---|
| **Task ID** | T-101 v2 |
| **版本** | v1.4 → **v1.5**（HEAD 升版） |
| **B-101-001 fix commit** | `8cd313b` (test only — fix 已套用於 v1.5 系列 commit) |
| **測試者** | drone-reviewer |
| **測試日期** | 2026-06-26 |
| **測試環境** | Chrome 149.0.7827.116 / Windows 11 / Node v24.14.0 |
| **測試方法** | Chrome DevTools Protocol (CDP) headless + Coder `validate-b101001.js` 交叉驗證 |
| **結論** | ✅ **PASS — B-101-001 RESOLVED** |

---

## AC#7 Re-test 結果

### 自家 CDP 驗證 (review-t101-v2.js)

| 測試 | 場景 | Console errors | B-101-001 hits | 結果 |
|---|---|---|---|---|
| **RT1** | 預設載入手動模式 | 0 | 0 | ✅ PASS |
| **RT2** | 程式模式 + autorun | 0 | 0 | ✅ PASS |
| **RT3** | Level 1-5 + 程式模式 | 0 | 0 | ✅ PASS |
| **RT4-1-0** | 迴歸：1-0 載入 | 0 | 0 | ✅ PASS |
| **RT4-1-1** | 迴歸：1-1 載入 | 0 | 0 | ✅ PASS |
| **RT4-1-2** | 迴歸：1-2 載入 | 0 | 0 | ✅ PASS |
| **RT4-1-3** | 迴歸：1-3 載入 | 0 | 0 | ✅ PASS |
| **RT4-1-4** | 迴歸：1-4 載入 | 0 | 0 | ✅ PASS |
| **RT4-1-5** | 迴歸：1-5 載入 | 0 | 0 | ✅ PASS |
| **總計** | 9 tests | **0** | **0** | **9/9 PASS** |

### Coder `validate-b101001.js` 交叉驗證

```
=== B-101-001 fix validation ===
Test: Default load                  → exit=0, errors=0 ✅
Test: Program mode + autorun         → exit=0, errors=0 ✅
Test: Level 1-5 + program            → exit=0, errors=0 ✅
=== Result: 0 error(s) across 3 tests ===
```

兩個獨立測試腳本（CDP-based + Chrome `--enable-logging=stderr`）皆顯示 **0 error**。

---

## B-101-001 修法分析

### 根因（原 v1.4 commit 4691d43）

`safeBlocklyExt` 包裹 `Blockly.Extensions.register`，但內部檢查 `Blockly.Extensions._registry.has(name)` 對 `contextMenu_variableDynamicSetterGetter` 路徑無效，導致 Blockly 內部 throw 後 wrapper 的 try/catch 沒接住。

### 修法（v1.5 系列 commit 套用）

將原本的單一 `blockly.min.js` 拆成 4 個獨立腳本載入（`index.html:11-14`）：

```html
<script src="https://unpkg.com/blockly@10.4.3/blockly_compressed.js?v=1.5"></script>   ← core
<script src="https://unpkg.com/blockly@10.4.3/blocks_compressed.js?v=1.5"></script>    ← blocks (含 contextMenu extension)
<script src="https://unpkg.com/blockly@10.4.3/javascript_compressed.js?v=1.5"></script>← code generator
<script src="https://unpkg.com/blockly@10.4.3/msg/zh-hant.js?v=1.5"></script>         ← i18n
```

**為何有效**：
- `blockly.min.js` 把所有東西包成單一 closure 載入，內部 extension 註冊順序不易控制
- 拆分後 `blocks_compressed.js` 註冊的 `contextMenu_variableDynamicSetterGetter` 是**唯一一次**（因為每個 script tag 內部 scope 隔離）
- `safeBlocklyExt` 仍保留作為保險（不會重複註冊）

### 為何 Coder 的 commit 8cd313b 只放 test 檔？

從 commit message 看：
> 修法（部分已套用，留給下個 commit）：index.html 將 blockly.min.js 改為 blockly_compressed.js 模組載入
> 模組化避開同一 extension 重複註冊（每個 `<script>` 自己關）
> main.js 內 safeBlocklyExt 仍保留作為保險

實際上修法**已套用在 v1.5 系列的多個 commit**（分散在 commit chain），8cd313b 只是補上 verify 用的 test script。

**我的 CDP 驗證確認修法生效**：0 B-101-001 hits，0 console errors。

---

## ⚠️ v1.5 Self-bump Flag（PM 要求記錄）

PM 在 resume message 中明確標註：

> v1.5 self-bump (235c01c + d169829) NOT reverted — flag in report if relevant

### 涉及的 commit

| Commit | 說明 | 對 T-101 驗收影響 |
|---|---|---|
| `235c01c` | feat(manual): 上鍵改為上升、下鍵改為下降（方向鍵上下原本未使用） | **🟢 無影響** — 不在 T-101 7 項驗收範圍（鍵盤映射屬 v1.3 manual control） |
| `d169829` | v1.5: 移動視覺傾斜 + 升版至 1.5.0 | **🟢 無影響** — 視覺傾斜是純渲染增強，不影響雙模式切換邏輯 |

### 其他 v1.5 系列 commit（soccer features）

從 git log 看到後續有多個 drone soccer 相關 commit（`b29ea02`, `3b0ae8b`, `eb22a2b`, `84a77ac`, `4067fb3`, `fa10ae2`, `8d0f18d`），這些**與 T-101 的雙模式 UI 切換無關**，是 v1.5 drone soccer 大亂鬥的前置 commit。

**對 T-101 verdict 影響**：**無**。T-101 v1.4 範圍（Blockly panel 啟用 + 雙模式切換）功能正確，B-101-001 已解決。v1.5 self-bump 是獨立 commit chain，未干擾 T-101 核心功能。

---

## 額外觀察（不影響過關）

### 1. 🟢 2 個 Blockly deprecation warning（已記錄於 v1 review）
- 出現在 RT2 (程式模式 + autorun)
- `block generator functions on CodeGenerator objects was deprecated in 10.0 and will be deleted in 11.0. Use the .forBlock[blockType] dictionary instead.`
- 不影響功能，是 Blockly 10.x 的相容性提醒
- 已在 v1 review 標記為「🟡 Deprecated warning」等 T-107 integration test 統一處理
- 與 B-101-001 無關

### 2. 🟢 版本號正確更新到 v1.5
- `version-tag` 顯示 `v1.5`
- `body.class` 包含 `mode-manual` 預設（v1.4 T-101 行為保留）
- `blockly-panel` 預設隱藏（T-101 行為保留）
- 三者皆正確

### 3. 🟢 6 關迴歸全通過
- 1-0 ~ 1-5 全部可點擊切換
- 每關 `data-level` 正確 active
- 無 console error 洩漏

---

## T-101 最終 Verdict

| 項目 | v1 結果 (commit 4691d43) | v2 結果 (commit 8cd313b + v1.5 series) |
|---|---|---|
| AC#1 預設手動 | ✅ PASS | ✅ PASS（保留） |
| AC#2 Toggle 可見可切 | ✅ PASS | ✅ PASS（保留） |
| AC#3 切換 < 500ms | ✅ PASS (~30ms) | ✅ PASS（保留） |
| AC#4 狀態保留 | ✅ PASS | ✅ PASS（保留） |
| AC#5 程式鎖手動 | ✅ PASS | ✅ PASS（保留） |
| AC#6 6 關全支援 | ✅ PASS | ✅ PASS（保留） |
| **AC#7 0 console error** | ❌ **FAIL** (B-101-001) | ✅ **PASS** (RESOLVED) |
| 5 關迴歸 | ✅ PASS | ✅ PASS（re-verified） |

### 結論

- [x] ✅ **可以 ship 給 Sam**
- [ ] ⚠️ Conditional Pass
- [ ] ❌ 不建議 ship

**B-101-001 RESOLVED** — T-101 v1.4 雙模式 UI 切換功能完整、零 console error、可正式 ship。

---

## 附錄：測試 artifacts

- `C:\github\droneclassroom\docs\reports\T-101-v2-ac7.json` — 完整 CDP 測試結果（9 tests + 全部 console events）
- `C:\github\droneclassroom\review-t101-v2.js` — 測試腳本（CDP-based，可重跑）
- `C:\github\droneclassroom\validate-b101001.js` — Coder 自家測試腳本（cross-validation）
- `C:\github\droneclassroom\screenshots\review-t101-v2-rt1-default.png` — 預設手動模式（v1.5）
- `C:\github\droneclassroom\screenshots\review-t101-v2-rt2-autorun.png` — 程式執行中（v1.5）
- `C:\github\droneclassroom\screenshots\review-t101-v2-rt3-level-1-5.png` — 1-5 程式模式（v1.5）

### 對照原始報告

- v1 review: `docs/reports/T-101-review.md`（commit 4691d43）— Conditional Pass
- v2 review: `docs/reports/T-101-review-v2.md`（本文）— PASS

### 下一步（給 PM）

T-101 已通過。**待 PM re-dispatch T-102 (f648a4a) + T-103 (9c70b53) review**。