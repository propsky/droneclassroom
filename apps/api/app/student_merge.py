"""合併重複 email 的學生帳號。

預設只印 dry-run，不寫入。正式資料要合併時才加 --apply。

規則（同一組 lower(email)）：
- 保留帳號：有設密碼的優先，其次較早建立、id 較小。
- 被併入的帳號若有原班級，個人進度改記到「那個班」的 ClassProgress，
  不跟其他班或保留帳號的個人帳本混在一起。
- 保留帳號自己的個人進度不動。
- 各班 ClassProgress 跟著成員改掛到保留帳號，同一班同一關才合併成績。
- 被併入的帳號清掉 email、狀態改 removed、登入 session 撤銷。不刪列（稽核還指著它）。

    uv run python -m app.student_merge
    uv run python -m app.student_merge --apply
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from dataclasses import dataclass, field
from datetime import UTC, datetime

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from .db.models import ClassProgress, Progress, Student, StudentMembership, Team
from .db.models import Session as SessionRow
from .db.session import create_engine, create_sessionmaker


@dataclass
class StudentSnap:
    id: int
    name: str
    email: str
    team_id: int | None
    team_name: str
    student_code: str | None
    has_password: bool
    created_at: datetime
    status: str


@dataclass
class MembershipSnap:
    student_id: int
    team_id: int
    team_name: str
    student_code: str
    status: str


@dataclass
class LevelSnap:
    student_id: int
    level_id: str
    team_id: int | None
    attempts: int


@dataclass
class DropPlan:
    student_id: int
    name: str
    team_id: int | None
    team_name: str
    lines: list[str]
    # 個人進度改記到這個班；None 且 personal_to_keep 為假 = 沒有個人進度要搬
    personal_to_team_id: int | None
    personal_to_keep: bool
    class_team_ids: list[int]


@dataclass
class MergeGroup:
    email: str
    keep_id: int
    keep_name: str
    keep_reason: str
    drops: list[DropPlan] = field(default_factory=list)


def choose_keep(students: list[StudentSnap]) -> StudentSnap:
    """有密碼的優先；一樣早的話取較早建立、再取較小 id。"""
    return min(
        students,
        key=lambda s: (0 if s.has_password else 1, s.created_at, s.id),
    )


def _keep_reason(keep: StudentSnap) -> str:
    if keep.has_password and keep.team_id is None:
        return "已設密碼、自行註冊"
    if keep.has_password:
        return "已設密碼"
    return "較早建立（都還沒設密碼）"


def build_groups(
    students: list[StudentSnap],
    memberships: list[MembershipSnap],
    levels: list[LevelSnap],
) -> list[MergeGroup]:
    """純函式：排出會合併誰。不碰資料庫。"""
    by_email: dict[str, list[StudentSnap]] = {}
    for s in students:
        if s.status == "removed" or not s.email:
            continue
        by_email.setdefault(s.email.strip().lower(), []).append(s)
    groups: list[MergeGroup] = []
    for email in sorted(by_email):
        rows = by_email[email]
        if len(rows) < 2:
            continue
        keep = choose_keep(rows)
        group = MergeGroup(
            email=email,
            keep_id=keep.id,
            keep_name=keep.name,
            keep_reason=_keep_reason(keep),
        )
        keep_teams = {m.team_id for m in memberships if m.student_id == keep.id}
        for drop in sorted((s for s in rows if s.id != keep.id), key=lambda s: s.id):
            mems = [m for m in memberships if m.student_id == drop.id]
            personal = [
                lv for lv in levels if lv.student_id == drop.id and lv.team_id is None
            ]
            class_rows = [
                lv for lv in levels if lv.student_id == drop.id and lv.team_id is not None
            ]
            class_team_ids = sorted({lv.team_id for lv in class_rows if lv.team_id is not None})
            lines: list[str] = []
            team_label = drop.team_name or "（沒有原班級）"
            code = drop.student_code or "—"
            lines.append(f"帳號 #{drop.id} {drop.name}／{team_label}（學生碼 {code}）")
            for mem in mems:
                if mem.team_id in keep_teams:
                    lines.append(
                        f"  班級「{mem.team_name}」保留帳號已在班上，沿用保留帳號的學生碼，"
                        f"不另建一筆（捨棄學生碼 {mem.student_code}）"
                    )
                else:
                    lines.append(
                        f"  班級「{mem.team_name}」成員改掛到 #{keep.id}，"
                        f"學生碼仍是 {mem.student_code}"
                    )
            personal_to_team: int | None = None
            personal_to_keep = False
            if personal and drop.team_id is not None:
                personal_to_team = drop.team_id
                lines.append(
                    f"  個人進度 {len(personal)} 關改記為"
                    f"「{drop.team_name or '原班級'}」的班級進度，"
                    "不併進其他班，也不併進保留帳號的個人帳本"
                )
            elif personal:
                personal_to_keep = True
                lines.append(
                    f"  沒有原班級，個人進度 {len(personal)} 關併入保留帳號的個人帳本"
                )
            if class_team_ids:
                lines.append(
                    "  既有班級進度改掛到保留帳號，各班各關維持分開："
                    + "、".join(f"team #{tid}" for tid in class_team_ids)
                )
            lines.append("  清掉 email、狀態改為 removed、撤銷登入（列保留給稽核）")
            group.drops.append(
                DropPlan(
                    student_id=drop.id,
                    name=drop.name,
                    team_id=drop.team_id,
                    team_name=drop.team_name,
                    lines=lines,
                    personal_to_team_id=personal_to_team,
                    personal_to_keep=personal_to_keep,
                    class_team_ids=class_team_ids,
                )
            )
        groups.append(group)
    return groups


def format_dry_run(groups: list[MergeGroup]) -> str:
    """給老師看的報告。字樣固定含「不會寫入」，避免把 dry-run 當成已合併。"""
    head = [
        "CREAFLY 學生 email 合併 dry-run",
        "只列出會合併誰，不會寫入資料庫。",
        "確認後才執行：uv run python -m app.student_merge --apply",
        "",
    ]
    if not groups:
        head.append("沒有重複的 email，不用合併。")
        return "\n".join(head)
    head.append(f"重複 email：{len(groups)} 組")
    lines = head
    for g in groups:
        lines.append("")
        lines.append(f"── {g.email} ──")
        lines.append(f"保留帳號 #{g.keep_id} {g.keep_name}（{g.keep_reason}）")
        lines.append("保留帳號自己的個人進度帳本不動。")
        for drop in g.drops:
            lines.extend(drop.lines)
    lines.append("")
    lines.append("以上不會寫入。")
    return "\n".join(lines)


def _async_url(url: str) -> str:
    if url.startswith("postgresql+asyncpg://"):
        return url
    if url.startswith("postgresql://"):
        return "postgresql+asyncpg://" + url[len("postgresql://") :]
    if url.startswith("postgres://"):
        return "postgresql+asyncpg://" + url[len("postgres://") :]
    return url


async def _load(
    session: AsyncSession,
) -> tuple[list[StudentSnap], list[MembershipSnap], list[LevelSnap]]:
    dup_emails = (
        await session.execute(
            select(func.lower(Student.email))
            .where(Student.email.is_not(None))
            .group_by(func.lower(Student.email))
            .having(func.count() > 1)
        )
    ).scalars().all()
    emails = [e for e in dup_emails if e]
    if not emails:
        return [], [], []
    students = (
        (
            await session.execute(
                select(Student).where(func.lower(Student.email).in_(emails))
            )
        )
        .scalars()
        .all()
    )
    ids = [s.id for s in students]
    team_ids = {s.team_id for s in students if s.team_id is not None}
    mem_rows = (
        await session.execute(
            select(StudentMembership, Team)
            .join(Team, Team.id == StudentMembership.team_id)
            .where(StudentMembership.student_id.in_(ids))
        )
    ).all()
    for _mem, team in mem_rows:
        team_ids.add(team.id)
    teams = {}
    if team_ids:
        teams = {
            t.id: t
            for t in (
                await session.execute(select(Team).where(Team.id.in_(team_ids)))
            ).scalars()
        }
    snaps = [
        StudentSnap(
            id=s.id,
            name=s.name,
            email=(s.email or "").strip().lower(),
            team_id=s.team_id,
            team_name=teams[s.team_id].name if s.team_id in teams else "",
            student_code=s.student_code,
            has_password=s.password_hash is not None,
            created_at=s.created_at,
            status=s.status,
        )
        for s in students
    ]
    memberships = [
        MembershipSnap(
            student_id=mem.student_id,
            team_id=mem.team_id,
            team_name=team.name,
            student_code=mem.student_code,
            status=mem.status,
        )
        for mem, team in mem_rows
    ]
    personal = (
        await session.execute(select(Progress).where(Progress.student_id.in_(ids)))
    ).scalars().all()
    class_rows = (
        await session.execute(
            select(ClassProgress).where(ClassProgress.student_id.in_(ids))
        )
    ).scalars().all()
    levels = [
        LevelSnap(student_id=p.student_id, level_id=p.level_id, team_id=None, attempts=p.attempts)
        for p in personal
    ] + [
        LevelSnap(
            student_id=p.student_id, level_id=p.level_id, team_id=p.team_id, attempts=p.attempts
        )
        for p in class_rows
    ]
    return snaps, memberships, levels


def _merge_level(dst: Progress | ClassProgress, src: Progress | ClassProgress) -> None:
    times = [t for t in (dst.best_time_ms, src.best_time_ms) if t is not None]
    dst.best_time_ms = min(times) if times else None
    dst.attempts = (dst.attempts or 0) + (src.attempts or 0)
    firsts = [t for t in (dst.first_completed_at, src.first_completed_at) if t is not None]
    lasts = [t for t in (dst.last_completed_at, src.last_completed_at) if t is not None]
    dst.first_completed_at = min(firsts) if firsts else None
    dst.last_completed_at = max(lasts) if lasts else None
    dst.suspect = bool(dst.suspect or src.suspect)


async def _move_class_row(
    session: AsyncSession, src: ClassProgress, keep_id: int
) -> None:
    dst = await session.get(ClassProgress, (keep_id, src.team_id, src.level_id))
    if dst is None:
        session.add(
            ClassProgress(
                student_id=keep_id,
                team_id=src.team_id,
                level_id=src.level_id,
                best_time_ms=src.best_time_ms,
                attempts=src.attempts,
                first_completed_at=src.first_completed_at,
                last_completed_at=src.last_completed_at,
                suspect=src.suspect,
            )
        )
    else:
        _merge_level(dst, src)
    await session.delete(src)
    await session.flush()


async def _move_personal_to_class(
    session: AsyncSession, src: Progress, keep_id: int, team_id: int
) -> None:
    dst = await session.get(ClassProgress, (keep_id, team_id, src.level_id))
    if dst is None:
        session.add(
            ClassProgress(
                student_id=keep_id,
                team_id=team_id,
                level_id=src.level_id,
                best_time_ms=src.best_time_ms,
                attempts=src.attempts,
                first_completed_at=src.first_completed_at,
                last_completed_at=src.last_completed_at,
                suspect=src.suspect,
            )
        )
    else:
        _merge_level(dst, src)
    await session.delete(src)
    await session.flush()


async def _move_personal_to_personal(
    session: AsyncSession, src: Progress, keep_id: int
) -> None:
    dst = await session.get(Progress, (keep_id, src.level_id))
    if dst is None:
        session.add(
            Progress(
                student_id=keep_id,
                level_id=src.level_id,
                best_time_ms=src.best_time_ms,
                attempts=src.attempts,
                first_completed_at=src.first_completed_at,
                last_completed_at=src.last_completed_at,
                suspect=src.suspect,
            )
        )
    else:
        _merge_level(dst, src)
    await session.delete(src)
    await session.flush()


async def apply_groups(session: AsyncSession, groups: list[MergeGroup]) -> None:
    """依 build_groups 的結果寫入。呼叫端負責 commit。"""
    now = datetime.now(UTC)
    for group in groups:
        keep = await session.get(Student, group.keep_id)
        if keep is None:
            continue
        for drop_plan in group.drops:
            drop = await session.get(Student, drop_plan.student_id)
            if drop is None or drop.id == keep.id:
                continue
            mems = (
                (
                    await session.execute(
                        select(StudentMembership).where(
                            StudentMembership.student_id == drop.id
                        )
                    )
                )
                .scalars()
                .all()
            )
            for mem in mems:
                existing = (
                    await session.execute(
                        select(StudentMembership).where(
                            StudentMembership.student_id == keep.id,
                            StudentMembership.team_id == mem.team_id,
                        )
                    )
                ).scalar_one_or_none()
                if existing is None:
                    mem.student_id = keep.id
                    mem.origin = "linked"
                    await session.flush()
                else:
                    if existing.status != "active" and mem.status == "active":
                        existing.status = "active"
                        existing.left_at = None
                    await session.delete(mem)
                    await session.flush()
            class_rows = (
                (
                    await session.execute(
                        select(ClassProgress).where(ClassProgress.student_id == drop.id)
                    )
                )
                .scalars()
                .all()
            )
            for row in class_rows:
                await _move_class_row(session, row, keep.id)
            personal_rows = (
                (
                    await session.execute(
                        select(Progress).where(Progress.student_id == drop.id)
                    )
                )
                .scalars()
                .all()
            )
            for row in personal_rows:
                if drop_plan.personal_to_team_id is not None:
                    await _move_personal_to_class(
                        session, row, keep.id, drop_plan.personal_to_team_id
                    )
                elif drop_plan.personal_to_keep:
                    await _move_personal_to_personal(session, row, keep.id)
                else:
                    await session.delete(row)
                    await session.flush()
            await session.execute(
                update(SessionRow)
                .where(
                    SessionRow.principal_type == "student",
                    SessionRow.principal_id == drop.id,
                    SessionRow.revoked_at.is_(None),
                )
                .values(revoked_at=now)
            )
            drop.email = None
            drop.status = "removed"
            await session.flush()


async def run(*, apply: bool) -> str:
    from .config import Settings

    cfg = Settings()
    if not cfg.database_url:
        raise SystemExit("需要 DATABASE_URL（postgresql+asyncpg://…），沒有連上就不做。")
    engine = create_engine(_async_url(cfg.database_url))
    maker = create_sessionmaker(engine)
    try:
        async with maker() as session:
            snaps, mems, levels = await _load(session)
            groups = build_groups(snaps, mems, levels)
            report = format_dry_run(groups)
            if apply and groups:
                await apply_groups(session, groups)
                await session.commit()
                report += "\n\n已寫入。請接著執行 uv run creafly-migrate 建立全站唯一索引。"
            else:
                await session.rollback()
            return report
    finally:
        await engine.dispose()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="合併重複 email 的學生帳號。預設 dry-run，不寫入。"
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="寫入合併。沒有這個旗標時只印報告。",
    )
    args = parser.parse_args(argv)
    report = asyncio.run(run(apply=args.apply))
    print(report)
    return 0


if __name__ == "__main__":
    sys.exit(main())
