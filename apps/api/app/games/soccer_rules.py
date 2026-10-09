"""F9A 階段二純規則：護罩是否整顆穿過圓環。

與 apps/simulator/src/soccer/crossing.ts 同一套幾何。伺服器只看位置軌跡的行進方向，
不看機頭朝向，也不只看球心有沒有進洞。護罩半徑來自 soccer_presets（預設 F9A-A）。
"""

import math

from .soccer_presets import F9A_A

# 沒帶 shield_r 時的預設（F9A-A，直徑 40 cm）。賽局應傳場地上的 shield_r。
DEFAULT_SHIELD_R = F9A_A.shield_r
# 罰球 10 秒（攻擊手對一名防守）
PENALTY_SEC = 10.0
# 倒數期間離起飛點超過這個距離，且已經在起飛點報到過 → 搶跑
FALSE_START_RADIUS = 0.45
# 穿越授權的有效時間：逾時的 soccer_goal 不能拿舊軌跡兌換
CROSS_GRANT_MS = 1500.0
# 教學選項：空中機對機沿法線的接近速度（m/s）。
# 2026 F9A.9 沒有「飛在空中互相接近太快就發牌」；預設關閉，見 SoccerGame.air_contact_cards。
# 地面墜機紅牌（soccer_crash）與這條無關，不要混在一起關。
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
    shield_r: float = DEFAULT_SHIELD_R,
) -> bool:
    """整顆護罩沿行進方向穿過圓環才算。

    attack_sign：+1 表示必須往 +z 走（藍隊攻 +z 門）。dz 與它反向、或幾乎沒動，都不算。
    後緣（行進反方向的那一側）跨過門面的那一刻，球心到圓心的徑向距離必須 ≤ 內半徑 − 護罩半徑，
    護罩才整顆在洞裡；球心進洞但擦到框不算。
    """
    dz = curr[2] - prev[2]
    if attack_sign == 0 or dz * attack_sign <= 1e-9:
        return False
    sign = 1.0 if dz > 0.0 else -1.0
    prev_trail = prev[2] - shield_r * sign
    curr_trail = curr[2] - shield_r * sign
    if sign > 0.0:
        if not (prev_trail < goal_z <= curr_trail):
            return False
    elif not (prev_trail > goal_z >= curr_trail):
        return False
    span = curr_trail - prev_trail
    if abs(span) < 1e-12:
        return False
    t = (goal_z - prev_trail) / span
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
