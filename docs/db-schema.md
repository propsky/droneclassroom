# 資料庫設計（PostgreSQL 16 · SQLAlchemy 2 · Alembic）

> 原則：**先夠用、不過度設計、可擴充、有稽核**。7 張表起步。
> 對齊產品模型：學校（租戶）→ 老師 → 賽隊/班級（team code）→ 學生 → 關卡進度；
> 訪客不登入可玩基本關卡不記錄；有 team code 才記錄與專屬內容（後續）。

## 1. 總覽

```
organizations ─┬─ teachers ─┬─ sessions（老師/學生共用）
               │            └─ teams ─┬─ students ─┬─ progress
               │                      │            └─ sessions
               │                      └─（之後）team_levels / matches
               └─ audit_events（稽核，全域）
```

所有表：`snake_case`、`BIGINT GENERATED ALWAYS AS IDENTITY` 主鍵、`TIMESTAMPTZ`、`TEXT` 不用 varchar(n)、FK 欄位必建索引、狀態欄用 TEXT + CHECK（不用 enum 型別，未來改值不用 migration 動型別）。

## 2. 各表

### organizations — 學校 / 單位（租戶邊界 = 計費與權限邊界）
| 欄位 | 型別 | 說明 |
|---|---|---|
| id | bigint identity PK | |
| name | text NOT NULL | |
| slug | text NOT NULL UNIQUE | 短代號（URL/報表用，小寫英數-） |
| plan | text NOT NULL DEFAULT 'trial' CHECK in ('trial','school','enterprise') | 方案；計費細節未來另表 |
| settings | jsonb NOT NULL DEFAULT '{}' CHECK jsonb_typeof='object' | 租戶層設定（選配屬性放這，不為每個開關加欄位） |
| created_at / updated_at | timestamptz NOT NULL DEFAULT now() | |
| deleted_at | timestamptz NULL | 軟刪除（租戶資料不硬刪） |

起步時建一個預設 org（`slug='default'`），所有老師先掛這裡；賣第二間學校時才真正用到多租戶。

### teachers — 老師帳號
| 欄位 | 型別 | 說明 |
|---|---|---|
| id | bigint identity PK | |
| org_id | bigint NOT NULL FK organizations | 索引 |
| email | text NOT NULL | 唯一索引在 `LOWER(email)`（大小寫不敏感） |
| password_hash | text NOT NULL | argon2id |
| name | text NOT NULL | |
| role | text NOT NULL DEFAULT 'teacher' CHECK in ('teacher','org_admin') | org_admin 可管同校老師；平台管理員不在此表（走環境設定/獨立機制，不過度設計） |
| status | text NOT NULL DEFAULT 'active' CHECK in ('active','disabled') | 停權不刪帳 |
| created_at / updated_at | timestamptz | |
| last_login_at | timestamptz NULL | |

### teams — 賽隊 / 班級（= 現在的 Room 持久化）
| 欄位 | 型別 | 說明 |
|---|---|---|
| id | bigint identity PK | |
| org_id | bigint NOT NULL FK organizations | 索引（租戶隔離查詢用） |
| owner_teacher_id | bigint NOT NULL FK teachers | 索引；建隊老師 |
| name | text NOT NULL | 「三年二班」「飛鷹隊」 |
| team_code | text NOT NULL UNIQUE | 固定加入碼（4–6 碼，去 0/O/1/I；對應現在 Room.code） |
| join_password_hash | text NULL | 加入密碼（選配） |
| max_students | integer NOT NULL DEFAULT 30 CHECK > 0 | |
| locked | boolean NOT NULL DEFAULT false | 鎖隊：禁止新加入 |
| settings | jsonb NOT NULL DEFAULT '{}' | 隊伍層選配（未來：專屬關卡清單、賽制） |
| created_at / updated_at | timestamptz | |
| archived_at | timestamptz NULL | 學期結束封存（保留紀錄、不出現在列表） |

