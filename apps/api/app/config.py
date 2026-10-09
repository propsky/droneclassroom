"""應用程式設定 — pydantic-settings，環境變數可覆寫（PORT / TEACHER_PASSWORD / …）。"""

from pathlib import Path
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# apps/api/app/config.py → parents[1] = apps/api、parents[2] = apps
_API_DIR = Path(__file__).resolve().parents[1]
_APPS_DIR = _API_DIR.parent


class Settings(BaseSettings):
    """伺服器設定。

    - port：HTTP + WS 共用 port（Railway 等 PaaS 只對外開一個 port）
    - static_dir：學生端靜態檔根目錄（vite build 產物；不存在時只服務 /teacher 與 WS）
    - teacher_html：老師後台頁面（legacy 原樣複製，teacher_dist 不存在時的過渡 fallback）
    - teacher_dist：新版老師後台 vite build 產物；目錄存在時 /teacher 服務其 index.html、
      assets 掛在 /teacher-assets（vite base 設 /teacher-assets/，由 apps/teacher 配合）
    - teacher_password：教師後台 PIN（僅無資料庫模式的舊登入 POST /auth/teacher 使用）；
      未設定時啟動隨機產生 6 位數 PIN 並印在 console
    - ticket_ttl：舊 HMAC ticket 有效秒數（無資料庫模式；預設 4 小時）
    - allowed_origins：Origin 白名單額外項目（逗號分隔；私有網段預設放行，見 auth.py）
    - levels_dir：關卡 JSON 目錄（chapter*.json，/api/levels 與防作弊已知關卡來源）
    - max_students：學生人數上限（顯示用，/api/info 帶出）
    - game_tick_interval：賽局主迴圈週期秒（legacy setInterval 80ms）；
      設 0 不啟動 asyncio tick task（測試注入假時鐘、手動呼叫 tick()）
    - soccer_class：足球子類，F9A-A（預設）或 F9A-B。尺寸只在
      games/soccer_presets.py，環境變數 SOCCER_CLASS 可切換，伺服器整組下發。
    - soccer_air_contact_cards：空中機對機「接近速度」黃／紅牌的教學選項。
      2026 F9A.9 沒有這條，預設關閉（SOCCER_AIR_CONTACT_CARDS=1 才開）。
      墜機紅牌不受這個開關影響。
    - room_code_length / room_code_alphabet：房間碼長度與字元集（預設 4 碼、去 0/O/1/I 防混淆）
    - default_room_code：預設房代碼（啟動即存在、不可關閉；不帶房間碼的學生走這裡 = 舊流程）
    - room_default_max_students：新房預設人數上限；None = 沿用 max_students
    - room_idle_close_sec：非預設房 0 人且無賽局進行超過此秒數 → 自動關房（預設 1 小時）
    - room_max_rooms：同時存在的房間數上限（含預設房），防濫開
    - database_url：PostgreSQL 連線字串（asyncpg 格式 `postgresql+asyncpg://…`）；
      None = 不啟用資料庫，既有無 DB 流程（房間 / 賽局 / 名冊皆在記憶體）照常運作。
      可由 apps/api/.env 提供（不進版控），環境變數優先於 .env
    - session_ttl_sec：老師 DB session 有效秒數（預設 30 天，每次使用滑動延長）
    - session_touch_interval_sec：滑動延長的寫入節流：距上次延長不到此秒數不寫 DB（預設 5 分鐘）
    - password_min_length：註冊 / 換密碼的最短長度
    - student_session_ttl_sec：學生 session 有效秒數（預設 90 天，滑動延長 —— 一學期不重登）
    - invite_ttl_sec：學生邀請 token 有效秒數（預設 7 天；過期老師可 reinvite 重發）
    - public_student_url：學生端對外網址（邀請信連結用；正式 = Cloudflare Pages）
    - entitlement_mode：關卡授權模式（預設 open = 全關卡，行為與改版前相同）
      open = 測試全開；demo_only = 訪客試玩關；enforce = 正式（welcome 試玩、帳號後續升級）
    - demo_level_ids：試玩關卡 id（逗號分隔）；enforce / demo_only 用
    """

    model_config = SettingsConfigDict(
        env_prefix="", extra="ignore", env_file=_API_DIR / ".env", env_file_encoding="utf-8"
    )

    port: int = 3000
    static_dir: Path = Field(default_factory=lambda: _APPS_DIR / "simulator" / "dist")
    teacher_html: Path = Field(default_factory=lambda: _API_DIR / "static" / "teacher.html")
    teacher_dist: Path = Field(default_factory=lambda: _APPS_DIR / "teacher" / "dist")
    admin_dist: Path = Field(default_factory=lambda: _APPS_DIR / "admin" / "dist")
    teacher_password: str | None = None
    # 免登入模式（測試用）：無 DB 時後台不需 PIN；有 DB 時 /auth/teacher/login 任意帳密
    # 皆登入預設老師 dev@local。正式環境務必維持 False
    teacher_auth_disabled: bool = False
    # 老師自行註冊邀請碼；未設定 = 開放註冊（開發預設）。正式環境建議設一組密碼
    teacher_register_code: str | None = None
    # 老師忘記密碼重設 token 有效秒數（預設 1 小時）
    password_reset_ttl_sec: int = 3600
    # 老師後台對外網址（重設密碼信連結用）
    public_teacher_url: str = "https://droneclassroom.pages.dev/teacher/"
    # 寄信（AWS SES）：mail_from 未設定 = 寄信停用（記 log 不真寄，開發/測試預設）
    # 例：MAIL_FROM="CREAFLY <noreply@propskynet.com>"（寄件網域須已在 SES 完成 DKIM 驗證）
    mail_from: str | None = None
    ses_region: str = "ap-northeast-1"
    ticket_ttl: int = 14400
    allowed_origins: str = ""
    levels_dir: Path = Field(
        default_factory=lambda: _APPS_DIR / "simulator" / "public" / "levels"
    )
    max_students: int = 12
    game_tick_interval: float = 0.08
    # 足球子類。尺寸見 games/soccer_presets.py，不在這裡再寫一組數字。
    soccer_class: Literal["F9A-A", "F9A-B"] = "F9A-A"
    # 空中接近速度罰牌（教學用）。預設關。打開後走警告，不是直接發牌。
    soccer_air_contact_cards: bool = False
    # 局數打平之後的順序。預設照 WDSC：先各罰 3 球 PK，仍平手再黃金進球。
    soccer_tiebreak: Literal["pk_then_golden", "golden_then_pk"] = "pk_then_golden"
    room_code_length: int = 4
    room_code_alphabet: str = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    default_room_code: str = "MAIN"
    room_default_max_students: int | None = None
    room_max_sub_rooms: int = 5
    room_idle_close_sec: float = 3600
    room_max_rooms: int = 20
    database_url: str | None = None
    session_ttl_sec: int = 30 * 24 * 3600
    session_touch_interval_sec: int = 300
    password_min_length: int = 8
    student_session_ttl_sec: int = 90 * 24 * 3600
    invite_ttl_sec: int = 7 * 24 * 3600
    public_student_url: str = "https://droneclassroom.pages.dev"
    entitlement_mode: Literal["open", "enforce", "demo_only"] = "open"
    demo_level_ids: str = "1-0,1-1,1-2"
    # 平台管理員：啟動時若帳號不存在且有設密碼，建立一筆（已存在不覆寫密碼）
    platform_admin_username: str = "admin"
    platform_admin_password: str | None = None
    platform_admin_name: str = "管理員"
    # 重播驗證器（J-02）：simulator `pnpm build:replay-verifier` 產出的單檔 bundle；
    # Docker 映像內建於 /app/replay/verify-recording.mjs（REPLAY_VERIFIER_BUNDLE 覆寫）。
    # 檔案不存在 → 開發 fallback tsx → 都沒有則跳過驗證
    replay_verifier_bundle: Path = Field(
        default_factory=lambda: (
            _APPS_DIR / "simulator" / "scripts" / ".cache" / "verify-recording.mjs"
        )
    )
    replay_node_bin: str = "node"
    replay_verify_timeout_sec: float = 30.0
    # 同時跑的驗證子進程上限（錄製上限 36000 tick 時單一 Node 進程峰值約 65MB、0.6 秒）
    replay_verify_concurrency: int = 2
    # 嚴格模式：帳號學生過關「未附錄製」或「無法驗證」也標 suspect。
    # 預設關（只記 log）—— 舊版前端（PWA 下次開啟才更新）與上傳失敗都會缺錄製，
    # 確認正式環境錄製上傳穩定後再開（REPLAY_ENFORCE=1）
    replay_enforce: bool = False
    # 老師自訂關卡在此秒數內修改過：學生端快照與伺服器定義不同 → 判無法驗證（而非可疑）
    replay_level_edit_grace_sec: int = 24 * 3600

    @property
    def allowed_origins_set(self) -> frozenset[str]:
        """ALLOWED_ORIGINS 逗號分隔字串 → 集合（去空白、忽略空項）。"""
        return frozenset(x.strip() for x in self.allowed_origins.split(",") if x.strip())
