"""F9A 階段二純規則：護罩掃掠體有沒有穿過開口。

與 apps/simulator/src/soccer/goalDetector.ts 同一套幾何。伺服器只看位置軌跡的行進方向，
不看機頭朝向。開口是內半徑圓柱，不含框管；貼近內緣也算，只打到框不算。
護罩半徑來自 soccer_presets（預設 F9A-A）。
"""

import math

from .soccer_presets import F9A_A

# 沒帶 shield_r 時的預設（F9A-A，直徑 40 cm）。賽局應傳場地上的 shield_r。
DEFAULT_SHIELD_R = F9A_A.shield_r
# PK 每一記 10 秒。犯規罰球已拿掉，這常數只給點球時鐘用。
PENALTY_SEC = 10.0


def false_start_radius(ball_r: float) -> float:
    """搶跑半徑 = 球半徑。

    出生點沿底線的間距是一顆球徑（2 × 球半徑）。半徑取球半徑，
    每個人的圓才剛好接到隔壁的點、不會把隔壁的出生點也算成自己的。
    ball_r 是 F9A 護罩半徑（與 client SOCCER_BALL_R 同一份）。
    """
    return ball_r


# F9A-A 的搶跑半徑。賽局請改呼 false_start_radius(場地.shield_r)，B 組會更小。
FALSE_START_RADIUS = false_start_radius(F9A_A.shield_r)
# 穿越授權的有效時間：逾時的 soccer_goal 不能拿舊軌跡兌換
CROSS_GRANT_MS = 1500.0
# 教學選項：空中機對機沿法線的接近速度（m/s）。
# 2026 F9A.9 沒有「飛在空中互相接近太快就發牌」；預設關閉，見 SoccerGame.air_contact_cards。
# 墜機是安全事件（soccer_safety，本局少一人），不是這條，也不發紅牌。
YELLOW_CLOSING_MPS = 2.2
RED_CLOSING_MPS = 5.5


_DIR_EPS = 1e-9
_HIT_EPS = 1e-6


class GoalDetector:
    """護罩掃掠體有沒有沿進攻方向穿過開口。

    與 apps/simulator/src/soccer/goalDetector.ts 同一套幾何。
    方向維持原規則：attack_sign +1 必須往 +z（藍隊攻 +z 門），反向不算，不看機頭。
    後緣要跨過出口面（門面再往行進方向半個環厚）。只到門面不算穿過去。
    開口是半徑 goal_r 的圓柱，軸向只涵蓋框厚，框管不算。
    球心貼內緣、或只有一部分球體伸進洞，都算；只打到框或從框外飛過不算。
    前後位置用線段掃掠，不用單點抽樣。
    """

    @staticmethod
    def crossed(
        prev: tuple[float, float, float],
        curr: tuple[float, float, float],
        *,
        goal_z: float,
        goal_y: float,
        goal_r: float,
        attack_sign: float,
        half_thick: float,
        shield_r: float = DEFAULT_SHIELD_R,
    ) -> bool:
        if not GoalDetector.trailing_edge_clears_exit(
            prev,
            curr,
            goal_z=goal_z,
            attack_sign=attack_sign,
            half_thick=half_thick,
            shield_r=shield_r,
        ):
            return False
        return GoalDetector.swept_intersects_opening(
            prev,
            curr,
            goal_z=goal_z,
            goal_y=goal_y,
            goal_r=goal_r,
            half_thick=half_thick,
            shield_r=shield_r,
        )

    @staticmethod
    def trailing_edge_clears_exit(
        prev: tuple[float, float, float],
        curr: tuple[float, float, float],
        *,
        goal_z: float,
        attack_sign: float,
        half_thick: float,
        shield_r: float,
    ) -> bool:
        sign = GoalDetector.attack_motion_sign(prev, curr, attack_sign)
        if sign == 0 or half_thick < 0:
            return False
        prev_trail = prev[2] - shield_r * sign
        curr_trail = curr[2] - shield_r * sign
        exit_z = goal_z + sign * half_thick
        if sign > 0:
            return prev_trail < exit_z <= curr_trail
        return prev_trail > exit_z >= curr_trail

    @staticmethod
    def swept_intersects_opening(
        prev: tuple[float, float, float],
        curr: tuple[float, float, float],
        *,
        goal_z: float,
        goal_y: float,
        goal_r: float,
        half_thick: float,
        shield_r: float,
    ) -> bool:
        if goal_r <= 0 or shield_r < 0 or half_thick < 0:
            return False
        z0 = goal_z - half_thick
        z1 = goal_z + half_thick
        slab = _t_span_overlapping_z(prev[2], curr[2], z0, z1)
        if slab is not None:
            radial = _min_radial(prev, curr, slab[0], slab[1], goal_y)
            if radial <= goal_r + shield_r + _HIT_EPS:
                return True
        seg_lo = min(prev[2], curr[2])
        seg_hi = max(prev[2], curr[2])
        if seg_hi < z0 - shield_r - _HIT_EPS or seg_lo > z1 + shield_r + _HIT_EPS:
            return False
        return _min_dist_to_opening(prev, curr, goal_y, goal_r, z0, z1) <= shield_r + _HIT_EPS

    @staticmethod
    def attack_motion_sign(
        prev: tuple[float, float, float],
        curr: tuple[float, float, float],
        attack_sign: float,
    ) -> int:
        dz = curr[2] - prev[2]
        if attack_sign == 0 or dz * attack_sign <= _DIR_EPS:
            return 0
        return 1 if dz > 0 else -1


