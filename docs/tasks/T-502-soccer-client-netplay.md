# T-502 客戶端：多人足球連線 + 他人分身（隊色 + 前鋒標記）+ 窄邊隊伍視角

| 項目 | 內容 |
|---|---|
| **Task ID** | T-502 |
| **版本** | v1.5（足球多人）|
| **優先** | P0 |
| **估時** | 1 天 |
| **負責** | drone-coder |
| **測試** | drone-reviewer |
| **狀態** | ✅ 完成（`main.js` §16b + `index.html`，`validate-t502.js` 8/8 PASS）|
| **設計依據** | `docs/drone-soccer-design.md` §2.1、§2.2、§2.5、§3 |

---

## 目標

讓學生 client 進入「多人足球」模式：連上伺服器賽局、上報自己位置、即時看到場上其他 5 台無人機（**藍/紅隊色 + 前鋒標記**），並套用**窄邊定點隊伍視角**。

## 背景

- **大量可重用**：
  - Arena client 已有他人分身渲染（`main.js` §15，`arenaColorForId()` + `arena_players` 內插）、`arena_pos` 12Hz 上報、`handleArenaMessage()` 路由 → 足球比照改 `soccer_*`。
  - **單人足球已做好場景**：`buildSoccerField()`（場地 + 牆 + 中線 + 兩端 `makeGoalRing` 門 + 球形外框 `SOCCER.ball`）、窄邊相機（`SOCCER.active` 時的 camera 邏輯，見 §16 與 animate 內 `if (SOCCER.active && !cameraMode.fpv)`）。
- 入口：現有 `soccer-btn`（單人）旁，或同一顆鈕分流。多人足球為**新模式**，與單人練習、Arena、一般關卡互斥。

## 描述

### 1. 進入 / 離開多人足球
- `enterSoccerMatch()`：建立/重用足球場地（重用 `buildSoccerField()` 場景資源）、機體依護罩半徑畫、隱藏一般 HUD、送 `soccer_join`。
- `exitSoccerMatch()`：送 `soccer_leave`、清掉分身、還原相機/縮放/HUD。
- 狀態物件（client）：`soccerNet = { active, status, myTeam, myStriker, scores, endTime, players:Map }`。
- 與既有 `SOCCER`（單人）、`arena`（大亂鬥）互斥：進一個先退其他。

### 2. 位置上報
- running（或 countdown 後）每幀/節流 ~12Hz 送 `soccer_pos { x, y, z, yaw }`（仿 `arena_pos`）。
- 倒數中鎖定操控（沿用 `isManualLocked` 對 `SOCCER.status==='countdown'` 的處理，擴到足球賽局倒數）。

### 3. 他人分身渲染（隊色 + 前鋒標記）
- 收 `soccer_players` → 對每個非自己玩家建/更新分身（重用 Arena 分身建構 + 位置內插）。
- **顏色改為隊色**：藍隊一律藍、紅隊一律紅（不再用 `arenaColorForId` 的每人不同色）。
- **前鋒標記＝彩帶（已拍板）**：`striker=true` 的分身身上掛一條明顯的**彩帶 / 飄帶**（綁在機體上、隨隊色不同色調，例：藍隊前鋒亮黃彩帶、紅隊前鋒亮黃彩帶但底色不同），讓全場一眼認出攻擊手。**自己是前鋒**時自機也掛同款彩帶 + HUD 提示「🎀 你是前鋒（攻擊手）」。
  - 彩帶可用簡單做法：機體上方一個細長飄動的 plane / ribbon mesh，或機體外環加一圈醒目色帶；不需複雜布料物理。
- 名牌沿用 Arena 名牌（顯示 name）。

### 4. 窄邊定點隊伍視角
- 依 `myTeam` 設固定相機：站在該組場地的端線內側往場內看（紅隊 +z 端看 −z、藍隊相反）。高度跟場地走。座標以長軸為 z、場中心為原點，**與伺服器/場地常數對齊**。
- **定點**（不跟飛機跑）；預設跟隨視角，全場視角用 C 鍵切。
- `C` 鍵仍可切 FPV 當輔助（沿用 `cameraMode.fpv`）。
- 兩隊視角相反（面對面）。

### 5. 場地尺度
- 多人與單人練習用同一份 F9A 預設。預設 **F9A-A：14×7×5 m**。F9A-B 才是 6×3×3 m，要另外切子類。
- 場地常數（門 z、中線 z=0、門半徑、護罩、天花板高）與伺服器 `soccer_presets.py` **同一份**，由 `soccer_go` 下發。
- 窄邊視角站在該組場地的端線內側。

### 6. 收訊路由
- `handleSoccerMessage(msg)`：`soccer_state` / `soccer_go` / `soccer_countdown` / `soccer_players` / `soccer_scores` / `soccer_end`（比分/結束 UI 由 T-503 完成，本 task 先接好骨架 + 分身/視角）。
- WS `onopen` 重連後若 `soccerNet.active` → 重送 `soccer_join`（沿用 Arena 重連重加入模式，配合 T-105）。

## 驗收標準

1. **能進場**：點多人足球 → 連上賽局、送出 `soccer_join`、看到足球場地 + 兩端球門。
2. **看得到隊友/對手**：開 2 個以上 client，彼此**即時看到對方分身**（位置會動、有內插不抖）。
3. **隊色正確**：藍隊分身藍、紅隊分身紅；同隊同色。
4. **前鋒標記**：每隊前鋒分身有明顯標記；自己是前鋒時自機也有標記 + HUD 提示。
5. **窄邊視角**：相機定點在自隊端線內側，視線沿長軸看到近端門（守）+ 遠端門（攻）；兩隊視角相反。
6. **倒數鎖定**：3-2-1 倒數期間操控被鎖、倒數完恢復。
7. **互斥**：進多人足球會自動退出單人練習 / 大亂鬥 / 一般關卡。
8. **無 console error**。

## Sam 怎麼驗收

1. 開 2~4 個瀏覽器分頁，各自進「多人足球」。
2. 老師開賽（T-504）→ 看到 3-2-1 倒數、各 client 互相看得到對方飛機、隊色正確、前鋒有標記。
3. 飛動其中一台 → 其他 client 畫面上該分身同步移動。
4. 視角是窄邊定點、看得到兩個門；按 C 可切 FPV。

## 相依

- T-501（伺服器賽局 + 分隊 + 前鋒 + `soccer_players` 廣播）。

## 風險 / 注意

- **分身位置內插**：直接重用 Arena 的內插，避免 12Hz 看起來頓。
- **相機切換殘留**：進/出足球要乾淨還原相機（離開後別卡在窄邊視角）。
- **場地常數一致**：門 z / 中線 / 門半徑必須與 T-501 同一份，否則 T-503 計分判定錯位。
- iPad Safari：窄邊定點視角 + 觸控搖桿要一起測（併入後續實機測）。

## 派工備註

coder 完成後 PM 派 drone-reviewer 用 2+ client 驗收 1~8（位置同步可用 CDP 多分頁或多 client 腳本）。
