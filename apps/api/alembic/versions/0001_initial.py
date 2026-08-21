"""0001 初始 schema：七張表（docs/db-schema.md）+ 預設 organization。

Revision ID: 0001
Revises:
Create Date: 2026-08-19 19:04:29.981405

autogenerate 產出後已人工逐表檢視：CHECK（plan / role / status / invite_status /
principal_type / actor_type / max_students > 0 / jsonb_typeof = object）、UNIQUE
（slug / team_code / token_hash / dedupe_key / (team_id, student_code)）、FK 與 FK 欄位索引、
teachers 的 LOWER(email) 唯一表達式索引、students 的 (team_id, LOWER(email)) 部分唯一索引、
audit_events / progress / sessions 的複合索引皆在；末尾加 data migration 插入預設 org。
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# Alembic 版本識別
revision: str = "0001"
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "organizations",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=True), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("slug", sa.Text(), nullable=False),
        sa.Column("plan", sa.Text(), server_default="trial", nullable=False),
        sa.Column(
            "settings",
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
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "jsonb_typeof(settings) = 'object'", name=op.f("ck_organizations_settings_object")
        ),
        sa.CheckConstraint(
            "plan IN ('trial', 'school', 'enterprise')", name=op.f("ck_organizations_plan")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_organizations")),
        sa.UniqueConstraint("slug", name=op.f("uq_organizations_slug")),
    )
    op.create_table(
        "sessions",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=True), nullable=False),
        sa.Column("token_hash", sa.Text(), nullable=False),
        sa.Column("principal_type", sa.Text(), nullable=False),
        sa.Column("principal_id", sa.BigInteger(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "last_seen_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("user_agent", sa.Text(), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "principal_type IN ('teacher', 'student')", name=op.f("ck_sessions_principal_type")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_sessions")),
        sa.UniqueConstraint("token_hash", name=op.f("uq_sessions_token_hash")),
    )
    op.create_index(
        "ix_sessions_principal_type_principal_id",
        "sessions",
        ["principal_type", "principal_id"],
        unique=False,
    )
    op.create_table(
        "teachers",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=True), nullable=False),
        sa.Column("org_id", sa.BigInteger(), nullable=False),
        sa.Column("email", sa.Text(), nullable=False),
        sa.Column("password_hash", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("role", sa.Text(), server_default="teacher", nullable=False),
        sa.Column("status", sa.Text(), server_default="active", nullable=False),
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
        sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("role IN ('teacher', 'org_admin')", name=op.f("ck_teachers_role")),
        sa.CheckConstraint("status IN ('active', 'disabled')", name=op.f("ck_teachers_status")),
        sa.ForeignKeyConstraint(
            ["org_id"], ["organizations.id"], name=op.f("fk_teachers_org_id_organizations")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_teachers")),
    )
    op.create_index(op.f("ix_teachers_org_id"), "teachers", ["org_id"], unique=False)
    op.create_index(
        "uq_teachers_lower_email", "teachers", [sa.literal_column("lower(email)")], unique=True
    )
    op.create_table(
        "teams",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=True), nullable=False),
        sa.Column("org_id", sa.BigInteger(), nullable=False),
        sa.Column("owner_teacher_id", sa.BigInteger(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("team_code", sa.Text(), nullable=False),
        sa.Column("join_password_hash", sa.Text(), nullable=True),
        sa.Column("max_students", sa.Integer(), server_default="30", nullable=False),
        sa.Column("locked", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column(
            "settings",
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
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "jsonb_typeof(settings) = 'object'", name=op.f("ck_teams_settings_object")
        ),
        sa.CheckConstraint("max_students > 0", name=op.f("ck_teams_max_students_positive")),
        sa.ForeignKeyConstraint(
            ["org_id"], ["organizations.id"], name=op.f("fk_teams_org_id_organizations")
        ),
        sa.ForeignKeyConstraint(
            ["owner_teacher_id"], ["teachers.id"], name=op.f("fk_teams_owner_teacher_id_teachers")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_teams")),
        sa.UniqueConstraint("team_code", name=op.f("uq_teams_team_code")),
    )
    op.create_index(op.f("ix_teams_org_id"), "teams", ["org_id"], unique=False)
    op.create_index(op.f("ix_teams_owner_teacher_id"), "teams", ["owner_teacher_id"], unique=False)
    op.create_table(
        "students",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=True), nullable=False),
        sa.Column("team_id", sa.BigInteger(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("emoji", sa.Text(), server_default="🙂", nullable=False),
        sa.Column("email", sa.Text(), nullable=True),
        sa.Column("password_hash", sa.Text(), nullable=True),
        sa.Column("student_code", sa.Text(), nullable=False),
        sa.Column("invite_status", sa.Text(), server_default="none", nullable=False),
        sa.Column("status", sa.Text(), server_default="active", nullable=False),
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
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "invite_status IN ('none', 'sent', 'accepted')", name=op.f("ck_students_invite_status")
        ),
        sa.CheckConstraint("status IN ('active', 'removed')", name=op.f("ck_students_status")),
        sa.ForeignKeyConstraint(["team_id"], ["teams.id"], name=op.f("fk_students_team_id_teams")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_students")),
        sa.UniqueConstraint(
            "team_id", "student_code", name=op.f("uq_students_team_id_student_code")
        ),
    )
    op.create_index(op.f("ix_students_team_id"), "students", ["team_id"], unique=False)
    op.create_index(
        "uq_students_team_id_lower_email",
        "students",
        [sa.literal_column("team_id"), sa.literal_column("lower(email)")],
        unique=True,
        postgresql_where=sa.text("email IS NOT NULL"),
    )
    op.create_table(
        "audit_events",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=True), nullable=False),
        sa.Column(
            "occurred_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("org_id", sa.BigInteger(), nullable=True),
        sa.Column("actor_type", sa.Text(), nullable=False),
        sa.Column("actor_id", sa.BigInteger(), nullable=True),
        sa.Column("event_type", sa.Text(), nullable=False),
        sa.Column("team_id", sa.BigInteger(), nullable=True),
        sa.Column("student_id", sa.BigInteger(), nullable=True),
        sa.Column(
            "payload",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column("dedupe_key", sa.Text(), nullable=True),
        sa.CheckConstraint(
            "actor_type IN ('teacher', 'student', 'system')",
            name=op.f("ck_audit_events_actor_type"),
        ),
        sa.CheckConstraint(
            "jsonb_typeof(payload) = 'object'", name=op.f("ck_audit_events_payload_object")
        ),
        sa.ForeignKeyConstraint(
            ["org_id"], ["organizations.id"], name=op.f("fk_audit_events_org_id_organizations")
        ),
        sa.ForeignKeyConstraint(
            ["student_id"], ["students.id"], name=op.f("fk_audit_events_student_id_students")
        ),
        sa.ForeignKeyConstraint(
            ["team_id"], ["teams.id"], name=op.f("fk_audit_events_team_id_teams")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_audit_events")),
        sa.UniqueConstraint("dedupe_key", name=op.f("uq_audit_events_dedupe_key")),
    )
    op.create_index(
        "ix_audit_events_event_type_occurred_at",
        "audit_events",
        ["event_type", "occurred_at"],
        unique=False,
    )
    op.create_index(
        "ix_audit_events_org_id_occurred_at",
        "audit_events",
        ["org_id", "occurred_at"],
        unique=False,
    )
    op.create_index(
        op.f("ix_audit_events_student_id"), "audit_events", ["student_id"], unique=False
    )
    op.create_index(op.f("ix_audit_events_team_id"), "audit_events", ["team_id"], unique=False)
    op.create_table(
        "progress",
        sa.Column("student_id", sa.BigInteger(), nullable=False),
        sa.Column("level_id", sa.Text(), nullable=False),
        sa.Column("best_time_ms", sa.Integer(), nullable=True),
        sa.Column("attempts", sa.Integer(), server_default="0", nullable=False),
        sa.Column("first_completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("suspect", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["student_id"], ["students.id"], name=op.f("fk_progress_student_id_students")
        ),
        sa.PrimaryKeyConstraint("student_id", "level_id", name=op.f("pk_progress")),
    )
    op.create_index(
        "ix_progress_level_id_best_time_ms", "progress", ["level_id", "best_time_ms"], unique=False
    )

    # data migration：預設 organization（slug 'default'），起步期所有老師先掛這裡
    op.execute(
        "INSERT INTO organizations (name, slug) VALUES ('預設單位', 'default') "
        "ON CONFLICT (slug) DO NOTHING"
    )


def downgrade() -> None:
    op.drop_index("ix_progress_level_id_best_time_ms", table_name="progress")
    op.drop_table("progress")
    op.drop_index(op.f("ix_audit_events_team_id"), table_name="audit_events")
    op.drop_index(op.f("ix_audit_events_student_id"), table_name="audit_events")
    op.drop_index("ix_audit_events_org_id_occurred_at", table_name="audit_events")
    op.drop_index("ix_audit_events_event_type_occurred_at", table_name="audit_events")
    op.drop_table("audit_events")
    op.drop_index(
        "uq_students_team_id_lower_email",
        table_name="students",
        postgresql_where=sa.text("email IS NOT NULL"),
    )
    op.drop_index(op.f("ix_students_team_id"), table_name="students")
    op.drop_table("students")
    op.drop_index(op.f("ix_teams_owner_teacher_id"), table_name="teams")
    op.drop_index(op.f("ix_teams_org_id"), table_name="teams")
    op.drop_table("teams")
    op.drop_index("uq_teachers_lower_email", table_name="teachers")
    op.drop_index(op.f("ix_teachers_org_id"), table_name="teachers")
    op.drop_table("teachers")
    op.drop_index("ix_sessions_principal_type_principal_id", table_name="sessions")
    op.drop_table("sessions")
    op.drop_table("organizations")
