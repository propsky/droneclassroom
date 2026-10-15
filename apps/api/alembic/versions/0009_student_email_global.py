"""0009 學生 email 全站唯一、班級學生碼唯一、成員來源。

不在這支 migration 合併重複帳號。有重複 email 就中止，請先跑
`uv run python -m app.student_merge`（dry-run，不寫入），確認後才
`uv run python -m app.student_merge --apply`，再重跑 upgrade。

downgrade 只拿掉約束，不會把已合併的帳號拆回去。

revision: 0009
down_revision: 0008
"""

from sqlalchemy import text

from alembic import op

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    dupes = conn.execute(
        text(
            """
            SELECT lower(email) AS email, count(*) AS n
            FROM students
            WHERE email IS NOT NULL
            GROUP BY lower(email)
            HAVING count(*) > 1
            ORDER BY email
            """
        )
    ).fetchall()
    if dupes:
        preview = "\n".join(f"  {row.email} × {row.n}" for row in dupes[:20])
        extra = "" if len(dupes) <= 20 else f"\n  …共 {len(dupes)} 組"
        raise RuntimeError(
            "students.email 仍有重複，不能建立全站唯一索引。\n"
            "這次 migration 不會自動合併，也不會改正式資料。\n"
            "請先在 apps/api 看 dry-run（只印會合併誰）：\n"
            "  uv run python -m app.student_merge\n"
            "確認後才寫入：\n"
            "  uv run python -m app.student_merge --apply\n"
            "完成後再執行 uv run creafly-migrate。\n"
            f"重複 email：\n{preview}{extra}"
        )
    code_dupes = conn.execute(
        text(
            """
            SELECT team_id, student_code, count(*) AS n
            FROM student_memberships
            GROUP BY team_id, student_code
            HAVING count(*) > 1
            """
        )
    ).fetchall()
    if code_dupes:
        preview = ", ".join(
            f"team {row.team_id} 學生碼 {row.student_code} × {row.n}" for row in code_dupes[:20]
        )
        raise RuntimeError(
            "student_memberships 有重複的班級學生碼，請先人工處理再遷移：" + preview
        )
    op.execute("DROP INDEX IF EXISTS uq_students_team_id_lower_email")
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_students_lower_email "
        "ON students (lower(email)) WHERE email IS NOT NULL"
    )
    op.execute(
        "ALTER TABLE student_memberships "
        "ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT 'created'"
    )
    op.execute(
        """
        DO $$ BEGIN
          ALTER TABLE student_memberships
            ADD CONSTRAINT ck_student_memberships_origin
            CHECK (origin IN ('created', 'linked'));
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$
        """
    )
    op.execute(
        """
        DO $$ BEGIN
          ALTER TABLE student_memberships
            ADD CONSTRAINT uq_student_memberships_team_id_student_code
            UNIQUE (team_id, student_code);
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$
        """
    )


def downgrade() -> None:
    op.execute(
        "ALTER TABLE student_memberships "
        "DROP CONSTRAINT IF EXISTS uq_student_memberships_team_id_student_code"
    )
    op.execute(
        "ALTER TABLE student_memberships DROP CONSTRAINT IF EXISTS ck_student_memberships_origin"
    )
    op.execute("ALTER TABLE student_memberships DROP COLUMN IF EXISTS origin")
    op.execute("DROP INDEX IF EXISTS uq_students_lower_email")
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_students_team_id_lower_email "
        "ON students (team_id, lower(email)) WHERE email IS NOT NULL"
    )
