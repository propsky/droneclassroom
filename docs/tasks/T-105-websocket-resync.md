# T-105 WebSocket 重連狀態同步

| 項目 | 內容 |
|---|---|
| **Task ID** | T-105 |
| **版本** | v1.4 |
| **優先** | P1 |
| **估時** | 0.5 天 |
| **截止** | 2026-06-27（週五）|
| **負責** | drone-coder |
| **測試** | drone-reviewer |
| **狀態** | pending |

---

## 目標

學生 client 斷線重連後，從 server 拉回「位置 / 關卡進度 / 計時 / 分數」完整狀態。

## 背景

v1.3 已知遺留問題（test-report-v1.3.md）：
> WebSocket 重連邏輯有基本實作，但斷線後的 state 同步未完整測試

6/22 課程可能會遇到網路不穩（iPad 在學校 Wi-Fi），重連後狀態丟失學生會挫折。

## 描述

### 1. Server 端
- 為每個 client session 保存「完整 state」：drone 位置/姿態/速度、當前關卡、計時、checkpoint 通過狀態、分數
- 定期 snapshot（每 1 秒）到記憶體
- Client 重連時，server 檢查 sessionId 是否還在記憶體

### 2. Client 端
- WebSocket 斷線後，每 3 秒自動重連（指數退避：3s → 6s → 12s，封頂 30s）
- 重連成功後，發送 `RESYNC` 訊息
- Server 收到 `RESYNC` 後回傳完整 state
- Client 套用 state，drone 位置/姿態、關卡、計時、分數全部恢復

### 3. UI 提示
- 斷線時 HUD 顯示「🔴 連線中斷，正在重連...」
- 重連成功顯示「🟢 已恢復」1 秒後淡出
- 學生不需手動重新整理

### 4. 過期處理
- 如果 client 斷線超過 5 分鐘，server 把 session 從記憶體清除
- 重連時 server 回 `SESSION_EXPIRED`，client 重新進關卡選擇畫面

## 驗收標準

1. **重連後 drone 位置/姿態正確**：3D 場景 drone 真的在原本位置
2. **重連後關卡進度正確**：穿過的圈還是已通過
3. **重連後計時不歸零**：繼續累計
4. **HUD 提示正確**：斷線/重連有視覺反饋
5. **過期處理正確**：斷線 > 5 分鐘，回關卡選擇
6. **無 console error**

## Sam 怎麼驗收

1. 進 Level 1-2，把 drone 飛到中段（穿過 1 個圈、計時 15 秒）
2. 拔網路線（或 `chrome://network-conditions` 模擬離線）
3. 看 HUD 顯示「連線中斷」
4. 5 秒後恢復網路
5. 看 HUD「已恢復」
6. 檢查 drone 位置/計時/圈圈狀態都還在

## 相依

- 無（獨立 task）

## 風險 / 注意

- WebSocket 連線狀態變化可能在 iPad Safari 有特殊行為 — 配合 T-106 一起測
- State snapshot 太頻繁會吃 CPU（> 1Hz 就要小心）
- 計時累計要區分「server 端時間」vs「client 端時間」，避免 client 改了系統時間作弊（國小雖然不會，但程式要嚴謹）

## 派工備註

coder 寫完後 PM 派 drone-reviewer 跑 5 個斷線/重連 case 測試。
