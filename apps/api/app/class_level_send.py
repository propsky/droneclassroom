"""老師全班傳送的目的地。

一般關卡 id 原樣轉發，並結束進行中的大亂鬥與足球。
活動 id（足球練習／足球對戰／大亂鬥場地）見 packages/shared 的 ClassLevelSend；
送進某一場進行中的賽局時不結束該場，還沒進場的學生才能加入。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

ActivitySession = Literal["soccer-practice", "soccer-match", "arena"]
ArenaPlayMode = Literal["balloon", "tag"]
ArenaFieldId = Literal["grid", "playground"]


@dataclass(frozen=True)
class ActivityDestination:
    id: str
    title: str
    session: ActivitySession
    arena_mode: ArenaPlayMode | None = None
    arena_field: ArenaFieldId | None = None


_ACTIVITIES: tuple[ActivityDestination, ...] = (
    ActivityDestination("activity:soccer-practice", "足球練習", "soccer-practice"),
    ActivityDestination("activity:soccer-match", "足球對戰", "soccer-match"),
    ActivityDestination(
        "activity:arena:balloon:grid", "大亂鬥・搶氣球（格線）", "arena", "balloon", "grid"
    ),
    ActivityDestination(
        "activity:arena:balloon:playground",
        "大亂鬥・搶氣球（遊樂場）",
        "arena",
        "balloon",
        "playground",
    ),
    ActivityDestination(
        "activity:arena:tag:grid", "大亂鬥・鬼抓人（格線）", "arena", "tag", "grid"
    ),
    ActivityDestination(
        "activity:arena:tag:playground",
        "大亂鬥・鬼抓人（遊樂場）",
        "arena",
        "tag",
        "playground",
    ),
)

# 沒有 activity: 前綴的舊寫法
_ALIASES: dict[str, str] = {
    "soccer-practice": "activity:soccer-practice",
    "soccer-match": "activity:soccer-match",
    "arena:balloon:grid": "activity:arena:balloon:grid",
    "arena:balloon:playground": "activity:arena:balloon:playground",
    "arena:tag:grid": "activity:arena:tag:grid",
    "arena:tag:playground": "activity:arena:tag:playground",
}

_BY_ID: dict[str, ActivityDestination] = {item.id: item for item in _ACTIVITIES}


class ClassLevelSend:
    """全班傳送到哪一關。與前端 ClassLevelSend 的 id 與停止規則對齊。"""

    @staticmethod
    def activities() -> tuple[ActivityDestination, ...]:
        return _ACTIVITIES

    @staticmethod
    def canonical_id(level_id: str) -> str:
        trimmed = level_id.strip()
        return _ALIASES.get(trimmed, trimmed)

    @staticmethod
    def find(level_id: str) -> ActivityDestination | None:
        return _BY_ID.get(ClassLevelSend.canonical_id(level_id))

    @staticmethod
    def is_activity(level_id: str) -> bool:
        return ClassLevelSend.find(level_id) is not None

    @staticmethod
    def stops_arena(level_id: str) -> bool:
        activity = ClassLevelSend.find(level_id)
        if activity is None:
            return True
        return activity.session != "arena"

    @staticmethod
    def stops_soccer(level_id: str) -> bool:
        activity = ClassLevelSend.find(level_id)
        if activity is None:
            return True
        return activity.session != "soccer-match"
