"""models.py — 七張表，逐欄對照 docs/db-schema.md。

慣例（見 db-schema.md §1）：snake_case、BIGINT GENERATED ALWAYS AS IDENTITY 主鍵、
TIMESTAMPTZ 由 DB now() 產生、TEXT 不用 varchar(n)、FK 欄位必建索引、
狀態欄用 TEXT + CHECK（不用 enum 型別）。

不放 relationship()：目前沒有 ORM 導覽需求，下一步（帳號 / 班級）按查詢需要再加，
避免為了「看起來完整」先鋪一層 lazy-load 地雷。
"""

from datetime import datetime
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Identity,
    Index,
    Integer,
    PrimaryKeyConstraint,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base

# ---------- 共用欄位片段 ----------

# timestamptz NOT NULL DEFAULT now()
_NOW = func.now()
# jsonb NOT NULL DEFAULT '{}'
_EMPTY_JSON = text("'{}'::jsonb")


def _id_column() -> Mapped[int]:
    """BIGINT GENERATED ALWAYS AS IDENTITY 主鍵。"""
    return mapped_column(BigInteger, Identity(always=True), primary_key=True)


def _created_at() -> Mapped[datetime]:
    return mapped_column(DateTime(timezone=True), nullable=False, server_default=_NOW)


def _updated_at() -> Mapped[datetime]:
    """DB 預設 now()；ORM 經由 session 更新時由 onupdate 補 now()（UPDATE 帶 now()）。"""
    return mapped_column(
        DateTime(timezone=True), nullable=False, server_default=_NOW, onupdate=_NOW
    )


def _json_object_check(column: str) -> CheckConstraint:
    """jsonb 欄位必須是 object（不接受頂層 array / 純值）。"""
    return CheckConstraint(f"jsonb_typeof({column}) = 'object'", name=f"{column}_object")


# ---------- organizations — 學校 / 單位（租戶邊界）----------


class Organization(Base):
    __tablename__ = "organizations"
    __table_args__ = (
        CheckConstraint("plan IN ('trial', 'school', 'enterprise')", name="plan"),
        _json_object_check("settings"),
    )

    id: Mapped[int] = _id_column()
    name: Mapped[str] = mapped_column(Text, nullable=False)
    # 短代號（URL / 報表用，小寫英數-）
    slug: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    # 方案；計費細節未來另表
    plan: Mapped[str] = mapped_column(Text, nullable=False, server_default="trial")
    # 租戶層設定（選配屬性放這，不為每個開關加欄位）
    settings: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, server_default=_EMPTY_JSON
    )
    created_at: Mapped[datetime] = _created_at()
    updated_at: Mapped[datetime] = _updated_at()
    # 軟刪除（租戶資料不硬刪）
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


# ---------- levels — 關卡定義（官方 system + 老師自訂 teacher）----------


class Level(Base):
    __tablename__ = "levels"
    __table_args__ = (
        CheckConstraint("scope IN ('system', 'teacher')", name="scope"),
        CheckConstraint(
            "status IN ('draft', 'published', 'archived')", name="status"
        ),
        _json_object_check("definition"),
        Index("ix_levels_org_id_scope", "org_id", "scope"),
        Index("ix_levels_owner_teacher_id", "owner_teacher_id"),
    )

    id: Mapped[int] = _id_column()
    # 全域唯一：官方 "1-0"、自訂 "cl-7"
    level_id: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    scope: Mapped[str] = mapped_column(Text, nullable=False)
    org_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("organizations.id"), index=True
    )
    owner_teacher_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("teachers.id")
    )
    title: Mapped[str] = mapped_column(Text, nullable=False)
    definition: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, server_default=_EMPTY_JSON
    )
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default="published")
    # 預設分組鍵（官方 ch1/ch2/ch3；自訂 custom）
    default_group: Mapped[str] = mapped_column(Text, nullable=False, server_default="custom")
    sort_key: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    created_at: Mapped[datetime] = _created_at()
    updated_at: Mapped[datetime] = _updated_at()
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


# ---------- team_level_entries — 班級關卡目錄（上架、分類、可見性）----------


