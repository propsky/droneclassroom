# v1.4 整合測試報告（T-107）

| 項目 | 內容 |
|---|---|
| **版本** | v1.4（核心功能）— 工作樹版號已升至 1.5.0 |
| **Baseline commit** | `ba96c61`（HEAD，T-104 完成點）|
| **Git tag** | `v1.4.0`（標於 ba96c61）|
| **彙整者** | drone-pm |
| **日期** | 2026-06-27 |
| **測試環境** | Chrome 149.0.7827.116 / Windows 11 / Node v24.14.0 |
| **方法** | 彙整 T-101~T-104 各別 review 報告（CDP headless 截圖 + console 檢查）|
| **結論** | ✅ **核心功能（T-101~T-104）全數 PASS，可 ship 給 6/29 W2 課程** |

---

## ⚠️ 版本說明（重要）

v1.4 的開發過程中，工作樹已先行疊上 v1.5 的功能（足球 / 大亂鬥 / 藍牙搖桿 / 移動傾斜），
版號字串（`main.js` `APP_VERSION` 與 `index.html` version-tag）已是 **1.5.0**。
因此 `v1.4.0` tag 標記的是「**v1.4 範圍全部 task 驗收完成的 baseline**」，
而非一個版號 = 1.4.0 的乾淨節點。各 review 已交叉確認 v1.5 的 self-bump commit
（`235c01c` 鍵盤映射、`d169829` 移動傾斜、`b29ea02` 等 soccer commit）
**未干擾** T-101~T-104 的雙模式 / Blockly 功能（詳見 `T-101-review-v2.md` self-bump flag 分析）。

---

## Task 驗收總表

| Task | 內容 | AC | 結果 | Review 報告 | Commit |
|---|---|---|---|---|---|
| **T-101** | Blockly panel + 手動/程式雙模式切換 | 7/7 | ✅ PASS | `reports/T-101-review-v2.md` | 4691d43 → v1.5 series |
| **T-102** | 9 個基礎動作積木 | 7/7 | ✅ PASS | `reports/T-102-review.md` | `f648a4a` |
| **T-103** | 進階積木（邏輯/迴圈/變數/時間）+ ADR-001 砍距離感測 | 7/7 | ✅ PASS | `reports/T-103-review.md` | `9c70b53` |
| **T-104** | 6 關（1-0~1-5）× 雙模式 = 12 case | 16/16 | ✅ PASS | `reports/T-104-review.json` | `ba96c61` |
| **T-105** | WebSocket 重連狀態同步 | — | ⚠️ 部分完成 | （無）| — |
| **T-106** | iPad Safari 實機測試（Sam 跑）| — | ⛔ 待 Sam | （無）| — |
| **T-107** | 整合測試 + test-report + tag | — | 🟡 本文 | 本文 | — |

---

## 已驗證的關鍵結果

### T-101 — 雙模式切換（commit B-101-001 已修復）
- AC#1 預設手動、AC#2 toggle 可見、AC#3 切換 < 500ms（實測 ~30ms）、AC#4 狀態保留、AC#5 程式鎖手動、AC#6 6 關全支援：全 PASS（v1 已過）
- AC#7 0 console error：v1 因 B-101-001（Blockly extension 重複註冊）FAIL → v2 **RESOLVED**
- 修法：`index.html` 把 `blockly.min.js` 拆成 4 個獨立 `<script>`（core/blocks/javascript/zh-hant），每個 script scope 隔離 → `contextMenu_variableDynamicSetterGetter` 只註冊一次
- v2 re-test：9/9 test 0 error、0 B-101-001 hits（CDP + coder validate-b101001.js 交叉驗證）

### T-102 — 9 動作積木
- cf_takeoff / cf_land / cf_hover / cf_forward / cf_backward / cf_left / cf_right / cf_rotate_cw / cf_rotate_ccw 全在 toolbox
- 8 categories 全繁中 + emoji；預設值對國小友善（DIST=2m、ANGLE=90°、HEIGHT=8m、SEC=1s）
- 4 test 0 console error

### T-103 — 進階積木 + ADR-001
- 4 類（邏輯/迴圈/變數/時間）全進 toolbox，**無 Sensors 類**
- 5 個新 block：cf_forever（內建 30s timeout 防 dead loop）/ cf_elapsed / cf_wait / cf_every / cf_timer_reset
- ADR-001 驗證：grep 確認無「distance to / nearest / passes through ring」Blockly 積木（main.js 內的 distanceTo 為純 Three.js 數學運算，未暴露為積木）
- 93 個 block types，0 bad keyword

### T-104 — 6 關雙模式
- 1-0~1-5 各 manual + program 共 12 case 全載入無 error
- AC#4 模式切換計時不重置（0.0s 保持）、AC#7 連跑 6 關 × 2 模式後 heap=27MB 無 leak、Blockly + drone 物件存活
- 1-4 確認有 3 rings（6/22 fix 3109637）
- 16/16 PASS，0 error

---

## Console 檢查

- **0 console error** across T-101(9) + T-102(4) + T-103(4) + T-104(16) 測試
- **2 個 Blockly deprecation warning**（`forBlock[blockType]` 字典風格，Blockly 10.x 相容提醒）
  — 不影響功能，列入後續 cleanup backlog（非 ship blocker）

---

## v1.4 ship 條件 checklist

- [x] T-101 雙模式切換 — PASS
- [x] T-102 9 動作積木 — PASS
- [x] T-103 進階積木 + ADR-001 — PASS
- [x] T-104 6 關雙模式 — PASS
- [x] 0 console error（核心功能）
- [x] `test-report-v1.4.md`（本文）
- [x] `git tag v1.4.0`
- [ ] T-105 WebSocket 重連完整同步 — **部分完成**（見下方已知限制）
- [ ] T-106 iPad Safari 實機測試 — **待 Sam 跑**（需借實體 iPad）
- [ ] tag 推到 GitHub — 待 Sam 確認後 `git push origin v1.4.0`

---

## 已知限制 / 未完成

1. **T-105 WebSocket 重連只做了基本款**：
   - 現況（`main.js:3696` scheduleReconnect）：斷線固定 3 秒重連一次，成功後只重新註冊 + 若在大亂鬥則重新 join。
   - spec 尚缺：指數退避（3→6→12→30s）、`RESYNC` 訊息、server 端 session snapshot（位置/姿態/關卡/計時/分數）、重連後狀態復原、`SESSION_EXPIRED`（>5 分鐘）、HUD 斷線/已恢復提示。
   - 影響：6/29 課程若 iPad Wi-Fi 不穩，重連後 drone 位置/計時/過圈進度不會復原（只會重連、保住連線）。建議課堂上避免靠網路保存進度。

2. **T-106 未跑**：Blockly 拖拉在 iPad Safari 觸控的實機行為未驗證（CDP 為桌面 Chrome）。上課前建議 Sam 至少跑一次 T-106 的 15 測項。

3. **Blockly deprecation warning ×2**：非 blocker，待 cleanup。

---

## 測試 artifacts

- Review 報告：`docs/reports/T-101-review-v2.md`、`T-102-review.md`、`T-103-review.md`、`T-104-review.json`、`T-102-103-review.json`
- 截圖：`screenshots/review-t10*.png`（T-101 v2 ×3、T-102 ×3、T-103 ×1、T-104 ×12）
- 測試腳本：`review-t101-v2.js`、`review-t102-103.js`、`validate-b101001.js`
- v1.3 baseline：`docs/test-report-v1.3.md`
