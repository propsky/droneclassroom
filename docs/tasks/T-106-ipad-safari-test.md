# T-106 iPad Safari 實機測試（Sam 跑）

| 項目 | 內容 |
|---|---|
| **Task ID** | T-106 |
| **版本** | v1.4 |
| **優先** | P0 |
| **估時** | 0.5 天（Sam 時間）|
| **截止** | 2026-06-28（週六）|
| **負責** | **Sam**（借 iPad 跑）|
| **測試** | Sam + drone-reviewer（遠端協助）|
| **狀態** | pending |

---

## 目標

在實體 iPad Safari 跑 v1.4 全功能，記錄任何 Safari-only bug。

## 背景

v1.3 test-report 點出：
> iPad Safari 還沒實機測過（無實體裝置）

v1.4 多了 Blockly panel + 雙模式 UI，觸控邏輯變複雜，必須實機測。

## 描述

### 1. 測試裝置
- iPad（型號不限，建議 iPad 8 以上）
- iOS 15 以上、Safari（不要用 Chrome iOS，行為不同）
- 連上跟 dev server 同一個 Wi-Fi

### 2. 測項（Sam 跑）

| # | 測項 | 預期結果 |
|---|---|---|
| 1 | 開 `http://<dev-server-ip>:3000` | 學生端載入，無白屏 |
| 2 | 登入（輸入顯示名稱）| localStorage 記住，重新整理不丟 |
| 3 | 進 Level 1-0，預設手動模式 | 觸控搖桿（左下）可控制 drone |
| 4 | 點 HUD toggle 切到「程式」| Blockly panel 從右側滑入 |
| 5 | 拖拉 3 個積木：起飛、前進 1、降落 | 積木可放置、可連接 |
| 6 | 點「執行」| drone 依序動作 |
| 7 | 程式執行中試著觸控搖桿 | 手動輸入無效（鎖定） |
| 8 | 切回手動模式 | 觸控搖桿恢復 |
| 9 | 進 Level 1-2 程式模式，寫：`repeat 3 times: moveForward 1` | drone 真的前進 3 次 |
| 10 | 寫：`while distance to nearest ring > 2: moveForward 0.5` | drone 自動走到圈圈 |
| 11 | 過關時間上報老師後台 | 開 `http://<ip>:3000/teacher` 看得到 |
| 12 | 重新整理頁面 | 計時歸零、drone 回起飛墊（重連不適用此 case）|
| 13 | **拔 Wi-Fi 5 秒再恢復** | HUD 顯示「斷線 / 重連」，重連後狀態恢復 |
| 14 | 6 個關卡各跑 1 次（程式 + 手動）| 全過 |
| 15 | console 檢查 | 無 error（warning 可記錄）|

### 3. 記錄格式
Sam 跑完後，**直接把測試結果貼給 PM**（drone-pm），格式：

```
T-106 iPad Safari 實機測試
============================
iPad 型號：
iOS 版本：
Wi-Fi 環境：

測項 1-15 結果（✅/❌ + 一句話描述）：

Bug 回報（如有）：
- ...
- ...
```

### 4. 如果有 bug
- PM 收到後立刻派 drone-coder 修
- 修完後 Sam 再跑一次受影響的測項
- 重複直到全 ✅

## 驗收標準

1. 15 個測項**全 ✅**
2. 任何 ❌ 都要修到 ✅ 才能進 T-107
3. console 無 error

## 相依

- T-101 ~ T-105 都完成
- dev server 跑得起來

## 風險 / 注意

- **iPad Safari 對 WebSocket 行為**：可能比 Chrome 嚴格
- **觸控 vs 滑鼠**：Blockly 拖拉在觸控可能卡
- **虛擬鍵盤**：輸入顯示名稱時可能擋 UI
- Sam 沒有 iPad 隨時可借 — **請 Sam 6/27 PM 前確認 iPad 可取得**

## 派工備註

這是 Sam 親自跑的 task。PM 在 T-101 ~ T-105 全部過了之後，會把「測項清單 + dev server URL」傳給 Sam，請 Sam 跑。
