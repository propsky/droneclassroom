# CREAFLY 設計系統

> 學生端（simulator）與教師後台（teacher）共用的視覺規範。
> 目標：一致、乾淨、有產品感；**不是**重新發明——是把現有深色 + CREAFLY 青的方向做到位。
> 鐵律：離線教室環境 → **零 CDN**（字體用系統堆疊、圖標用內嵌 SVG）。

## 1. 現況審視（2026-07-16，重構動機）

| 問題 | 位置 | 對策 |
|---|---|---|
| header 八顆按鈕擠成一排、全部同權重、全部帶 emoji | simulator header | 分組（模式切換 ↔ 工具 ↔ 設定）、主次分明、emoji → SVG 圖標 |
| 「emoji + 漸層 + 大圓角」堆疊 = AI 味主要來源 | 全站按鈕/HUD 標題 | 鉻件去 emoji；漸層只留品牌主按鈕一處；圓角統一 |
| HUD 卡片間距/圓角/字級各自為政 | 狀態 HUD、任務 HUD、計分板 | 統一 card 元件規格 |
| 右下角入口按鈕（足球對戰/練習/大亂鬥）疊在控制說明上 | scene overlay | 定義 overlay 安全區與錨點格線 |
| 標題/內文/數字字級無層級 | 全站 | type scale 五級 |
| 按鈕大小不一（同列高度不同） | teacher 控制列 | 控件高度制度（32/40/48） |

## 2. Design Tokens（CSS custom properties，兩 app 共用同一份定義）

```css
:root {
  /* 色彩 — 品牌 */
  --brand:        #00A3E0;  /* CREAFLY 青（不變） */
  --brand-strong: #0284C7;
  --accent:       #1B998B;  /* 綠（成功/過關） */
  --warn:         #FFCE00;  /* 黃（提示/計時） */
  --danger:       #F43F5E;  /* 紅（停止/錯誤/鬼） */

  /* 色彩 — 深色介面階梯（背景到前景，一律用階梯，不准隨手寫色碼） */
  --bg-0: #0B1220;   /* 頁面底 */
  --bg-1: #101A2C;   /* 面板 */
  --bg-2: #16233A;   /* 卡片 */
  --bg-3: #1E2F4D;   /* 懸浮/hover */
  --line:   rgba(148,163,184,.16);  /* 邊線（可見但不搶） */
  --text-1: #F1F5F9;  /* 主文字 */
  --text-2: #94A3B8;  /* 次要文字 */
  --text-3: #64748B;  /* 弱化/標籤 */

  /* 字體 — 系統 CJK 堆疊（零 CDN；教室斷網也一致） */
  --font: "PingFang TC","Noto Sans TC","Microsoft JhengHei",
          -apple-system,"Segoe UI",sans-serif;
  --font-mono: "SF Mono",ui-monospace,Menlo,monospace; /* 數字/座標/計時 */

  /* 字級（五級制，不准出現制度外字級） */
  --fs-xs: 12px; --fs-sm: 13px; --fs-md: 15px; --fs-lg: 18px; --fs-xl: 24px;

  /* 間距（4px 基準制：4/8/12/16/24/32，不准出現 5px、10px、18px 這類散值） */
  --sp-1: 4px; --sp-2: 8px; --sp-3: 12px; --sp-4: 16px; --sp-5: 24px; --sp-6: 32px;

  /* 圓角（兩級制 + 圓） */
  --r-sm: 8px;   /* 控件：按鈕/輸入框/tag */
  --r-md: 12px;  /* 容器：卡片/modal/HUD */
  --r-full: 999px;

  /* 陰影（兩級制） */
  --shadow-1: 0 2px 8px rgba(0,0,0,.35);
  --shadow-2: 0 12px 32px rgba(0,0,0,.5);

  /* z-index 制度（不准隨手寫 9999） */
  --z-hud: 10; --z-overlay-btn: 20; --z-modal: 100; --z-toast: 200;
}
```

## 3. 元件規格

### 按鈕（三種，全站不准出現第四種）
- **primary**：`--brand` 實色底、白字、`--r-sm`、高度 40（後台主操作 44）。全畫面同時最多一顆。
- **ghost**：透明底 + `--line` 邊、`--text-1` 字；hover 換 `--bg-3` 底（**顏色過渡，不准 scale 位移**）。
- **danger**：僅「停止比賽 / 廣播重置」等破壞性操作；`--danger` 邊+字，hover 實色底。
- 圖標一律 **16×16 內嵌 SVG**（Lucide 線稿風、stroke 1.75），與文字間距 `--sp-2`；**鉻件禁用 emoji**。
- 所有可點元素 `cursor:pointer` + `transition: background-color .18s, border-color .18s`。

### HUD 卡片（學生端場景浮層）
- `--bg-1` @ 92% 不透明 + `backdrop-filter: blur(8px)`、`--r-md`、內距 `--sp-3 --sp-4`、`--shadow-1`。
- 標題列：`--fs-xs`、`--text-3`、字距 +0.05em、**無 emoji**；數值用 `--font-mono` `--fs-lg`。
- 錨點格線：四角各 `--sp-4` 安全邊距；同角多卡片以 `--sp-3` 垂直堆疊，**禁止重疊**（右下入口按鈕群與控制說明分欄）。

### Modal / Overlay
- `--bg-1` 實色（不透明 ≥ 96%）、`--r-md`、`--shadow-2`、外框 1px `--line`；背景遮罩 `rgba(4,10,20,.7)`。
- 內距 `--sp-5`；標題 `--fs-xl`；主按鈕靠右。

