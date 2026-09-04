"""levels_catalog.py — 關卡目錄：官方 seed、班級目錄、curriculum、entitlement 解析。"""

import contextlib
import json
import logging
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from .db.models import Level, Team, TeamLevelEntry

logger = logging.getLogger("creafly.api.levels")

CHAPTER_GROUP_LABELS: dict[int, str] = {
    1: "官方 · 第 1 章 新手村",
    2: "官方 · 第 2 章 進階飛行",
    3: "官方 · 第 3 章 挑戰賽",
}


def _chapter_group_label(chapter: int, name: str) -> str:
    return CHAPTER_GROUP_LABELS.get(chapter, f"官方 · 第 {chapter} 章 {name}")


def load_chapters_from_dir(levels_dir: Path) -> list[dict[str, Any]]:
    """讀 chapter*.json → [{chapter, name, levels: [LevelDef...]}]。"""
    chapters: list[dict[str, Any]] = []
    for path in sorted(levels_dir.glob("chapter*.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(data, dict) or not isinstance(data.get("levels"), list):
                continue
            chapters.append(data)
        except (OSError, ValueError, TypeError):
            logger.warning("[Levels] 關卡檔格式錯誤，略過：%s", path)
    chapters.sort(key=lambda c: int(c.get("chapter", 0)))
    return chapters


async def ensure_system_levels(session: AsyncSession, levels_dir: Path) -> int:
    """從 JSON 目錄 upsert 官方關卡（scope=system, status=published）。回傳 upsert 筆數。"""
    count = 0
    now = datetime.now(UTC)
    for chapter in load_chapters_from_dir(levels_dir):
        ch_num = int(chapter["chapter"])
        group_key = f"ch{ch_num}"
        for sort_idx, lvl in enumerate(chapter["levels"]):
            if not isinstance(lvl, dict):
                continue
            level_id = str(lvl.get("id") or "")
            title = str(lvl.get("name") or level_id)
            if not level_id:
                continue
            stmt = (
                insert(Level)
                .values(
                    level_id=level_id,
                    scope="system",
                    org_id=None,
                    owner_teacher_id=None,
                    title=title,
                    definition=lvl,
                    status="published",
                    default_group=group_key,
                    sort_key=sort_idx,
                    published_at=now,
                )
                .on_conflict_do_update(
                    index_elements=[Level.level_id],
                    set_={
                        "title": title,
                        "definition": lvl,
                        "default_group": group_key,
                        "sort_key": sort_idx,
                        "updated_at": now,
                    },
                )
            )
            await session.execute(stmt)
            count += 1
    await session.commit()
    return count


async def fetch_known_level_ids(
    session: AsyncSession, fallback: frozenset[str]
) -> frozenset[str]:
    """已發布關卡 id（含自訂）；DB 空則回 fallback。"""
    rows = (
        await session.execute(
            select(Level.level_id).where(Level.status == "published")
        )
    ).scalars().all()
    if not rows:
        return fallback
    return frozenset(rows)


async def resolve_team_allowed_ids(
    session: AsyncSession,
    team_id: int | None,
    known_levels: frozenset[str],
) -> list[str]:
    """班級可用關卡 id（team_level_entries 中 enabled 項）；無目錄則全關。"""
    if team_id is not None:
        rows = (
            await session.execute(
                select(TeamLevelEntry.level_id)
                .where(
                    TeamLevelEntry.team_id == team_id,
                    TeamLevelEntry.enabled.is_(True),
                )
                .order_by(TeamLevelEntry.sort_order, TeamLevelEntry.level_id)
            )
        ).scalars().all()
        if rows:
            return sorted(lid for lid in rows if lid in known_levels)
    return sorted(known_levels)


async def seed_team_catalog(
    session: AsyncSession,
    team_id: int,
    *,
    subset_ids: list[str] | None = None,
    teacher_id: int | None = None,
) -> None:
    """新班級預設目錄：全部官方關卡，或 subset_ids 子集。"""
    existing = (
        await session.execute(
            select(TeamLevelEntry.id).where(TeamLevelEntry.team_id == team_id).limit(1)
        )
    ).scalar_one_or_none()
    if existing is not None:
        return

    levels = (
        await session.execute(
            select(Level)
            .where(Level.scope == "system", Level.status == "published")
            .order_by(Level.default_group, Level.sort_key, Level.level_id)
        )
    ).scalars().all()

    allowed = frozenset(subset_ids) if subset_ids else None
    sort = 0
    for lvl in levels:
        if allowed is not None and lvl.level_id not in allowed:
            continue
        ch_num = 0
        if lvl.default_group.startswith("ch"):
            with contextlib.suppress(ValueError):
                ch_num = int(lvl.default_group[2:])
        group_label = _chapter_group_label(ch_num, lvl.title) if ch_num else "官方"
        session.add(
            TeamLevelEntry(
                team_id=team_id,
                level_id=lvl.level_id,
                group_label=group_label,
                sort_order=sort,
                visible_in_menu=True,
                teacher_broadcastable=True,
                enabled=True,
                assigned_by=teacher_id,
            )
        )
        sort += 1
    await session.flush()


async def migrate_team_settings_to_catalog(session: AsyncSession, team: Team) -> None:
    """一次性：teams.settings.level_ids → team_level_entries（migration / 啟動補跑）。"""
    existing = (
        await session.execute(
            select(TeamLevelEntry.id).where(TeamLevelEntry.team_id == team.id).limit(1)
        )
    ).scalar_one_or_none()
    if existing is not None:
        return
    subset: list[str] | None = None
    if isinstance(team.settings, dict):
        raw = team.settings.get("level_ids")
        if isinstance(raw, list) and raw:
            subset = [str(x) for x in raw if isinstance(x, str)]
    await seed_team_catalog(session, team.id, subset_ids=subset)


async def ensure_all_teams_catalog(
    sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    """啟動時為尚無目錄的班級補 seed。"""
    async with sessionmaker() as session:
        teams = (
            await session.execute(select(Team).where(Team.archived_at.is_(None)))
        ).scalars().all()
        for team in teams:
            await migrate_team_settings_to_catalog(session, team)
        await session.commit()


# ---------- Curriculum API 資料 ----------


class CurriculumLevelBrief:
    def __init__(
        self,
        level_id: str,
        title: str,
        kind: Literal["system", "teacher"],
        visible_in_menu: bool,
        teacher_broadcastable: bool,
    ) -> None:
        self.level_id = level_id
        self.title = title
        self.kind = kind
        self.visible_in_menu = visible_in_menu
        self.teacher_broadcastable = teacher_broadcastable


class CurriculumGroup:
    def __init__(self, label: str, sort: int, levels: list[CurriculumLevelBrief]) -> None:
        self.label = label
        self.sort = sort
        self.levels = levels


async def build_team_curriculum(
    session: AsyncSession,
    team_id: int,
    *,
    for_student: bool,
) -> list[CurriculumGroup]:
    """組班級 curriculum groups；學生端只含 visible_in_menu。"""
    q = (
        select(TeamLevelEntry, Level)
        .join(Level, Level.level_id == TeamLevelEntry.level_id)
        .where(
            TeamLevelEntry.team_id == team_id,
            TeamLevelEntry.enabled.is_(True),
            Level.status == "published",
        )
        .order_by(TeamLevelEntry.sort_order, TeamLevelEntry.level_id)
    )
    if for_student:
        q = q.where(TeamLevelEntry.visible_in_menu.is_(True))

    rows = (await session.execute(q)).all()
    groups_map: dict[str, CurriculumGroup] = {}
    for entry, lvl in rows:
        if not for_student and not entry.teacher_broadcastable:
            continue
        label = entry.group_label
        if label not in groups_map:
            groups_map[label] = CurriculumGroup(label=label, sort=entry.sort_order, levels=[])
        groups_map[label].levels.append(
            CurriculumLevelBrief(
                level_id=lvl.level_id,
                title=lvl.title,
                kind="system" if lvl.scope == "system" else "teacher",
                visible_in_menu=entry.visible_in_menu,
                teacher_broadcastable=entry.teacher_broadcastable,
            )
        )
    return sorted(groups_map.values(), key=lambda g: g.sort)


class TeamCatalogEntryRow:
    """班級目錄一列（管理 UI 用，含 disabled 項）。"""

    def __init__(
        self,
        level_id: str,
        title: str,
        kind: Literal["system", "teacher"],
        group_label: str,
        sort_order: int,
        visible_in_menu: bool,
        teacher_broadcastable: bool,
        enabled: bool,
    ) -> None:
        self.level_id = level_id
        self.title = title
        self.kind = kind
        self.group_label = group_label
        self.sort_order = sort_order
        self.visible_in_menu = visible_in_menu
        self.teacher_broadcastable = teacher_broadcastable
        self.enabled = enabled


async def list_team_catalog_entries(
    session: AsyncSession, team_id: int
) -> list[TeamCatalogEntryRow]:
    """班級目錄全列（管理用；含未啟用項）。"""
    rows = (
        await session.execute(
            select(TeamLevelEntry, Level)
            .join(Level, Level.level_id == TeamLevelEntry.level_id)
            .where(TeamLevelEntry.team_id == team_id)
            .order_by(TeamLevelEntry.sort_order, TeamLevelEntry.level_id)
        )
    ).all()
    out: list[TeamCatalogEntryRow] = []
    for entry, lvl in rows:
        out.append(
            TeamCatalogEntryRow(
                level_id=lvl.level_id,
                title=lvl.title,
                kind="system" if lvl.scope == "system" else "teacher",
                group_label=entry.group_label,
                sort_order=entry.sort_order,
                visible_in_menu=entry.visible_in_menu,
                teacher_broadcastable=entry.teacher_broadcastable,
                enabled=entry.enabled,
            )
        )
    return out


async def get_level_definition(
    session: AsyncSession, level_id: str
) -> dict[str, Any] | None:
    row = (
        await session.execute(
            select(Level.definition).where(
                Level.level_id == level_id, Level.status == "published"
            )
        )
    ).scalar_one_or_none()
    return row if isinstance(row, dict) else None


async def create_custom_level_draft(
    session: AsyncSession,
    *,
    org_id: int,
    teacher_id: int,
    title: str,
    template: dict[str, Any] | None = None,
) -> Level:
    """建立自訂關卡草稿；level_id 在 flush 後設為 cl-{id}。"""
    base = template or {
        "id": "draft",
        "name": title,
        "rings": [],
        "obstacles": [],
        "passZones": [],
    }
    base = {**base, "name": title}
    lvl = Level(
        level_id="draft-pending",
        scope="teacher",
        org_id=org_id,
        owner_teacher_id=teacher_id,
        title=title,
        definition=base,
        status="draft",
        default_group="custom",
    )
    session.add(lvl)
    await session.flush()
    lvl.level_id = f"cl-{lvl.id}"
    lvl.definition = {**base, "id": lvl.level_id}
    await session.flush()
    await session.refresh(lvl)
    return lvl
