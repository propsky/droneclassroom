"""0007 平台管理員、授權期限、學生獨立身分與班級成員。

既有學生仍掛原班級（成員列回填、進度帳本維持 personal），教室碼登入不變。
自行註冊的學生 team_id / student_code 可為空，再自行加入班級。

revision: 0007
down_revision: 0006
"""

from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE platform_admins (
            id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            name TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'disabled')),
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            last_login_at TIMESTAMPTZ
        )
        """
    )
    op.execute("ALTER TABLE teachers ADD COLUMN licensed_until TIMESTAMPTZ")
    op.execute("ALTER TABLE teachers ADD COLUMN email_verified_at TIMESTAMPTZ")
    op.execute("ALTER TABLE students ADD COLUMN licensed_until TIMESTAMPTZ")
    op.execute("ALTER TABLE students ADD COLUMN email_verified_at TIMESTAMPTZ")
    op.execute("ALTER TABLE students ADD COLUMN active_team_id BIGINT REFERENCES teams(id)")
    op.execute(
        "ALTER TABLE students ADD COLUMN progress_mode TEXT NOT NULL DEFAULT 'personal' "
        "CHECK (progress_mode IN ('personal', 'class'))"
    )
    op.execute("ALTER TABLE students ALTER COLUMN team_id DROP NOT NULL")
    op.execute("ALTER TABLE students ALTER COLUMN student_code DROP NOT NULL")
    op.execute("ALTER TABLE students DROP CONSTRAINT IF EXISTS ck_students_status")
    op.execute(
        "ALTER TABLE students ADD CONSTRAINT ck_students_status "
        "CHECK (status IN ('active', 'disabled', 'removed'))"
    )
    op.execute("UPDATE students SET active_team_id = team_id WHERE team_id IS NOT NULL")
    op.execute(
        """
        CREATE TABLE student_memberships (
            id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            student_id BIGINT NOT NULL REFERENCES students(id),
            team_id BIGINT NOT NULL REFERENCES teams(id),
            student_code TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'left')),
            joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            left_at TIMESTAMPTZ,
            UNIQUE (student_id, team_id)
        )
        """
    )
    op.execute(
        "CREATE INDEX ix_student_memberships_team_id ON student_memberships (team_id)"
    )
    op.execute(
        """
        INSERT INTO student_memberships (student_id, team_id, student_code)
        SELECT id, team_id, student_code FROM students
        WHERE team_id IS NOT NULL AND student_code IS NOT NULL
        """
    )
    op.execute(
        """
        CREATE TABLE class_progress (
            student_id BIGINT NOT NULL REFERENCES students(id),
            team_id BIGINT NOT NULL REFERENCES teams(id),
            level_id TEXT NOT NULL,
            best_time_ms INTEGER,
            attempts INTEGER NOT NULL DEFAULT 0,
            first_completed_at TIMESTAMPTZ,
            last_completed_at TIMESTAMPTZ,
            suspect BOOLEAN NOT NULL DEFAULT false,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            PRIMARY KEY (student_id, team_id, level_id)
        )
        """
    )
    op.execute("ALTER TABLE sessions DROP CONSTRAINT IF EXISTS ck_sessions_principal_type")
    op.execute(
        "ALTER TABLE sessions ADD CONSTRAINT ck_sessions_principal_type "
        "CHECK (principal_type IN ('teacher', 'student', 'admin'))"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE sessions DROP CONSTRAINT IF EXISTS ck_sessions_principal_type")
    op.execute(
        "ALTER TABLE sessions ADD CONSTRAINT ck_sessions_principal_type "
        "CHECK (principal_type IN ('teacher', 'student'))"
    )
    op.execute("DROP TABLE IF EXISTS class_progress")
    op.execute("DROP TABLE IF EXISTS student_memberships")
    op.execute("ALTER TABLE students DROP CONSTRAINT IF EXISTS ck_students_status")
    op.execute(
        "ALTER TABLE students ADD CONSTRAINT ck_students_status "
        "CHECK (status IN ('active', 'removed'))"
    )
    op.execute("DELETE FROM students WHERE team_id IS NULL OR student_code IS NULL")
    op.execute("ALTER TABLE students DROP COLUMN IF EXISTS progress_mode")
    op.execute("ALTER TABLE students DROP COLUMN IF EXISTS active_team_id")
    op.execute("ALTER TABLE students DROP COLUMN IF EXISTS email_verified_at")
    op.execute("ALTER TABLE students DROP COLUMN IF EXISTS licensed_until")
    op.execute("ALTER TABLE students ALTER COLUMN student_code SET NOT NULL")
    op.execute("ALTER TABLE students ALTER COLUMN team_id SET NOT NULL")
    op.execute("ALTER TABLE teachers DROP COLUMN IF EXISTS email_verified_at")
    op.execute("ALTER TABLE teachers DROP COLUMN IF EXISTS licensed_until")
    op.execute("DROP TABLE IF EXISTS platform_admins")