### Toast
- 底部置中、`--bg-2`、`--r-sm`、`--shadow-1`；狀態以 3px 左邊線著色（成功 `--accent`/警告 `--warn`/錯誤 `--danger`）。**內容 emoji 允許**（這裡是溫度所在）。

### 教師後台
- 佈局：12 欄、內容 `max-width: 1200px`、頁面內距 `--sp-5`。
- 統計卡（頂列三張）：`--bg-2`、數值 `--font-mono --fs-xl`、標籤 `--fs-xs --text-3`。
- 表格：列高 44、斑馬 `--bg-1/--bg-2`、hover `--bg-3`；名次前三用**左側 3px 色條**（金銀銅），不整列上色（現況整列金色太吵）。
- 分頁 tab：底線式（active 2px `--brand` 底線 + `--text-1`），不做膠囊漸層。

## 4. 圖標系統
- Lucide 線稿 SVG **內嵌**（`icons.ts` 匯出 innerHTML 字串或 `<symbol>` sprite 內嵌於 index.html），零外連。
- 需求清單：play/square(停止)/rotate-ccw(重置)/flag(比賽)/gamepad/bluetooth/home/volume/music/eye/expand/settings(校正)/log-out/trophy/users/target(前鋒)/swap(換隊)/timer/wifi/alert-triangle(⚠️ 改此)/map(關卡)/pencil(畫筆)。
- 規格：`viewBox 24`、顯示 16 或 20、`stroke: currentColor`。

## 5. 動效
- 過渡一律 150–250ms ease；hover 只變色/邊/陰影，**不位移不縮放**。
- `@media (prefers-reduced-motion: reduce)` 全部關閉。
- 倒數/得分等遊戲事件動效保留（那是回饋，不是裝飾）。

## 5.1 教師後台版面結構（2026-07-17 修訂 — 上一版只換了樣式沒動架構，不合格）

```
┌ topbar：品牌字標 ＋ 連線狀態膠囊（含學生數）───────────── 登出 ┐
│ 左欄 380px 固定（名冊常駐）      │ 右欄彈性（操作區）           │
│ ┌ 學生名冊卡 ──────────────┐   │ ┌ tab：關卡｜大亂鬥｜足球 ─┐ │
│ │ 卡頭：標題＋人數           │   │ │ ┌ 分區卡片（每卡固定結構）│ │
│ │ 連線位址列（點擊複製）      │   │ │ │ 卡頭：標題＋狀態/停止   │ │
│ │ 緊湊表格                  │   │ │ │ 控件區：label 在上、    │ │
│ └──────────────────────────┘   │ │ │   同列同高、8px 格線    │ │
│（名冊永遠看得到＝老師的儀表核心） │ │ │ 動作列：右對齊          │ │
│                                │ │ │   [ghost…] [primary]   │ │
│                                │ │ └───────────────────────┘ │
└────────────────────────────────┴───────────────────────────┘
```

**按鈕擺放鐵律**（回應「按鈕不應隨意放置」）：
1. 每張卡片只有一條**動作列**（卡片底部、右對齊）：primary 永遠最右、ghost 依重要性向左排；**控件區內不准出現按鈕**
2. **danger（停止比賽）不進動作列**——它是「進行中狀態」的操作，放在**卡頭右側**與狀態膠囊並排（賽局進行中才出現），語意是「對目前狀態的干預」而非「發起新動作」
3. 賽局進行中：卡頭顯示狀態膠囊（● 進行中 + mono 倒數）；開始類按鈕 disabled，不隱藏（版面不跳動）
4. 表單控件 label 一律在上方（`--fs-xs --text-3`）、控件同列同高 40、欄距 `--sp-3`

**教師後台鉻件與內容一律零 emoji**：這是專業工具不是遊戲畫面。學生的動物 emoji 是身分資料 → 收進 **avatar chip**（24px 圓底 `--bg-3`，emoji 置中 14px），與名字並排；不准裸排在文字裡。toast 純文字。

## 5.2 操作說明卡（學生端）

- 按鍵用 **kbd 鍵帽元件**：`--bg-3` 底、1px `--line`、`--r-sm` 4px、mono `--fs-xs`、內距 2px 8px
- 兩欄格線：左鍵帽（右對齊、固定欄寬）→ 右動作說明（`--text-2`）；分組（移動｜升降/旋轉｜其他）用 `--text-3` 小標分隔
- 可收合：卡頭點擊收成一行「操作說明」；預設展開，收合狀態記 localStorage

## 5.3 賽局結束倒數（浮動）

- 觸發：arena / soccer 依 server `endTime` 剩 **10 秒**時出現
- 位置：畫面頂部置中（不擋準星/機身視野）；chip 樣式：`--bg-1`@85% + blur、mono `--fs-xl`、`--warn` 色
- 10→4 秒：靜態小 chip，每秒數字更新（淡入替換，不彈跳）
- **3→1 秒：放大 1.4 倍、轉 `--danger` 色、每秒一次輕脈衝**（scale 1.4→1.45→1.4，200ms）＋ 短促滴聲（沿用 Web Audio）
- 0 秒：chip 淡出，交棒給結算 UI；`prefers-reduced-motion` 時只變色不縮放

## 6. 不做的事（防再度 AI 味）
- 不引入新字體檔、不加玻璃彩虹漸層、不加粒子/光暈背景。
- 鉻件不用 emoji；不同層級不共用同一種按鈕；圓角/字級/間距不出現制度外數值。
- 學生端遊戲入口（足球/大亂鬥）可以醒目，但用「色彩 + 圖標」表達，不用三重漸層。