class TeamLevelEntry(Base):
    __tablename__ = "team_level_entries"
    __table_args__ = (
        UniqueConstraint("team_id", "level_id", name="uq_team_level_entries_team_level"),
        Index("ix_team_level_entries_team_id_sort", "team_id", "sort_order"),
    )

    id: Mapped[int] = _id_column()
    team_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("teams.id"), nullable=False, index=True
    )
    level_id: Mapped[str] = mapped_column(
        Text, ForeignKey("levels.level_id"), nullable=False
    )
    group_label: Mapped[str] = mapped_column(Text, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    visible_in_menu: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("true")
    )
    teacher_broadcastable: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("true")
    )
    enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("true")
    )
    assigned_at: Mapped[datetime] = _created_at()
    assigned_by: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("teachers.id")
    )


# ---------- teachers — 老師帳號 ----------


class Teacher(Base):
    __tablename__ = "teachers"
    __table_args__ = (
        CheckConstraint("role IN ('teacher', 'org_admin')", name="role"),
        CheckConstraint("status IN ('active', 'disabled')", name="status"),
        # email 大小寫不敏感唯一
        Index("uq_teachers_lower_email", func.lower(text("email")), unique=True),
    )

    id: Mapped[int] = _id_column()
    org_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("organizations.id"), nullable=False, index=True
    )
    email: Mapped[str] = mapped_column(Text, nullable=False)
    # argon2id
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    # org_admin 可管同校老師；平台管理員不在此表
    role: Mapped[str] = mapped_column(Text, nullable=False, server_default="teacher")
    # 停權不刪帳
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default="active")
    created_at: Mapped[datetime] = _created_at()
    updated_at: Mapped[datetime] = _updated_at()
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


# ---------- teams — 賽隊 / 班級（= Room 持久化）----------


class Team(Base):
    __tablename__ = "teams"
    __table_args__ = (
        CheckConstraint("max_students > 0", name="max_students_positive"),
        _json_object_check("settings"),
    )

    id: Mapped[int] = _id_column()
    # 租戶隔離查詢用
    org_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("organizations.id"), nullable=False, index=True
    )
    # 建隊老師（同校多老師共管：未來 team_teachers 關聯表）
    owner_teacher_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("teachers.id"), nullable=False, index=True
    )
    # 「三年二班」「飛鷹隊」
    name: Mapped[str] = mapped_column(Text, nullable=False)
    # 固定加入碼（4–6 碼，去 0/O/1/I；對應 Room.code）
    team_code: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    # 加入密碼（選配）
    join_password_hash: Mapped[str | None] = mapped_column(Text)
    max_students: Mapped[int] = mapped_column(Integer, nullable=False, server_default="30")
    # 鎖隊：禁止新加入
    locked: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    # 隊伍層選配（分房 rooms；level_ids 已遷至 team_level_entries）
    settings: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, server_default=_EMPTY_JSON
    )
    created_at: Mapped[datetime] = _created_at()
    updated_at: Mapped[datetime] = _updated_at()
    # 學期結束封存（保留紀錄、不出現在列表）
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


# ---------- students — 學生（老師建、邀請制；可無 email）----------


class Student(Base):
    __tablename__ = "students"
    __table_args__ = (
        # 隊內學生碼唯一；無 email 學生用 team_code + student_code 登入
        UniqueConstraint("team_id", "student_code"),
        CheckConstraint("invite_status IN ('none', 'sent', 'accepted')", name="invite_status"),
        CheckConstraint("status IN ('active', 'removed')", name="status"),
        # 有 email 者隊內唯一（大小寫不敏感）：部分唯一索引
        Index(
            "uq_students_team_id_lower_email",
            text("team_id"),
            func.lower(text("email")),
            unique=True,
            postgresql_where=text("email IS NOT NULL"),
        ),
    )

    id: Mapped[int] = _id_column()
    team_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("teams.id"), nullable=False, index=True
    )
    # 顯示名
    name: Mapped[str] = mapped_column(Text, nullable=False)
    # 學生端頭像（沿用現有產品語言）
    emoji: Mapped[str] = mapped_column(Text, nullable=False, server_default="🙂")
    # 有 email 才能走邀請信
    email: Mapped[str | None] = mapped_column(Text)
    # 設過密碼才有
    password_hash: Mapped[str | None] = mapped_column(Text)
    # 隊內學生碼（如 "03"）
    student_code: Mapped[str] = mapped_column(Text, nullable=False)
    # 邀請信狀態
    invite_status: Mapped[str] = mapped_column(Text, nullable=False, server_default="none")
    # 老師移除學生 → removed（進度保留可查）
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default="active")
    created_at: Mapped[datetime] = _created_at()
    updated_at: Mapped[datetime] = _updated_at()
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


