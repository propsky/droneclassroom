# T-102 Blockly 動作積木（基礎 9 個）

| 項目 | 內容 |
|---|---|
| **Task ID** | T-102 |
| **版本** | v1.4 |
| **優先** | P0 |
| **估時** | 0.5 天 |
| **截止** | 2026-06-24（週二）|
| **負責** | drone-coder |
| **測試** | drone-reviewer |
| **狀態** | pending |

---

## 目標

把 drone 動作系統包成 9 個 Blockly 積木，學生可以拖拉組合。

## 背景

v1.3 main.js 已有 drone 動作 API（async/await 動作系統）。v1.4 要把這些 API 暴露為 Blockly 積木。

需要的積木清單（先讀 main.js 確認實際 API 名稱，必要時 coder 可微調 wrapper）：

| 積木 | 對應 API（推測） | 行為 |
|---|---|---|
| 起飞 (takeoff) | `drone.takeoff()` | 垂直上升到 1.5m |
| 降落 (land) | `drone.land()` | 緩降回地面 |
| 悬停 (hover) | `drone.hover(秒數)` | 在原地懸停 N 秒 |
| 前進 (moveForward) | `drone.moveForward(距離)` | 沿當前機頭方向前進 N 公尺 |
| 後退 (moveBackward) | `drone.moveBackward(距離)` | 後退 N 公尺 |
| 左移 (moveLeft) | `drone.moveLeft(距離)` | 左橫移 N 公尺 |
| 右移 (moveRight) | `drone.moveRight(距離)` | 右橫移 N 公尺 |
| 順時針旋轉 (rotateClockwise) | `drone.rotateClockwise(角度)` | 順時針轉 N 度 |
| 逆時針旋轉 (rotateCounterClockwise) | `drone.rotateCounterClockwise(角度)` | 逆時針轉 N 度 |

## 描述

### 1. 積木分類
在 Blockly toolbox 分類：
- **動作** (Action)：起飛 / 降落 / 懸停
- **移動** (Move)：前進 / 後退 / 左移 / 右移
- **旋轉** (Rotate)：順時針 / 逆時針

### 2. 積木設計
- 移動/旋轉積木都要有「距離/角度」輸入欄（預設 1.0 公尺 / 90 度）
- 輸入欄用 Blockly 數字欄位，可直接填數字
- 積木顏色：用 CREAFLY 配色（青綠 + 警示黃）

### 3. 中文標籤
- 國小 4-5 年級，**所有積木 label 用繁中**
- tooltip 也用繁中

### 4. 程式碼生成
- 每個積木生成對應的 JS 程式碼（async/await）
- Blockly → JS 編譯要正確處理非同步動作序列

## 驗收標準

1. **9 個積木都在 toolbox**：起飛、降落、懸停、前進、後退、左移、右移、順時針、逆時針
2. **每個積木可拖拉到工作區**
3. **每個積木 label 繁中**
4. **可填入距離/角度數字**
5. **簡單測試程式可執行**：
   - 起飛 → 前進 2 → 順時針 90 → 降落
   - drone 真的依序執行
6. **無 console error**
7. **動作系統不 crash**

## Sam 怎麼驗收

1. 進 Level 1-0，切到「程式」模式
2. 拖拉 5 個積木：起飛 → 前進 2 → 順時針 90 → 前進 1 → 降落
3. 點「執行」
4. 看 drone 是否真的起飛 → 前進 → 旋轉 → 前進 → 降落
5. 看 console 應該 0 error

## 相依

- T-101（Blockly panel 必須先啟用）

## 風險 / 注意

- main.js 的動作 API 名稱可能要從程式碼確認 — coder 第一步先 grep `takeoff|moveForward|rotateClockwise` 等關鍵字
- 如果動作是 async/await，Blockly 生成的 JS 要正確 await
- 動作系統的「單位」要統一（公尺、度、秒）

## 派工備註

coder 完成後 PM 派 drone-reviewer 跑 9 個積木的單元測試 + 整合測試。