（同校多老師共管一隊：未來加 `team_teachers` 關聯表，現在 owner 一人夠用。）

### students — 學生（由老師建、邀請制；可無 email）
| 欄位 | 型別 | 說明 |
|---|---|---|
| id | bigint identity PK | |
| team_id | bigint NOT NULL FK teams | 索引 |
| name | text NOT NULL | 顯示名 |
| emoji | text NOT NULL DEFAULT '🙂' | 學生端頭像（沿用現有產品語言） |
| email | text NULL | 有 email 才能走邀請信；`UNIQUE (team_id, LOWER(email))` 部分索引 WHERE email IS NOT NULL |
| password_hash | text NULL | 設過密碼才有 |
| student_code | text NOT NULL | 隊內學生碼（如 `03`）；`UNIQUE (team_id, student_code)`。無 email 學生用 `team_code + student_code` 登入 |
| invite_status | text NOT NULL DEFAULT 'none' CHECK in ('none','sent','accepted') | 邀請信狀態 |
| status | text NOT NULL DEFAULT 'active' CHECK in ('active','removed') | 老師移除學生 → removed（進度保留可查） |
| created_at / updated_at | timestamptz | |
| last_seen_at | timestamptz NULL | |

### progress — 關卡進度（一生一關一列，upsert）
| 欄位 | 型別 | 說明 |
|---|---|---|
| student_id | bigint NOT NULL FK students | 複合 PK (student_id, level_id) |
| level_id | text NOT NULL | `'1-1'`；關卡是 JSON 檔不是表，故用字串（未來專屬關卡也是字串 id） |
| best_time_ms | integer NULL | 最佳成績 |
| attempts | integer NOT NULL DEFAULT 0 | 嘗試次數 |
| first_completed_at | timestamptz NULL | |
| last_completed_at | timestamptz NULL | |
| suspect | boolean NOT NULL DEFAULT false | 防作弊標記（沿用現有機制，進 DB 後不再因重啟消失） |
| updated_at | timestamptz NOT NULL DEFAULT now() | |

PK 即唯一索引，`ON CONFLICT (student_id, level_id) DO UPDATE` 做 upsert；另索引 `(level_id, best_time_ms)` 給排行查詢。
**離線同步去重**：client 上傳時帶 `client_event_id`（uuid）→ 寫入 `audit_events.dedupe_key`（見下）唯一約束擋重複。

### sessions — 登入 session（老師 / 學生共用）
| 欄位 | 型別 | 說明 |
|---|---|---|
| id | bigint identity PK | |
| token_hash | text NOT NULL UNIQUE | sha256(token)；明文只在發出那一刻給 client |
| principal_type | text NOT NULL CHECK in ('teacher','student') | |
| principal_id | bigint NOT NULL | 對應 teachers.id / students.id（多型關聯，用 CHECK 不用 FK；索引 (principal_type, principal_id)） |
| expires_at | timestamptz NOT NULL | 老師 30 天、學生 90 天，滑動延長 |
| last_seen_at | timestamptz NOT NULL DEFAULT now() | 滑動延長依據；同時是「誰還在線」的粗略訊號 |
| created_at | timestamptz NOT NULL DEFAULT now() | |
| user_agent | text NULL | 安全稽核（多裝置登入一眼看出） |
| revoked_at | timestamptz NULL | 登出/踢出 session（不硬刪，留紀錄） |

### audit_events — 稽核事件（避免爭議的核心）
| 欄位 | 型別 | 說明 |
|---|---|---|
| id | bigint identity PK | |
| occurred_at | timestamptz NOT NULL DEFAULT now() | **伺服器時間**（client 時間另放 payload，兩者都留 — 時間爭議的依據） |
| org_id | bigint NULL FK organizations | 租戶範圍查詢；索引 (org_id, occurred_at) |
| actor_type | text NOT NULL CHECK in ('teacher','student','system') | 誰做的 |
| actor_id | bigint NULL | |
| event_type | text NOT NULL | 見下方清單；索引 (event_type, occurred_at) |
| team_id | bigint NULL FK teams | 索引 |
| student_id | bigint NULL FK students | 索引；方便拉「這個學生的全部紀錄」 |
| payload | jsonb NOT NULL DEFAULT '{}' CHECK jsonb_typeof='object' | 事件細節（成績、關卡、舊值新值、client 時間戳、IP…） |
| dedupe_key | text NULL UNIQUE | 冪等鍵（離線補傳 / 重送不重複記） |

