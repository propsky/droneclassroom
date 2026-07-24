# CREAFLY 教室版無人機模擬器 — 技術棧與系統架構

> 版本：2026-07-23｜維護：Dylan

## 一、系統架構總覽

```
                    學生（瀏覽器：PC / iPad / Mac）
                    老師（瀏覽器：後台儀表板）
                          │  HTTPS / WSS
        ┌─────────────────┴──────────────────┐
        ▼                                    ▼
  前端（靜態託管）                      後端（AWS EC2）
  Cloudflare Pages                    FastAPI（Docker 容器）
  ├ /         學生端模擬器             ├ REST API（關卡/設定/認證）
  └ /teacher/ 教師後台                 ├ WebSocket（名冊/廣播/多人賽局）
                                      ├ nginx-proxy + Let's Encrypt（自動 HTTPS）
                                      └ 賽局引擎（大亂鬥/足球，伺服器權威判定）
                                             │ 內網（規劃中）
                                             ▼
                                      PostgreSQL（AWS RDS）
                                      帳號/成績持久化（暫與 SmartPay 共用實例）
```

前後端完全分離：前端為純靜態產物（可放任何靜態託管），後端為單一 Docker 容器；
兩端只以 HTTPS/WSS 通訊，跨域以 CORS + Origin 白名單管控。

## 二、技術棧總表

| 層 | 技術 | 說明 |
|---|---|---|
| 3D 引擎 | **Babylon.js 8**（TypeScript 原生） | 場景渲染、內建 Inspector 除錯 |
| 物理 | 自研固定時步核心（60Hz）+ **Havok**（WASM） | 飛行手感自研；碰撞/機對機接觸走 Havok；介面抽象化，未來可換 Rapier/自研 Rust 核心 |
| 視覺化程式 | **Blockly 11** | 學生積木編程，生成碼沙箱化執行 |
| 前端語言/建置 | **TypeScript**（strict）+ **Vite** | 產物完全自足、零 CDN 依賴（教室斷網可用） |
| 後端框架 | **FastAPI**（Python 3.13） | REST + WebSocket 同一服務；Pydantic 全訊息驗證 |
| Python 工具鏈 | **uv** | 依賴管理與鎖定 |
| 資料庫 | **PostgreSQL**（AWS RDS） | 規劃中：帳號/成績；現階段賽局狀態為記憶體內 |
| 專案結構 | **pnpm workspaces monorepo** | 前端×2 + 後端 + 共用型別包，依賴嚴格隔離 |
| 共用契約 | `@creafly/shared`（純 TS 型別） | 關卡 schema、WS 協定——前後端同一份定義 |

## 三、部署架構

### 前端 — Cloudflare Pages
- **位置**：`droneclassroom.pages.dev`（過渡期掛於個人帳號，之後轉移公司帳號——前端為純靜態，遷移僅需改兩處設定，零代碼改動）
- **流程**：push `main` → Pages 自動 build（`pnpm build:pages`）→ 全球 CDN 上線
- 單一專案同時服務學生端（`/`）與教師後台（`/teacher/`）
- 費用：免費方案（靜態流量不限量）

### 後端 — AWS EC2（東京 ap-northeast-1）
- **機器規格**：`t4g.micro`（ARM Graviton2、2 vCPU、1 GB RAM）、Debian 13、Elastic IP 固定
- **執行方式**：Docker 容器（FastAPI）+ nginx-proxy（反代）+ acme-companion（Let's Encrypt 憑證自動簽發/續期）
- **網域**：`creafly-api.propskynet.com`（HTTPS/WSS）
- **安全**：SSH 22 port 完全不開放，管理與部署一律走 AWS SSM（IAM 認證、指令留有稽核紀錄）

### 資料庫 — AWS RDS PostgreSQL（規劃中，帳號系統里程碑進場）
- 暫定與 SmartPay 專案**共用同一 RDS 實例**（獨立 database，內網連線）以控制成本；
  流量成長後可無痛拆分獨立實例
- ORM/遷移：SQLAlchemy + Alembic

## 四、CI/CD 部署流程（全自動，push 即部署）

```
git push main（GitHub：propsky/droneclassroom）
 ├─ 前端：Cloudflare Pages 自動建置 → CDN 發佈（約 2 分鐘）
 └─ 後端（動到 apps/api 時）：GitHub Actions
      → 建置 Docker image（ARM）
      → 推送 AWS ECR（私有映像倉庫；自動清理舊版，僅存最新）
      → 透過 AWS SSM 通知 EC2 拉取新版並重啟容器（停機約 5–10 秒）
      → 機器執行輸出回傳至 Actions log，成敗一目了然
```

- 憑證管理：GitHub 僅存一組最小權限的 AWS 金鑰；EC2 端以 IAM Role 免密碼拉取映像
- 回滾：後端以 git revert 觸發自動重建部署（約 3–5 分鐘）；前端 Pages 內建歷史版本一鍵回滾

## 五、安全機制（現行）

- 老師端認證：短效簽名憑證機制（測試期暫時停用，正式帳號系統上線後接管）
- 全部進站訊息 Pydantic 型別驗證＋速率限制（60 則/秒）＋大小上限
- CORS 與 WebSocket Origin 白名單（僅放行前端網域）
- 防作弊：成績合理性驗證（伺服器對時）、多人位置限速/邊界驗證、可疑行為自動標記供老師查看
- 多人賽局判定全部伺服器權威（計分/碰撞/勝負）

## 六、後續規劃（依優先序）

1. **帳號系統 + RDS**：老師註冊/登入、班級管理、成績持久化（資料庫正式進場）
2. 關卡編輯器（複用現有 Babylon 場景與關卡 JSON schema）
3. 物理確定性驗證（Rapier / 自研 Rust 核心，競賽回放驗證用；介面已預留）
4. 前端轉移公司 Cloudflare 帳號（兩處設定，零代碼）