# ---------- progress — 關卡進度（一生一關一列，upsert）----------


class Progress(Base):
    __tablename__ = "progress"
    __table_args__ = (
        # PK 即唯一索引：ON CONFLICT (student_id, level_id) DO UPDATE 做 upsert；
        # student_id 是 PK 首欄，FK 查詢已有索引、不另建
        PrimaryKeyConstraint("student_id", "level_id"),
        # 排行查詢
        Index("ix_progress_level_id_best_time_ms", "level_id", "best_time_ms"),
    )

    student_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("students.id"), nullable=False)
    # '1-1' / 'cl-7'；關卡定義在 levels 表
    level_id: Mapped[str] = mapped_column(Text, nullable=False)
    # 最佳成績
    best_time_ms: Mapped[int | None] = mapped_column(Integer)
    # 嘗試次數
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    first_completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # 防作弊標記（進 DB 後不再因重啟消失）
    suspect: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    updated_at: Mapped[datetime] = _updated_at()


# ---------- sessions — 登入 session（老師 / 學生共用）----------


class Session(Base):
    __tablename__ = "sessions"
    __table_args__ = (
        CheckConstraint("principal_type IN ('teacher', 'student')", name="principal_type"),
        CheckConstraint("purpose IN ('auth', 'invite')", name="purpose"),
        # 多型關聯（teachers.id / students.id），用 CHECK 不用 FK
        Index("ix_sessions_principal_type_principal_id", "principal_type", "principal_id"),
    )

    id: Mapped[int] = _id_column()
    # sha256(token)；明文只在發出那一刻給 client
    token_hash: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    principal_type: Mapped[str] = mapped_column(Text, nullable=False)
    principal_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    # 用途：auth = 登入 session；invite = 學生邀請 token（TTL 短、accept 後撤銷，
    # 見 db-schema.md §3「密碼重設 token 表」的擴充點 —— 同機制不另開表）
    purpose: Mapped[str] = mapped_column(Text, nullable=False, server_default="auth")
    # 老師 30 天、學生 90 天，滑動延長
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    # 滑動延長依據；同時是「誰還在線」的粗略訊號
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=_NOW
    )
    created_at: Mapped[datetime] = _created_at()
    # 安全稽核（多裝置登入一眼看出）
    user_agent: Mapped[str | None] = mapped_column(Text)
    # 登出 / 踢出 session（不硬刪，留紀錄）
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


# ---------- audit_events — 稽核事件（append-only）----------


class AuditEvent(Base):
    """只新增、不更新、不刪除；寫入一律走 app.db.audit.record_event。"""

    __tablename__ = "audit_events"
    __table_args__ = (
        CheckConstraint("actor_type IN ('teacher', 'student', 'system')", name="actor_type"),
        _json_object_check("payload"),
        # 租戶範圍查詢
        Index("ix_audit_events_org_id_occurred_at", "org_id", "occurred_at"),
        # 依事件類型查詢
        Index("ix_audit_events_event_type_occurred_at", "event_type", "occurred_at"),
    )

    id: Mapped[int] = _id_column()
    # 伺服器時間（client 時間另放 payload，兩者都留）
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=_NOW
    )
    org_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("organizations.id"))
    # 誰做的
    actor_type: Mapped[str] = mapped_column(Text, nullable=False)
    actor_id: Mapped[int | None] = mapped_column(BigInteger)
    # 事件清單見 db-schema.md §2 audit_events
    event_type: Mapped[str] = mapped_column(Text, nullable=False)
    team_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("teams.id"), index=True)
    # 方便拉「這個學生的全部紀錄」
    student_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("students.id"), index=True
    )
    # 事件細節（成績、關卡、舊值新值、client 時間戳、IP…）
    payload: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, server_default=_EMPTY_JSON
    )
    # 冪等鍵（離線補傳 / 重送不重複記）
    dedupe_key: Mapped[str | None] = mapped_column(Text, unique=True)
