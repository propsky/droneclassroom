"""F9A 場地尺寸的唯一來源。

數字只寫在這裡。SoccerField、護罩半徑都從這兩組預設來，不在 dataclass 或
config 再抄一份。客戶端同一套在 apps/simulator/src/soccer/constants.ts
（伺服器沒下發時的 fallback，以及單人練習）。預設子類是 F9A-A。

依據：
- FAI Sporting Code Section 4 Volume F9 Drone Sport，2026 Edition V2
  （F9A.1.1 護罩、F9A.2.2 場地、F9A.3.1 圓環、F9A.3.2 位置）
- 2025 FAI World Drone Soccer Championships Sporting Rules 1.4.2
  （V2 F9A.3.2 把高度寫在同一句裡，分不出 A／B；WDSC 寫明內圈底部）
"""

from dataclasses import dataclass
from typing import Literal

SoccerClassCode = Literal["F9A-A", "F9A-B"]


@dataclass(frozen=True)
class SoccerClassSpec:
    """一個子類的場地、圓環、護罩。

    圓環視覺是圓管：管半徑 = (外半徑 − 內半徑) / 2，外緣才對得上建議外徑。
    F9A.3.1 的 T 是「最大厚度」。A 的 T 剛好等於徑向跨距；B 的建議外徑 70 cm、
    內徑 40 cm，徑向跨距 15 cm，大於 T 上限 10 cm。畫出來的管子填滿內緣到外緣，
    洞與外徑才跟條文的 D2、D1 一致；thickness_max 只記下條文的 T 上限。
    """

    code: SoccerClassCode
    half_x: float
    half_z: float
    ceil: float
    # 內半徑（穿環）。內徑 = 2 × goal_r
    goal_r: float
    # 外半徑（圓環外緣）。外徑 = 2 × outer_r
    outer_r: float
    # 門面離底線、往場內
    goal_inset: float
    # 內圈底部離地。圓心高 = 底部 + 內半徑
    inner_bottom: float
    # 球形護罩半徑
    shield_r: float
    # F9A.3.1 標的最大厚度 T（公尺）
    thickness_max: float

    @property
    def goal_tube(self) -> float:
        """管半徑。外緣 = 內半徑 + 2 × 管半徑。"""
        return (self.outer_r - self.goal_r) / 2

    @property
    def goal_y(self) -> float:
        """圓心離地。"""
        return self.inner_bottom + self.goal_r

    @property
    def thickness(self) -> float:
        """畫出來的管徑（外半徑 − 內半徑）。"""
        return self.outer_r - self.goal_r


# F9A-A：F9A.1.1 護罩直徑 40 cm；F9A.2.2 場地 14×7×5；
# F9A.3.1 外徑 100 cm、內徑 60 cm、T 最大 20 cm；
# 離底線 1.5 m（F9A.3.2／WDSC 1.4.2）；內圈底部 3 m（WDSC 1.4.2）→ 圓心 3.30 m。
F9A_A = SoccerClassSpec(
    code="F9A-A",
    half_x=3.5,
    half_z=7.0,
    ceil=5.0,
    goal_r=0.30,
    outer_r=0.50,
    goal_inset=1.5,
    inner_bottom=3.0,
    shield_r=0.20,
    thickness_max=0.20,
)

# F9A-B：場地 6×3×3（F9A.2.2）；內半徑 0.20、外半徑 0.35（F9A.3.1 內徑 40／外徑 70）；
# T 上限 0.10；離底線 1 m、內圈底部 2 m（WDSC 1.4.2）→ 圓心 2.20 m；護罩直徑 20 cm（F9A.1.1）。
F9A_B = SoccerClassSpec(
    code="F9A-B",
    half_x=1.5,
    half_z=3.0,
    ceil=3.0,
    goal_r=0.20,
    outer_r=0.35,
    goal_inset=1.0,
    inner_bottom=2.0,
    shield_r=0.10,
    thickness_max=0.10,
)

PRESETS: dict[str, SoccerClassSpec] = {F9A_A.code: F9A_A, F9A_B.code: F9A_B}
DEFAULT_CLASS: SoccerClassCode = "F9A-A"


def preset_for(code: str | None) -> SoccerClassSpec:
    """未知代碼回到 F9A-A，避免環境變數打錯就把場地變 0。"""
    if code is not None and code in PRESETS:
        return PRESETS[code]
    return F9A_A
