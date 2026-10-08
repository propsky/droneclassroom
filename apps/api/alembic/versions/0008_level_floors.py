"""0008 關卡場地地板圖。

圖片本體放 level_floors（BYTEA），關卡 JSON 只留相對網址。
JPEG / PNG / WebP，最大 2 MB（應用層再檢查檔頭）。

revision: 0008
down_revision: 0007
"""

from alembic import op

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE level_floors (
            level_pk BIGINT PRIMARY KEY REFERENCES levels(id) ON DELETE CASCADE,
            content_type TEXT NOT NULL,
            byte_size INTEGER NOT NULL CHECK (byte_size > 0 AND byte_size <= 2097152),
            data BYTEA NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS level_floors")
