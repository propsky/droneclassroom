"""穿門幾何：與 apps/simulator/src/soccer/goalDetector.test.ts 同一組情況。"""

import math

from app.games.soccer_presets import F9A_A
from app.games.soccer_rules import GoalDetector

Y = F9A_A.goal_y
GZ = F9A_A.half_z - F9A_A.goal_inset
KW = {
    "goal_z": GZ,
    "goal_y": Y,
    "goal_r": F9A_A.goal_r,
    "attack_sign": 1.0,
    "half_thick": F9A_A.goal_tube,
    "shield_r": F9A_A.shield_r,
}
BEFORE = GZ - F9A_A.shield_r - F9A_A.goal_tube - 0.4
AFTER = GZ + F9A_A.shield_r + F9A_A.goal_tube + 0.4


def _cross(x: float, y_off: float = 0.0, z0: float = BEFORE, z1: float = AFTER) -> bool:
    return GoalDetector.crossed((x, Y + y_off, z0), (x, Y + y_off, z1), **KW)


def test_正中穿過() -> None:
    assert _cross(0.0)


def test_開口內緣四邊() -> None:
    rim = F9A_A.goal_r - 0.02
    assert rim > F9A_A.goal_r - F9A_A.shield_r
    assert _cross(rim, 0.0)
    assert _cross(-rim, 0.0)
    assert _cross(0.0, rim)
    assert _cross(0.0, -rim)


def test_開口內四角() -> None:
    rim = F9A_A.goal_r - 0.02
    c = rim / math.sqrt(2)
    assert _cross(c, c)
    assert _cross(c, -c)
    assert _cross(-c, c)
    assert _cross(-c, -c)


def test_只有一部分球體伸進開口() -> None:
    sliver = F9A_A.goal_r + F9A_A.shield_r - 0.02
    assert sliver > F9A_A.goal_r
    assert _cross(sliver)


def test_框外掠過不算() -> None:
    out = F9A_A.goal_r + F9A_A.goal_tube * 2 + F9A_A.shield_r + 0.1
    assert not _cross(out, 0.0)
    assert not _cross(-out, 0.0)
    assert not _cross(0.0, out)
    assert not _cross(0.0, -out)
    assert not _cross(out, out)


def test_打到框沒進開口不算() -> None:
    post = F9A_A.goal_r + F9A_A.shield_r + 0.05
    assert not _cross(post, 0.0)
    assert not _cross(-post, 0.0)
    assert not _cross(0.0, post)
    assert not _cross(0.0, -post)


def test_後緣沒離開與反向不算() -> None:
    assert not _cross(0.0, 0.0, BEFORE, GZ)
    assert not _cross(0.0, 0.0, AFTER, BEFORE)
    rim = F9A_A.goal_r - 0.02
    assert not _cross(rim, 0.0, AFTER, BEFORE)


def test_高速跳過門面() -> None:
    far0 = GZ - 4
    far1 = GZ + 4
    assert _cross(0.0, 0.0, far0, far1)
    rim = F9A_A.goal_r - 0.02
    assert _cross(rim, 0.0, far0, far1)
    assert _cross(0.0, rim, far0, far1)
    c = rim / math.sqrt(2)
    assert _cross(c, c, far0, far1)
    out = F9A_A.goal_r + F9A_A.goal_tube * 2 + F9A_A.shield_r + 0.1
    assert not _cross(out, 0.0, far0, far1)


def test_斜向高速掃掠() -> None:
    prev_x = -0.25 / 0.15
    prev = (prev_x, Y, GZ - 0.5)
    curr = (prev_x + 1 / 0.15, Y, GZ + 1.5)
    assert GoalDetector.crossed(prev, curr, **KW)
    exit_z = GZ + F9A_A.goal_tube
    prev_trail = prev[2] - F9A_A.shield_r
    curr_trail = curr[2] - F9A_A.shield_r
    t = (exit_z - prev_trail) / (curr_trail - prev_trail)
    sample_x = prev[0] + (curr[0] - prev[0]) * t
    assert abs(sample_x) > F9A_A.goal_r + F9A_A.shield_r


def test_帽緣才掃到開口() -> None:
    exit_z = GZ + F9A_A.goal_tube
    prev = (0.55, Y, exit_z + 0.01)
    curr = (0.0, Y, exit_z + F9A_A.shield_r + 0.05)
    assert GoalDetector.crossed(prev, curr, **KW)
    miss = (0.9, Y, exit_z + 0.01)
    miss_end = (0.9, Y, exit_z + F9A_A.shield_r + 0.05)
    assert not GoalDetector.crossed(miss, miss_end, **KW)


def test_往負z的門() -> None:
    far_z = -GZ
    kw = {**KW, "goal_z": far_z, "attack_sign": -1.0}
    approach = far_z + 0.8
    through = far_z - F9A_A.goal_tube - F9A_A.shield_r - 0.3
    assert GoalDetector.crossed((0.0, Y, approach), (0.0, Y, through), **kw)
    assert not GoalDetector.crossed((0.0, Y, through), (0.0, Y, approach), **kw)
    rim = F9A_A.goal_r - 0.02
    assert GoalDetector.crossed((rim, Y, approach), (rim, Y, through), **kw)
