# CREAFLY 程式控制無人機 — 教室版（droneclassroom）

> 台灣 K-12 程式教育用無人機模擬器
> 維護：drone-pm / drone-coder / drone-reviewer 三人組

## 計畫狀態

| 版本 | 狀態 | 對應課程 |
|---|---|---|
| v1.2 | ✅ baseline（已 ship） | — |
| v1.3 | 🚧 開發中 | 6/22 第一堂課 |
| v1.4 | 📋 規劃中 | 6/29 第二堂課（Blockly 模式）|

詳細 roadmap：見 `docs/plan.md`（v1.3 開始維護）
任務清單：見 `docs/tasks/`

## 快速開始

```bash
# 安裝依賴（WebSocket 用）
npm install

# 啟動 dev server
node server.js

# 開瀏覽器
open http://localhost:3000/         # 學生端
open http://localhost:3000/teacher  # 老師後台（v1.3+）
```

## 檔案結構

```
droneclassroom/
├── index.html          # 學生端 UI
├── main.js             # 核心邏輯（3D 場景 + Blockly + 控制）
├── server.js           # Node.js dev server + WebSocket
├── favicon.ico
├── package.json
├── .gitignore
├── README.md
└── docs/               # PM 維護
    ├── plan.md         # 高階 roadmap
    └── tasks/          # 每個 task 一檔
```

## 技術 Stack

- **3D 渲染**：Three.js 0.162（CDN）
- **視覺化程式**：Blockly 10.4.3（CDN）
- **觸控搖桿**：nipplejs 0.10.2
- **物理**：自寫
- **Server**：Node.js + ws（WebSocket）
- **無 build step**、**無 bundler**、**無 TypeScript**

## License

MIT（forked from eccc20984/drone-simulator）
