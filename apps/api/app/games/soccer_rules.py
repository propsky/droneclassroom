"""F9A 階段二純規則：護罩是否整顆穿過圓環。

與 apps/simulator/src/soccer/crossing.ts 同一套幾何。伺服器只看位置軌跡的行進方向，
不看機頭朝向，也不只看球心有沒有進洞。護罩半徑來自 soccer_presets（預設 F9A-A）。
"""

import math

from .soccer_presets import F9A_A

# 沒帶 shield_r 時的預設（F9A-A，直徑 40 cm）。賽局應傳場地上的 shield_r。
DEFAULT_SHIELD_R = F9A_A.shield_r
# 罰球 10 秒（攻擊手對一名防守）。PK 每一記也用這一個，不再另設 20 秒。
PENALTY_SEC = 10.0


def false_start_radius(ball_r: float) -> float:
    """搶跑半徑 = 球半徑。

    出生點沿底線的間距是一顆球徑（2 × 球半徑）。半徑取球半徑，
    每個人的圓才剛好接到隔壁的點、不會把隔壁的出生點也算成自己的。
    ball_r 是 F9A 護罩半徑（與 client SOCCER_BALL_R 同一份），不是推球模式的大球。
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
    """整顆護罩沿行進方向穿過圓環才算。

    attack_sign：+1 表示必須往 +z 走（藍隊攻 +z 門）。dz 與它反向、或幾乎沒動，都不算。
    後緣（行進反方向的那一側）要跨過環的出口面：門面再往行進方向半個環厚（half_thick = 管半徑）。
    那一刻球心到圓心的徑向距離必須 ≤ 內半徑 − 護罩半徑，護罩才整顆離開洞；
    只過門面中心、或球心進洞但擦到框，都不算。
    """
    dz = curr[2] - prev[2]
    if attack_sign == 0 or dz * attack_sign <= 1e-9:
        return False
    sign = 1.0 if dz > 0.0 else -1.0
    prev_trail = prev[2] - shield_r * sign
    curr_trail = curr[2] - shield_r * sign
    exit_z = goal_z + sign * half_thick
    if sign > 0.0:
        if not (prev_trail < exit_z <= curr_trail):
            return False
    elif not (prev_trail > exit_z >= curr_trail):
        return False
    span = curr_trail - prev_trail
    if abs(span) < 1e-12:
        return False
    t = (exit_z - prev_trail) / span
    if t < -1e-6 or t > 1.0 + 1e-6:
        return False
    t = min(1.0, max(0.0, t))
    cx = prev[0] + (curr[0] - prev[0]) * t
    cy = prev[1] + (curr[1] - prev[1]) * t
    clearance = goal_r - shield_r
    if clearance <= 0.0:
        return False
    return math.hypot(cx, cy - goal_y) <= clearance + 1e-6


def shield_overlaps_opening(
    x: float,
    y: float,
    z: float,
    *,
    goal_z: float,
    goal_y: float,
    goal_r: float,
    shield_r: float = DEFAULT_SHIELD_R,
) -> bool:
    """護罩碰到圓環開口（非攻擊手進自家圓環）。

    球心在門面前後一個護罩半徑內，且徑向距離小於內半徑：護罩伸進洞裡。
    只在洞外擦到環管不算進入。
    """
    if abs(z - goal_z) > shield_r + 1e-9:
        return False
    return math.hypot(x, y - goal_y) < goal_r + 1e-9
