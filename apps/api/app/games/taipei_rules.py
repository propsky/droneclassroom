"""臺北市 115 年度無人機足球（附件4）的純規則。

不改賽局物件。F9A 的三局兩勝、PK、黃金進球不走這裡。

條文（實施計畫附件4）：
- 三、（二）1：一場決勝負，2 分鐘，分高者勝；同分則先進第 1 球的隊伍勝。
- 三、（二）3：起始信號前不得升空，違反扣 1 分。
- 三、（二）9／（四）6：不得停留在自家圓形球門內，或反向穿越阻擋，扣 1 分，可重複。
- 三、（二）10／（四）7：結束後 10 秒內須降落，違反者每位扣 1 分。
- 三、（三）：只有攻擊手從正面穿對方球門才計分；進球後該方要回自己半場，否則該球不計。
- 四、（九）：規則未盡之處參照 FAI F9A-B。
"""

import math
from typing import Literal

from .soccer_presets import F9A_B, SoccerClassSpec
from .soccer_rules import shield_passes_ring

SoccerRuleset = Literal["f9a", "taipei"]
RULESETS = ("f9a", "taipei")

# 教室機體落地高度（與 simulator HOME_POSITION.y 相同）。再高一點仍算在地上。
REST_Y = 0.4
LAND_MARGIN = 0.2
# 停在己方球門開口裡連續這麼久才扣分，掠過不算。
DWELL_MS = 1000.0
LAND_GRACE_SEC = 10.0
MATCH_SEC = 120.0


class TaipeiRules:
    """臺北賽制的勝負、扣分幾何。全部是靜態方法。"""

    @staticmethod
    def net(goals: int, deductions: int) -> int:
        return goals - deductions

    @staticmethod
    def winner(blue_net: int, red_net: int, first_goal: str | None) -> str:
        """淨分高者勝。淨分相同則先進第 1 球的隊伍勝。都沒進球才是平手。"""
        if blue_net > red_net:
            return "blue"
        if red_net > blue_net:
            return "red"
        if first_goal in ("blue", "red"):
            return first_goal
        return "draw"

    @staticmethod
    def landed(y: float) -> bool:
        """高度在落地休息高度附近。馬達有沒有關，位置看不出來，不在這裡判。"""
        return y <= REST_Y + LAND_MARGIN

    @staticmethod
    def inside_own_goal(
        pos: tuple[float, float, float],
        *,
        goal_z: float,
        goal_y: float,
        goal_r: float,
        half_thick: float,
        shield_r: float,
    ) -> bool:
        """球心在己方球門開口圓柱裡（含護罩與環厚）。從旁邊飛過不算。"""
        if goal_r <= 0:
            return False
        radial = math.hypot(pos[0], pos[1] - goal_y)
        if radial > goal_r:
            return False
        return abs(pos[2] - goal_z) <= half_thick + shield_r

    @staticmethod
    def reverse_through_own(
        prev: tuple[float, float, float],
        curr: tuple[float, float, float],
        *,
        defend_goal_z: float,
        goal_y: float,
        goal_r: float,
        half_thick: float,
        shield_r: float,
    ) -> bool:
        """反向穿回場內、穿過己方球門。穿出去（烏龍那一方向）不算這一條。"""
        outbound = -1.0 if defend_goal_z < 0 else 1.0
        return shield_passes_ring(
            prev,
            curr,
            goal_z=defend_goal_z,
            goal_y=goal_y,
            goal_r=goal_r,
            attack_sign=-outbound,
            half_thick=half_thick,
            shield_r=shield_r,
        )


class RoomSoccerRuleset:
    """房間釘選的賽制。沒寫就是臺北賽制。存在 teams.settings.soccerRuleset，不另開欄位。"""

    @staticmethod
    def parse(raw: object) -> SoccerRuleset | None:
        if raw in RULESETS:
            return raw  # type: ignore[return-value]
        return None

    @staticmethod
    def effective(raw: object) -> SoccerRuleset:
        """比賽只打臺北賽制。JSON 裡的 f9a、空值、打錯的字都當臺北，不改已存的字。"""
        return "taipei"

    @staticmethod
    def read(settings: object) -> SoccerRuleset | None:
        if not isinstance(settings, dict):
            return None
        return RoomSoccerRuleset.parse(settings.get("soccerRuleset"))

    @staticmethod
    def write(settings: dict | None, code: str | None) -> dict:
        nxt = dict(settings or {})
        parsed = RoomSoccerRuleset.parse(code)
        if parsed is None:
            nxt.pop("soccerRuleset", None)
        else:
            nxt["soccerRuleset"] = parsed
        return nxt


class SoccerPairing:
    """這一房實際用的賽制與場地。

    只打臺北賽制，場地固定 F9A-B。
    teams.settings 裡的 soccerRuleset=f9a、釘選的 F9A-A、環境變數 SOCCER_CLASS 都忽略。
    不改已經存進 JSON 的字，只在讀的時候決定。
    """

    TAIPEI_FIELD = F9A_B.code

    @staticmethod
    def ruleset(stored: object) -> SoccerRuleset:
        return RoomSoccerRuleset.effective(stored)

    @staticmethod
    def field_spec(ruleset: object, stored_class: object, env_class: str) -> SoccerClassSpec:
        del ruleset, stored_class, env_class
        return F9A_B

    @staticmethod
    def allows_big_field(ruleset: object) -> bool:
        """大場已不能開賽。舊的 f9a 釘選也不行。"""
        del ruleset
        return False

    @staticmethod
    def legacy_ruleset_token(stored: object) -> str | None:
        """JSON 裡原本寫的賽制。f9a 留著給舊資料讀取，比賽不採用。"""
        return RoomSoccerRuleset.parse(stored)
