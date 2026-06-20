# T-103 Blockly 進階積木（if / 迴圈 / 變數 / 時間型計時）

| 項目 | 內容 |
|---|---|
| **Task ID** | T-103 |
| **版本** | v1.4 |
| **優先** | P0 |
| **估時** | 1 天 |
| **截止** | 2026-06-25（週三）|
| **負責** | drone-coder |
| **測試** | drone-reviewer |
| **狀態** | pending |
| **設計決策** | 見 `decisions/ADR-001-distance-sensor-removed.md` — 距離感測類**砍掉**，改用時間型計時 |

---

## 目標

加入 4 類進階積木，讓學生能寫出「有判斷、有迴圈、有變數、有時間控制」的真程式。

## 背景

v1.3 沒有這些進階積木。v1.4 第二堂課（6/29）學生用 Blockly 寫程式過關時，會需要：
- **邏輯判斷**：例如「如果經過 3 秒就轉彎」
- **迴圈**：例如「重複前進 3 次」
- **變數**：例如「記住繞了幾圈」
- **時間控制**：例如「懸停 2 秒」「等 5 秒」

## ⚠️ 不做的（ADR-001）

- **距離感測類**（`distance to ...`、`while distance > X`）— 砍掉
- **自動找最近目標**（`nearest ...`）— 砍掉
- **穿過 ring 判定**（`passes through ring`）— 砍掉

理由：真實 CREAFLY 無人機無距離感測器，學了 v2.0 對接實機時用不到。改用時間型計時取代。

---

## 描述

### 1. 邏輯積木（Logic 類）
- `if (條件) then (動作)`
- `if (條件) then (動作1) else (動作2)`
- 條件積木：`=` `≠` `<` `>` `≤` `≥`
- 比較對象：數字、變數、計時值

### 2. 迴圈積木（Loops 類）
- `repeat (次數) (動作)`：重複 N 次
- `while (條件) (動作)`：當條件成立就重複
- `forever (動作)`：無限迴圈（小心 dead loop）

### 3. 變數積木（Variables 類）
- `set (變數) to (值)`
- `change (變數) by (增量)`
- 變數要可以新增/刪除/重新命名
- 預設變數建議：`count`（計數）、`time`（自訂時間）

### 4. **時間型計時積木（Timers 類 — 取代距離感測）**
- `elapsed (s)`：回傳從程式開始到現在的秒數（float）
- `wait (N s)`：暫停 N 秒（block 程式執行）
- `every (N s) do`：每 N 秒觸發一次（pseudo interrupt）
- `timer reset`：重設計時器回 0

### 5. 範例：時間控制版（取代原本的「距離感測」範例）

原本（已砍）：
```
while distance to nearest ring > 2:
  moveForward 0.5
```

改寫（推薦）：
```
set start to elapsed
while elapsed - start < 5s:
  moveForward 0.5
```

或更簡單：
```
repeat 10 times:
  moveForward 0.5
  wait 0.5s
```

### 6. 範例：計數 + if
```
set count to 0
repeat 5 times:
  moveForward 1
  set count to count + 1
if count = 5:
  land
```

---

## 驗收標準

1. **4 類積木都進 toolbox**：Logic / Loops / Variables / Timers（**無 Sensors 類**）
2. **每個積木可組合**：if 內可放條件+動作、loop 內可放動作
3. **簡單測試程式可執行**：
   - 寫：`repeat 3 times: moveForward 1`
   - 執行：drone 真的前進 3 次（每次 1 公尺）
4. **變數可設定/讀取**：
   - 寫：`set x to 5; moveForward x`
   - 執行：drone 前進 5 公尺
5. **時間型計時可運作**：
   - 寫：`set start to elapsed; while elapsed - start < 3s: moveForward 0.5`
   - 執行：drone 前進 ~3 秒（依速度約前進 1.5 公尺）後停
6. **無 console error / 無 dead loop 卡死**
7. **toolbox 內無「距離 / distance / nearest / ring」相關字眼**（grep 確認）

## Sam 怎麼驗收

1. 進 Level 1-1（v1.3 有圈圈的關卡），切到程式模式
2. 拖拉：`repeat 3 times: moveForward 1`，執行，drone 真的前進 3 次
3. 拖拉：`set x to 2; moveForward x`，執行，drone 前進 2 公尺
4. 拖拉：`set start to elapsed; while elapsed - start < 3s: moveForward 0.5`，執行，看 drone 飛 ~3 秒
5. 拖拉 `forever: moveForward 1`，執行，**測 30 秒 timeout**（避免 dead loop 卡死）

## 相依

- T-101（Blockly panel）
- T-102（基礎動作積木）

## 風險 / 注意

- **dead loop**：學生寫 `forever` 沒 break，drone 會飛個不停。coder 必須加 30 秒 timeout
- **`elapsed` 要 reset**：每個關卡開始 elapsed 應從 0 開始
- **`wait` vs 動作系統**：wait 期間 drone 不動作，但計時仍走
- **變數命名衝突**：Blockly 內建變數要避免跟 drone 內部變數衝突
- **迴圈 + 動作系統**：Blockly 生成的 JS 巢狀迴圈要正確 await

## 派工備註

coder 寫完後通知 PM，PM 派 drone-reviewer 跑 4 類積木的單元測試。Reviewer 確認 toolbox 內**無距離感測**相關字眼（grep main.js 跟 index.html 確認）。
