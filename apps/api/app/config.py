"""應用程式設定 — pydantic-settings，環境變數可覆寫（PORT / TEACHER_PASSWORD / …）。"""

from pathlib import Path

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
    - teacher_password：教師後台密碼；未設定時啟動隨機產生 6 位數 PIN 並印在 console
    - ticket_ttl：教師 ticket 有效秒數（預設 4 小時，涵蓋一個上課半天）
    - allowed_origins：Origin 白名單額外項目（逗號分隔；私有網段預設放行，見 auth.py）
    - levels_dir：關卡 JSON 目錄（chapter*.json，/api/levels 與防作弊已知關卡來源）
    - max_students：學生人數上限（顯示用，/api/info 帶出）
    - game_tick_interval：賽局主迴圈週期秒（legacy setInterval 80ms）；
      設 0 不啟動 asyncio tick task（測試注入假時鐘、手動呼叫 tick()）
    - soccer_half_x / soccer_half_z / soccer_goal_y / soccer_goal_r / soccer_ceil：
      足球場地尺寸（資料驅動：伺服器以 SoccerFieldDef 下發，client 據此渲染；
      環境變數 SOCCER_HALF_X … 可調）。預設 20×40（約舊版兩倍）、
      門環中心高 4.5、半徑 3.0（直徑 6m，無人機球框 0.8 輕鬆穿）、天花板 15
    """

    model_config = SettingsConfigDict(env_prefix="", extra="ignore")

    port: int = 3000
    static_dir: Path = Field(default_factory=lambda: _APPS_DIR / "simulator" / "dist")
    teacher_html: Path = Field(default_factory=lambda: _API_DIR / "static" / "teacher.html")
    teacher_dist: Path = Field(default_factory=lambda: _APPS_DIR / "teacher" / "dist")
    teacher_password: str | None = None
    ticket_ttl: int = 14400
    allowed_origins: str = ""
    levels_dir: Path = Field(
        default_factory=lambda: _APPS_DIR / "simulator" / "public" / "levels"
    )
    max_students: int = 12
    game_tick_interval: float = 0.08
    soccer_half_x: float = 10.0
    soccer_half_z: float = 20.0
    soccer_goal_y: float = 4.5
    soccer_goal_r: float = 3.0
    soccer_ceil: float = 15.0

    @property
    def allowed_origins_set(self) -> frozenset[str]:
        """ALLOWED_ORIGINS 逗號分隔字串 → 集合（去空白、忽略空項）。"""
        return frozenset(x.strip() for x in self.allowed_origins.split(",") if x.strip())
