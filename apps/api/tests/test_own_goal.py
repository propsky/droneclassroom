"""烏龍判斷：純函式，不經 WebSocket。"""

from app.games.soccer_presets import F9A_A
from app.games.soccer_rules import OwnGoal


def test_最後觸球者守門才是烏龍() -> None:
    assert OwnGoal.by_touch(toucher_team="blue", scoring_team="red")
    assert not OwnGoal.by_touch(toucher_team="blue", scoring_team="blue")
    assert not OwnGoal.by_touch(toucher_team=None, scoring_team="blue")


def test_護罩穿出自家圓環才算_反向穿回不算() -> None:
    y = F9A_A.goal_y
    gz = F9A_A.half_z - F9A_A.goal_inset
    kw = {
        "defend_goal_z": -gz,
        "goal_y": y,
        "goal_r": F9A_A.goal_r,
        "half_thick": F9A_A.goal_tube,
        "shield_r": F9A_A.shield_r,
    }
    inside = -gz + F9A_A.shield_r + 0.15
    outside = -gz - F9A_A.shield_r - 0.15
    assert OwnGoal.shield_into_own((0, y, inside), (0, y, outside), **kw)
    assert not OwnGoal.shield_into_own((0, y, outside), (0, y, inside), **kw)
