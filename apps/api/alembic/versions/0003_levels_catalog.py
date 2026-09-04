"""0003 關卡目錄：levels + team_level_entries，seed 官方 16 關、遷移 settings.level_ids。

Revision ID: 0003
Revises: 0002
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from datetime import UTC, datetime
from pathlib import Path

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import Session

from alembic import op

revision: str = "0003"
down_revision: str | Sequence[str] | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

CHAPTER_GROUP_LABELS = {
    1: "官方 · 第 1 章 新手村",
    2: "官方 · 第 2 章 進階飛行",
    3: "官方 · 第 3 章 挑戰賽",
}


def _seed_system_levels_and_team_catalog(connection: sa.Connection) -> None:
    from app.db.models import Level, Team, TeamLevelEntry

    session = Session(bind=connection)
    levels_dir = Path(__file__).resolve().parents[3] / "simulator" / "public" / "levels"
    now = datetime.now(UTC)
    system_levels: list[Level] = []

    for path in sorted(levels_dir.glob("chapter*.json")):
        try:
            chapter = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if not isinstance(chapter, dict) or not isinstance(chapter.get("levels"), list):
            continue
        ch_num = int(chapter["chapter"])
        group_key = f"ch{ch_num}"
        for sort_idx, lvl in enumerate(chapter["levels"]):
            if not isinstance(lvl, dict):
                continue
            level_id = str(lvl.get("id") or "")
            title = str(lvl.get("name") or level_id)
            if not level_id:
                continue
            existing = session.execute(
                sa.select(Level).where(Level.level_id == level_id)
            ).scalar_one_or_none()
            if existing is None:
                row = Level(
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
                session.add(row)
                system_levels.append(row)
            else:
                existing.title = title
                existing.definition = lvl
                existing.default_group = group_key
                existing.sort_key = sort_idx
                system_levels.append(existing)
    session.flush()

    all_system = session.execute(
        sa.select(Level)
        .where(Level.scope == "system", Level.status == "published")
        .order_by(Level.default_group, Level.sort_key, Level.level_id)
    ).scalars().all()

    teams = session.execute(sa.select(Team)).scalars().all()
    for team in teams:
        has_entries = (
            session.execute(
                sa.select(TeamLevelEntry.id)
                .where(TeamLevelEntry.team_id == team.id)
                .limit(1)
            ).scalar_one_or_none()
            is not None
        )
        if has_entries:
            continue
        subset: set[str] | None = None
        if isinstance(team.settings, dict):
            raw = team.settings.get("level_ids")
            if isinstance(raw, list) and raw:
                subset = {str(x) for x in raw if isinstance(x, str)}
        sort = 0
        for lvl in all_system:
            if subset is not None and lvl.level_id not in subset:
                continue
            ch_num = 0
            if lvl.default_group.startswith("ch"):
                try:
                    ch_num = int(lvl.default_group[2:])
                except ValueError:
                    ch_num = 0
            group_label = CHAPTER_GROUP_LABELS.get(ch_num, f"官方 · {lvl.title}")
            session.add(
                TeamLevelEntry(
                    team_id=team.id,
                    level_id=lvl.level_id,
                    group_label=group_label,
                    sort_order=sort,
                    visible_in_menu=True,
                    teacher_broadcastable=True,
                    enabled=True,
                )
            )
            sort += 1
    session.commit()


def upgrade() -> None:
    op.create_table(
        "levels",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=True), nullable=False),
        sa.Column("level_id", sa.Text(), nullable=False),
        sa.Column("scope", sa.Text(), nullable=False),
        sa.Column("org_id", sa.BigInteger(), nullable=True),
        sa.Column("owner_teacher_id", sa.BigInteger(), nullable=True),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column(
            "definition",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column("status", sa.Text(), server_default="published", nullable=False),
        sa.Column("default_group", sa.Text(), server_default="custom", nullable=False),
        sa.Column("sort_key", sa.Integer(), server_default="0", nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("scope IN ('system', 'teacher')", name=op.f("ck_levels_scope")),
        sa.CheckConstraint(
            "status IN ('draft', 'published', 'archived')", name=op.f("ck_levels_status")
        ),
        sa.CheckConstraint(
            "jsonb_typeof(definition) = 'object'", name=op.f("ck_levels_definition_object")
        ),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"], name=op.f("fk_levels_org_id")),
        sa.ForeignKeyConstraint(
            ["owner_teacher_id"], ["teachers.id"], name=op.f("fk_levels_owner_teacher_id")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_levels")),
        sa.UniqueConstraint("level_id", name=op.f("uq_levels_level_id")),
    )
    op.create_index(op.f("ix_levels_org_id_scope"), "levels", ["org_id", "scope"])
    op.create_index(op.f("ix_levels_owner_teacher_id"), "levels", ["owner_teacher_id"])

    op.create_table(
        "team_level_entries",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=True), nullable=False),
        sa.Column("team_id", sa.BigInteger(), nullable=False),
        sa.Column("level_id", sa.Text(), nullable=False),
        sa.Column("group_label", sa.Text(), nullable=False),
        sa.Column("sort_order", sa.Integer(), server_default="0", nullable=False),
        sa.Column(
            "visible_in_menu", sa.Boolean(), server_default=sa.text("true"), nullable=False
        ),
        sa.Column(
            "teacher_broadcastable",
            sa.Boolean(),
            server_default=sa.text("true"),
            nullable=False,
        ),
        sa.Column("enabled", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column(
            "assigned_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("assigned_by", sa.BigInteger(), nullable=True),
        sa.ForeignKeyConstraint(
            ["assigned_by"], ["teachers.id"], name=op.f("fk_team_level_entries_assigned_by")
        ),
        sa.ForeignKeyConstraint(
            ["level_id"], ["levels.level_id"], name=op.f("fk_team_level_entries_level_id")
        ),
        sa.ForeignKeyConstraint(
            ["team_id"], ["teams.id"], name=op.f("fk_team_level_entries_team_id")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_team_level_entries")),
        sa.UniqueConstraint(
            "team_id", "level_id", name=op.f("uq_team_level_entries_team_level")
        ),
    )
    op.create_index(
        op.f("ix_team_level_entries_team_id"), "team_level_entries", ["team_id"]
    )
    op.create_index(
        op.f("ix_team_level_entries_team_id_sort"),
        "team_level_entries",
        ["team_id", "sort_order"],
    )

    _seed_system_levels_and_team_catalog(op.get_bind())


def downgrade() -> None:
    op.drop_index(op.f("ix_team_level_entries_team_id_sort"), table_name="team_level_entries")
    op.drop_index(op.f("ix_team_level_entries_team_id"), table_name="team_level_entries")
    op.drop_table("team_level_entries")
    op.drop_index(op.f("ix_levels_owner_teacher_id"), table_name="levels")
    op.drop_index(op.f("ix_levels_org_id_scope"), table_name="levels")
    op.drop_table("levels")
