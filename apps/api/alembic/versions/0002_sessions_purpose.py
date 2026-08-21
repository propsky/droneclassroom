"""0002 sessions 加 purpose 欄位（auth / invite）— 學生邀請 token 走 sessions 同機制。

Revision ID: 0002
Revises: 0001
Create Date: 2026-08-20 17:01:21.400708

autogenerate 產出後已人工檢視：既有列 server_default 'auth' 回填（老師 / 學生登入
session 全是 auth）、CHECK purpose IN ('auth','invite') 齊；downgrade 反向可逆。
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# Alembic 版本識別
revision: str = "0002"
down_revision: str | Sequence[str] | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "sessions", sa.Column("purpose", sa.Text(), server_default="auth", nullable=False)
    )
    op.create_check_constraint(
        op.f("ck_sessions_purpose"), "sessions", "purpose IN ('auth', 'invite')"
    )


def downgrade() -> None:
    op.drop_constraint(op.f("ck_sessions_purpose"), "sessions", type_="check")
    op.drop_column("sessions", "purpose")
