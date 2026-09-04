"""entitlement.py — 學生能力包（關卡授權 / 試玩 / 測試開關）。

預設 entitlement_mode=open：welcome 帶全關卡，行為與改版前相同。
register 時 room_joined 可升級帳號 entitlement；client / 伺服器 complete 會檢查授權。
"""

import time
from typing import Literal

from .config import Settings
from .protocol import EntitlementMsg

EntitlementMode = Literal["open", "demo", "licensed"]

_DEFAULT_DEMO_IDS = ("1-0", "1-1", "1-2")


def parse_demo_level_ids(raw: str, known_levels: frozenset[str]) -> list[str]:
    """解析 DEMO_LEVEL_IDS 設定；只保留已知關卡 id。"""
    if not raw.strip():
        fallback = [lid for lid in _DEFAULT_DEMO_IDS if lid in known_levels]
        if fallback:
            return sorted(fallback)
        return sorted(known_levels)[:3]
    ids = [part.strip() for part in raw.split(",") if part.strip()]
    return sorted(lid for lid in ids if lid in known_levels)


def build_welcome_entitlement(cfg: Settings, known_levels: frozenset[str]) -> EntitlementMsg:
    """學生 WS 連上時的下發能力包（register 前；帳號細節在後續 PR 於 room_joined 補強）。"""
    now_ms = int(time.time() * 1000)
    all_ids = sorted(known_levels)
    demo_ids = parse_demo_level_ids(cfg.demo_level_ids, known_levels)

    # 無 DB 或 open：測試 / 本機 / 過渡期 — 全開，不破壞既有流程
    if cfg.entitlement_mode == "open" or not cfg.database_url:
        return EntitlementMsg(
            mode="open",
            levelIds=all_ids,
            canSaveProgress=True,
            canOfflineComplete=True,
            issuedAt=now_ms,
        )

    if cfg.entitlement_mode == "demo_only":
        return EntitlementMsg(
            mode="demo",
            levelIds=demo_ids,
            canSaveProgress=False,
            canOfflineComplete=False,
            issuedAt=now_ms,
        )

    # enforce：連線後、register 前先給試玩包；帳號 register 後由 room_joined 升級
    return EntitlementMsg(
        mode="demo",
        levelIds=demo_ids,
        canSaveProgress=False,
        canOfflineComplete=False,
        issuedAt=now_ms,
    )


def build_register_entitlement(
    cfg: Settings,
    known_levels: frozenset[str],
    *,
    student_id: int | None,
    team_level_ids: list[str] | None = None,
) -> EntitlementMsg | None:
    """register 成功後下發的能力包；open / 無 DB 不回傳（welcome 已足夠）。

    team_level_ids 來自 team_level_entries；None 時視為全關（與無目錄 seed 前相同）。
    """
    if cfg.entitlement_mode == "open" or not cfg.database_url:
        return None

    now_ms = int(time.time() * 1000)
    demo_ids = parse_demo_level_ids(cfg.demo_level_ids, known_levels)

    if student_id is not None and cfg.entitlement_mode == "enforce":
        licensed_ids = team_level_ids if team_level_ids is not None else sorted(known_levels)
        return EntitlementMsg(
            mode="licensed",
            levelIds=licensed_ids,
            canSaveProgress=True,
            canOfflineComplete=True,
            issuedAt=now_ms,
        )

    # 訪客或 demo_only：試玩包（與 welcome 一致，register 時再確認一次）
    return EntitlementMsg(
        mode="demo",
        levelIds=demo_ids,
        canSaveProgress=False,
        canOfflineComplete=False,
        issuedAt=now_ms,
    )