**只新增、不更新、不刪除**（append-only；DB 使用者對此表只給 INSERT/SELECT）。
資料量大時按月 RANGE 分區（現在不做；到百萬列再說）。

**事件清單（起步）**：
- 身分：`teacher.register` `teacher.login` `teacher.login_failed` `teacher.logout` `student.login` `student.login_failed` `session.revoked`
- 隊伍：`team.created` `team.updated`（payload 帶 before/after）`team.archived` `team.locked` `team.unlocked`
- 學生：`student.invited` `student.joined` `student.removed` `student.kicked`
- 成績：`level.completed`（payload：level_id、time_ms、client_ts、server_ts、suspect、suspect_reasons）— **這條是成績爭議的唯一依據**
- 賽局：`match.started` `match.ended`（payload：模式、時長、最終排行/比分）— 先記事件，不開 matches 表
- 管理：`org.updated` `teacher.disabled`

## 3. 刻意不做（YAGNI，留擴充點）
| 不做 | 為什麼 | 之後怎麼加 |
|---|---|---|
| matches 表（賽局明細） | 現在沒人查；先記 audit 事件 | 需要報表時開表，從 audit 回填 |
| team_levels（專屬關卡） | 關卡仍是 JSON 檔；老闆說的「專屬關卡」先用 teams.settings.level_ids 字串陣列 | 關卡編輯器落地後開表 |
| 平台管理員 / 計費 | 單租戶期不需要 | organizations.plan 已留欄位 |
| 學生多隊 | 一生一隊夠用一學期 | 改 students.team_id 為關聯表 |
| 密碼重設 token 表 | 用 sessions 同機制：principal + 短 TTL + purpose 欄位即可，需要時加一欄 | |

## 4. 工具與慣例
- SQLAlchemy 2.x（async，`asyncpg`）+ Alembic；models 在 `apps/api/app/db/models.py`，migration 在 `apps/api/alembic/`
- 密碼：`argon2-cffi`；session token：`secrets.token_urlsafe(32)`，存 sha256
- 時間一律 `timestamptz`、由 DB `now()` 產生；client 時間只進 payload
- DB 使用者權限：之後開 `creafly_app` 專屬帳號（只有 creafly 庫）；`audit_events` 對它只 INSERT/SELECT

## 5. Migration 操作（apps/api）
- 連線：`DATABASE_URL`（環境變數或 `apps/api/.env`，asyncpg 格式 `postgresql+asyncpg://…`）；未設定 → app 以無資料庫模式啟動、`/api/health` 回 `db: disabled`
- 套用到最新：`uv run creafly-migrate`（= `uv run alembic upgrade head`；Docker：`docker run --rm --env-file creafly.env <image> uv run creafly-migrate`）
- 新增 migration：改 `app/db/models.py` → `uv run alembic revision --autogenerate --rev-id 0002 -m "說明"` → **人工檢視** `alembic/versions/0002_*.py`（autogenerate 可能漏表達式 / 部分索引與 CHECK 內容，漏的手寫補上）→ `uv run alembic upgrade head` → `uv run alembic check`（確認 models 與 DB 已一致）
- 回退 / 狀態：`uv run alembic downgrade -1`、`uv run alembic current`、`uv run alembic history`
- 測試：`tests/test_db.py` 需 `DATABASE_URL`（沒設自動 skip），用 rollback 不留資料；既有測試一律無資料庫模式（conftest 固定 `database_url=None`）