def _t_span_overlapping_z(
    prev_z: float, curr_z: float, z_a: float, z_b: float
) -> tuple[float, float] | None:
    lo_z = min(z_a, z_b)
    hi_z = max(z_a, z_b)
    dz = curr_z - prev_z
    if abs(dz) < 1e-12:
        if prev_z < lo_z - _HIT_EPS or prev_z > hi_z + _HIT_EPS:
            return None
        return (0.0, 1.0)
    t_a = (lo_z - prev_z) / dz
    t_b = (hi_z - prev_z) / dz
    if t_a > t_b:
        t_a, t_b = t_b, t_a
    lo = max(0.0, t_a)
    hi = min(1.0, t_b)
    if lo > hi + 1e-9:
        return None
    return (lo, max(lo, hi))


def _min_radial(
    prev: tuple[float, float, float],
    curr: tuple[float, float, float],
    t0: float,
    t1: float,
    goal_y: float,
) -> float:
    ax = prev[0] + (curr[0] - prev[0]) * t0
    ay = prev[1] + (curr[1] - prev[1]) * t0 - goal_y
    bx = prev[0] + (curr[0] - prev[0]) * t1
    by = prev[1] + (curr[1] - prev[1]) * t1 - goal_y
    return _dist_point_to_segment_2d(0.0, 0.0, ax, ay, bx, by)


def _dist_point_to_segment_2d(
    px: float, py: float, ax: float, ay: float, bx: float, by: float
) -> float:
    abx = bx - ax
    aby = by - ay
    ab2 = abx * abx + aby * aby
    if ab2 < 1e-24:
        return math.hypot(px - ax, py - ay)
    t = ((px - ax) * abx + (py - ay) * aby) / ab2
    t = min(1.0, max(0.0, t))
    return math.hypot(ax + abx * t - px, ay + aby * t - py)


def _dist_to_opening(
    p: tuple[float, float, float], goal_y: float, goal_r: float, z0: float, z1: float
) -> float:
    radial = math.hypot(p[0], p[1] - goal_y)
    dr = max(0.0, radial - goal_r)
    dz = 0.0
    if p[2] < z0:
        dz = z0 - p[2]
    elif p[2] > z1:
        dz = p[2] - z1
    if dz == 0.0:
        return dr
    if dr == 0.0:
        return dz
    return math.hypot(dr, dz)


def _min_dist_to_opening(
    prev: tuple[float, float, float],
    curr: tuple[float, float, float],
    goal_y: float,
    goal_r: float,
    z0: float,
    z1: float,
) -> float:
    def at(t: float) -> float:
        p = (
            prev[0] + (curr[0] - prev[0]) * t,
            prev[1] + (curr[1] - prev[1]) * t,
            prev[2] + (curr[2] - prev[2]) * t,
        )
        return _dist_to_opening(p, goal_y, goal_r, z0, z1)

    end = min(at(0.0), at(1.0))
    gr = (math.sqrt(5) - 1) / 2
    a = 0.0
    b = 1.0
    c = b - gr * (b - a)
    d = a + gr * (b - a)
    fc = at(c)
    fd = at(d)
    fa = at(a)
    fb = at(b)
    for _ in range(64):
        if fc < fd:
            b = d
            fb = fd
            d = c
            fd = fc
            c = b - gr * (b - a)
            fc = at(c)
        else:
            a = c
            fa = fc
            c = d
            fc = fd
            d = a + gr * (b - a)
            fd = at(d)
    return min(end, fa, fb, fc, fd)


def shield_passes_ring(
    prev: tuple[float, float, float],
    curr: tuple[float, float, float],
    *,
    goal_z: float,
    goal_y: float,
    goal_r: float,
    attack_sign: float,
    half_thick: float,
    shield_r: float = DEFAULT_SHIELD_R,
) -> bool:
    """沿進攻方向，護罩掃掠體穿過開口才算。薄包裝，幾何在 GoalDetector。"""
    return GoalDetector.crossed(
        prev,
        curr,
        goal_z=goal_z,
        goal_y=goal_y,
        goal_r=goal_r,
        attack_sign=attack_sign,
        half_thick=half_thick,
        shield_r=shield_r,
    )


class OwnGoal:
    """進了自己隊的門：雙方都不加分。純判斷，不改賽局物件。"""

    @staticmethod
    def shield_into_own(
        prev: tuple[float, float, float],
        curr: tuple[float, float, float],
        *,
        defend_goal_z: float,
        goal_y: float,
        goal_r: float,
        half_thick: float,
        shield_r: float = DEFAULT_SHIELD_R,
    ) -> bool:
        """護罩沿離開場地的方向，整顆穿過自家圓環。反向穿回場內不算。"""
        sign = -1.0 if defend_goal_z < 0 else 1.0
        return shield_passes_ring(
            prev,
            curr,
            goal_z=defend_goal_z,
            goal_y=goal_y,
            goal_r=goal_r,
            attack_sign=sign,
            half_thick=half_thick,
            shield_r=shield_r,
        )
