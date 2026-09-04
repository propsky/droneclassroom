"""0004 老師自訂關卡素材庫 teacher_level_kits。

Revision ID: 0004
Revises: 0003
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0004"
down_revision: str | Sequence[str] | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "teacher_level_kits",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=True), nullable=False),
        sa.Column("teacher_id", sa.BigInteger(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("desc", sa.Text(), server_default="", nullable=False),
        sa.Column("category", sa.Text(), nullable=False),
        sa.Column(
            "patch",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
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
        sa.CheckConstraint(
            "category IN ('rings', 'obstacles', 'tasks', 'scenes', 'draw', 'races')",
            name="category",
        ),
        sa.CheckConstraint("jsonb_typeof(patch) = 'object'", name="patch_object"),
        sa.ForeignKeyConstraint(["teacher_id"], ["teachers.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_teacher_level_kits_teacher_id",
        "teacher_level_kits",
        ["teacher_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_teacher_level_kits_teacher_id", table_name="teacher_level_kits")
    op.drop_table("teacher_level_kits")
