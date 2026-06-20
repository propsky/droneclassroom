# T-107 整合測試 + test report + 6/29 ship

| 項目 | 內容 |
|---|---|
| **Task ID** | T-107 |
| **版本** | v1.4 |
| **優先** | P0 |
| **估時** | 0.5 天 |
| **截止** | 2026-06-28 PM（週六）|
| **負責** | drone-pm + drone-reviewer |
| **狀態** | pending |

---

## 目標

v1.4 整合測試通過，產出 test-report-v1.4.md，git tag v1.4.0，準備 6/29 課程。

## 背景

T-101 ~ T-106 全部過了，進入最後整合。drone-pm 跟 drone-reviewer 一起把關。

## 描述

### 1. 整合測試（drone-reviewer 跑）
- 跑過所有 v1.3 test-report 的 case（避免 regression）
- 跑過 T-101 ~ T-105 的所有驗收標準
- 跑過 T-106 的 15 個測項（如 reviewer 沒實機，至少 review 截圖 / log）
- 6 個關卡 × 2 模式 = 12 個 case 全過
- 多人（雖然不壓力測）：2 個瀏覽器 + 1 個 teacher dashboard 同時跑

### 2. 跨瀏覽器
- Chrome（Win/Mac）
- Safari（Mac，模擬 iPad 用開發者工具）
- 不必 Edge / Firefox（target 是 iPad Safari + PC Chrome）

### 3. 截圖
- 學生端：首頁、Level 1-0 手動、Level 1-0 程式、Level 1-3 程式（複雜）、過關畫面
- 老師後台：dashboard、排行榜、廣播
- 存到 `docs/screenshots-v1.4/`

### 4. test report
- 寫 `docs/test-report-v1.4.md`
- 格式參考 `docs/test-report-v1.3.md`
- 列出所有 task 的驗收結果
- 列出 console 檢查
- 列出已知限制
- v1.4 ship 條件 checklist

### 5. Git tag
- 全部過了之後，drone-reviewer 打 `git tag v1.4.0`
- PM 確認 tag 推到 GitHub

### 6. 通知 Sam
- PM 通知 Sam：「v1.4 準備好，dev server 在 X，請 Sam 跑最後的視覺 / 體感測試」
- Sam 跑完沒問題 → 6/29 上線

## 驗收標準

1. 整合測試全 ✅
2. 截圖齊全
3. `test-report-v1.4.md` 寫好
4. `git tag v1.4.0` 推到 GitHub
5. PM 通知 Sam

## 相依

- T-101 ~ T-106 全 ✅

## 風險 / 注意

- 整合測試可能發現新 bug — 留 6/28 一整天緩衝
- 如果有 P0 bug 沒修完，6/29 課程要降級（v1.3 fallback）— 提前跟 Sam 講

## 派工備註

drone-pm + drone-reviewer 一起做，不是派給單一 agent。
