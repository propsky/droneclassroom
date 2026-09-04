"""0006 sessions purpose 加 reset — 老師忘記密碼重設 token。

revision: 0006
down_revision: 0005
"""

from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 約束名稱為 ck_sessions_purpose（0002 以 op.f 建立，實際 DB 不含雙重前綴）
    op.execute("ALTER TABLE sessions DROP CONSTRAINT IF EXISTS ck_sessions_purpose")
    op.execute(
        "ALTER TABLE sessions ADD CONSTRAINT ck_sessions_purpose "
        "CHECK (purpose IN ('auth', 'invite', 'reset'))"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE sessions DROP CONSTRAINT IF EXISTS ck_sessions_purpose")
    op.execute(
        "ALTER TABLE sessions ADD CONSTRAINT ck_sessions_purpose "
        "CHECK (purpose IN ('auth', 'invite'))"
    )
