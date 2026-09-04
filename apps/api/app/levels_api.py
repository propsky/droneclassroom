"""levels_api.py — 關卡目錄 REST：curriculum、definition、老師作品庫、班級目錄。"""

import logging
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .accounts import CurrentTeacher, DbSession, bearer_token, resolve_student_session
from .config import Settings
from .db.models import Level, Teacher, TeacherLevelKit, Team, TeamLevelEntry
from .levels_catalog import (
    build_team_curriculum,
    create_custom_level_draft,
    get_level_definition,
    list_team_catalog_entries,
)

logger = logging.getLogger("creafly.api.levels_api")

router = APIRouter()


# ---------- 回應模型（對齊 packages/shared/src/rest.ts）----------


class CurriculumLevelBrief(BaseModel):
    levelId: str  # noqa: N815
    title: str
    kind: Literal["system", "teacher"]
    visibleInMenu: bool = True  # noqa: N815
    teacherBroadcastable: bool = True  # noqa: N815


class CurriculumGroup(BaseModel):
    label: str
    sort: int
    levels: list[CurriculumLevelBrief]


class CurriculumResponse(BaseModel):
    groups: list[CurriculumGroup]


class LevelDefinitionResponse(BaseModel):
    definition: dict[str, Any]


class TeacherLevelBrief(BaseModel):
    id: int
    levelId: str  # noqa: N815
    title: str
    status: Literal["draft", "published", "archived"]
    updatedAt: int  # noqa: N815 — epoch ms


class TeacherLevelsResponse(BaseModel):
    levels: list[TeacherLevelBrief]


class TeacherLevelDetail(TeacherLevelBrief):
    """GET /api/teacher/levels/{id} — 含完整 definition（草稿可編輯）。"""

    definition: dict[str, Any]


class CreateCustomLevelRequest(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    templateLevelId: str | None = None  # noqa: N815


class PatchCustomLevelRequest(BaseModel):
    title: str | None = Field(default=None, max_length=200)
    definition: dict[str, Any] | None = None


KIT_CATEGORIES = frozenset({"rings", "obstacles", "tasks", "scenes", "draw", "races"})
KIT_BOUNDS = 14.5


class TeacherLevelKitBrief(BaseModel):
    id: int
    name: str
    desc: str
    category: Literal["rings", "obstacles", "tasks", "scenes", "draw", "races"]
    updatedAt: int  # noqa: N815
    scope: Literal["mine", "org"] = "mine"
    ownerName: str | None = None  # noqa: N815 — scope=org 時顯示
    sharedWithOrg: bool = False  # noqa: N815 — scope=mine 時可切換


class TeacherLevelKitsResponse(BaseModel):
    mine: list[TeacherLevelKitBrief]
    org: list[TeacherLevelKitBrief]


class TeacherLevelKitDetail(TeacherLevelKitBrief):
    patch: dict[str, Any]


class CreateTeacherLevelKitRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    desc: str = Field(default="", max_length=400)
    category: Literal["rings", "obstacles", "tasks", "scenes", "draw", "races"]
    patch: dict[str, Any]
    sharedWithOrg: bool = False  # noqa: N815


class PatchTeacherLevelKitRequest(BaseModel):
    name: str | None = Field(default=None, max_length=120)
    desc: str | None = Field(default=None, max_length=400)
    category: Literal["rings", "obstacles", "tasks", "scenes", "draw", "races"] | None = None
    patch: dict[str, Any] | None = None
    sharedWithOrg: bool | None = None  # noqa: N815


def _in_bounds(x: float, z: float) -> bool:
    return -KIT_BOUNDS <= x <= KIT_BOUNDS and -KIT_BOUNDS <= z <= KIT_BOUNDS


def _validate_kit_patch(patch: dict[str, Any]) -> list[str]:
    """驗證素材 patch；回傳錯誤訊息（空 = 通過）。"""
    errs: list[str] = []

    def check_xyz(item: dict[str, Any], label: str) -> None:
        for key in ("x", "y", "z"):
            if not isinstance(item.get(key), (int, float)):
                errs.append(f"{label} 座標不完整")
                return
        if not _in_bounds(float(item["x"]), float(item["z"])):
            errs.append(f"{label} 超出場地範圍")

    for i, r in enumerate(patch.get("rings") or []):
        if isinstance(r, dict):
            check_xyz(r, f"圈 #{i + 1}")
    for i, o in enumerate(patch.get("obstacles") or []):
        if isinstance(o, dict):
            check_xyz(o, f"障礙 #{i + 1}")
    for i, b in enumerate(patch.get("balloons") or []):
        if isinstance(b, dict):
            check_xyz(b, f"氣球 #{i + 1}")
    for i, z in enumerate(patch.get("passZones") or []):
        if isinstance(z, dict):
            if not isinstance(z.get("x"), (int, float)) or not isinstance(z.get("z"), (int, float)):
                errs.append(f"任務點 #{i + 1} 座標不完整")
            elif not _in_bounds(float(z["x"]), float(z["z"])):
                errs.append(f"任務點 #{i + 1} 超出場地範圍")

    has_content = any(
        [
            bool(patch.get("rings")),
            bool(patch.get("obstacles")),
            bool(patch.get("balloons")),
            bool(patch.get("passZones")),
            patch.get("draw") is True,
            bool(patch.get("guide")),
        ]
    )
    if not has_content:
        errs.append("素材需至少包含圈、障礙、氣球、任務或畫畫內容")
    if patch.get("draw") is True and not patch.get("view"):
        errs.append("畫畫模式需指定 view（topdown 或 orbit3d）")

    return errs


async def _kit_readable(
    session: AsyncSession, kit: TeacherLevelKit, teacher: CurrentTeacher
) -> bool:
    if kit.teacher_id == teacher.id:
        return True
    if not kit.shared_with_org:
        return False
    owner = await session.get(Teacher, kit.teacher_id)
    return owner is not None and owner.org_id == teacher.org_id


class CatalogAssignRequest(BaseModel):
    levelId: str = Field(min_length=1)  # noqa: N815
    groupLabel: str = Field(min_length=1, max_length=200)  # noqa: N815
    visibleInMenu: bool = True  # noqa: N815
    teacherBroadcastable: bool = True  # noqa: N815


class CatalogPatchRequest(BaseModel):
    groupLabel: str | None = Field(default=None, max_length=200)  # noqa: N815
    sortOrder: int | None = None  # noqa: N815
    visibleInMenu: bool | None = None  # noqa: N815
    teacherBroadcastable: bool | None = None  # noqa: N815
    enabled: bool | None = None


class TeamCatalogEntry(BaseModel):
    levelId: str  # noqa: N815
    title: str
    kind: Literal["system", "teacher"]
    groupLabel: str  # noqa: N815
    sortOrder: int  # noqa: N815
    visibleInMenu: bool  # noqa: N815
    teacherBroadcastable: bool  # noqa: N815
    enabled: bool


class TeamCatalogListResponse(BaseModel):
    entries: list[TeamCatalogEntry]


def _epoch_ms(dt) -> int:
    return int(dt.timestamp() * 1000)


def _groups_to_response(groups) -> CurriculumResponse:
    return CurriculumResponse(
        groups=[
            CurriculumGroup(
                label=g.label,
                sort=g.sort,
                levels=[
                    CurriculumLevelBrief(
                        levelId=lvl.level_id,
                        title=lvl.title,
                        kind=lvl.kind,
                        visibleInMenu=lvl.visible_in_menu,
                        teacherBroadcastable=lvl.teacher_broadcastable,
                    )
                    for lvl in g.levels
                ],
            )
            for g in groups
        ]
    )


async def _own_team(session: AsyncSession, teacher_id: int, team_id: int) -> Team | None:
    team = await session.get(Team, team_id)
    if team is None or team.owner_teacher_id != teacher_id or team.archived_at is not None:
        return None
    return team


# ---------- 關卡定義 ----------


@router.get("/api/levels/{level_id}")
async def get_level_by_id(level_id: str, session: DbSession) -> LevelDefinitionResponse:
    """完整 LevelDef（官方 + 已發布自訂）。"""
    definition = await get_level_definition(session, level_id)
    if definition is None:
        raise HTTPException(status_code=404, detail="關卡不存在")
    return LevelDefinitionResponse(definition=definition)


# ---------- 學生 curriculum ----------


@router.get("/api/student/curriculum")
async def student_curriculum(request: Request, session: DbSession) -> CurriculumResponse:
    """學生 Bearer：本班可見關卡分組（visible_in_menu && enabled）。"""
    token = bearer_token(request)
    if not token:
        raise HTTPException(status_code=401, detail="需要學生登入")
    settings: Settings = request.app.state.settings
    account = await resolve_student_session(session, token, settings=settings)
    if account is None:
        raise HTTPException(status_code=401, detail="登入已失效")
    _, _student, team = account
    groups = await build_team_curriculum(session, team.id, for_student=True)
    await session.commit()
    return _groups_to_response(groups)


# ---------- 老師 curriculum ----------


@router.get("/api/teams/{team_id}/curriculum")
async def team_curriculum(
    team_id: int, teacher: CurrentTeacher, session: DbSession
) -> CurriculumResponse:
    """老師 Bearer：本班可廣播關卡分組（teacher_broadcastable && enabled）。"""
    team = await _own_team(session, teacher.id, team_id)
    if team is None:
        raise HTTPException(status_code=404, detail="班級不存在")
    groups = await build_team_curriculum(session, team_id, for_student=False)
    return _groups_to_response(groups)


# ---------- 老師作品庫 ----------


@router.get("/api/teacher/levels")
async def list_teacher_levels(teacher: CurrentTeacher, session: DbSession) -> TeacherLevelsResponse:
    rows = (
        await session.execute(
            select(Level)
            .where(
                Level.owner_teacher_id == teacher.id,
                Level.scope == "teacher",
                Level.status != "archived",
            )
            .order_by(Level.updated_at.desc())
        )
    ).scalars().all()
    return TeacherLevelsResponse(
        levels=[
            TeacherLevelBrief(
                id=r.id,
                levelId=r.level_id,
                title=r.title,
                status=r.status,
                updatedAt=_epoch_ms(r.updated_at),
            )
            for r in rows
        ]
    )


@router.get("/api/teacher/levels/{level_pk}")
async def get_teacher_level(
    level_pk: int, teacher: CurrentTeacher, session: DbSession
) -> TeacherLevelDetail:
    lvl = await session.get(Level, level_pk)
    if lvl is None or lvl.owner_teacher_id != teacher.id or lvl.scope != "teacher":
        raise HTTPException(status_code=404, detail="關卡不存在")
    return TeacherLevelDetail(
        id=lvl.id,
        levelId=lvl.level_id,
        title=lvl.title,
        status=lvl.status,
        updatedAt=_epoch_ms(lvl.updated_at),
        definition=lvl.definition,
    )


@router.post("/api/teacher/levels")
async def create_teacher_level(
    body: CreateCustomLevelRequest, teacher: CurrentTeacher, session: DbSession
) -> TeacherLevelBrief:
    template = None
    if body.templateLevelId:
        template = await get_level_definition(session, body.templateLevelId)
    lvl = await create_custom_level_draft(
        session,
        org_id=teacher.org_id,
        teacher_id=teacher.id,
        title=body.title,
        template=template,
    )
    await session.commit()
    await session.refresh(lvl)
    return TeacherLevelBrief(
        id=lvl.id,
        levelId=lvl.level_id,
        title=lvl.title,
        status=lvl.status,
        updatedAt=_epoch_ms(lvl.updated_at),
    )


@router.patch("/api/teacher/levels/{level_pk}")
async def patch_teacher_level(
    level_pk: int,
    body: PatchCustomLevelRequest,
    teacher: CurrentTeacher,
    session: DbSession,
) -> TeacherLevelBrief:
    lvl = await session.get(Level, level_pk)
    if lvl is None or lvl.owner_teacher_id != teacher.id or lvl.scope != "teacher":
        raise HTTPException(status_code=404, detail="關卡不存在")
    if body.title is not None:
        lvl.title = body.title
    if body.definition is not None:
        lvl.definition = {**body.definition, "id": lvl.level_id, "name": lvl.title}
    await session.commit()
    await session.refresh(lvl)
    return TeacherLevelBrief(
        id=lvl.id,
        levelId=lvl.level_id,
        title=lvl.title,
        status=lvl.status,
        updatedAt=_epoch_ms(lvl.updated_at),
    )


@router.post("/api/teacher/levels/{level_pk}/publish")
async def publish_teacher_level(
    level_pk: int, teacher: CurrentTeacher, session: DbSession
) -> TeacherLevelBrief:
    from datetime import UTC, datetime

    lvl = await session.get(Level, level_pk)
    if lvl is None or lvl.owner_teacher_id != teacher.id or lvl.scope != "teacher":
        raise HTTPException(status_code=404, detail="關卡不存在")
    lvl.status = "published"
    lvl.published_at = datetime.now(UTC)
    await session.commit()
    await session.refresh(lvl)
    return TeacherLevelBrief(
        id=lvl.id,
        levelId=lvl.level_id,
        title=lvl.title,
        status=lvl.status,
        updatedAt=_epoch_ms(lvl.updated_at),
    )


# ---------- 老師自訂素材庫 ----------


@router.get("/api/teacher/level-kits")
async def list_teacher_level_kits(
    teacher: CurrentTeacher, session: DbSession
) -> TeacherLevelKitsResponse:
    own_rows = (
        await session.execute(
            select(TeacherLevelKit)
            .where(TeacherLevelKit.teacher_id == teacher.id)
            .order_by(TeacherLevelKit.updated_at.desc())
        )
    ).scalars().all()
    org_rows = (
        await session.execute(
            select(TeacherLevelKit, Teacher.name)
            .join(Teacher, Teacher.id == TeacherLevelKit.teacher_id)
            .where(
                Teacher.org_id == teacher.org_id,
                TeacherLevelKit.shared_with_org.is_(True),
                TeacherLevelKit.teacher_id != teacher.id,
            )
            .order_by(TeacherLevelKit.updated_at.desc())
        )
    ).all()
    return TeacherLevelKitsResponse(
        mine=[
            TeacherLevelKitBrief(
                id=r.id,
                name=r.name,
                desc=r.desc,
                category=r.category,
                updatedAt=_epoch_ms(r.updated_at),
                scope="mine",
                sharedWithOrg=r.shared_with_org,
            )
            for r in own_rows
        ],
        org=[
            TeacherLevelKitBrief(
                id=row[0].id,
                name=row[0].name,
                desc=row[0].desc,
                category=row[0].category,
                updatedAt=_epoch_ms(row[0].updated_at),
                scope="org",
                ownerName=row[1],
            )
            for row in org_rows
        ],
    )


@router.get("/api/teacher/level-kits/{kit_id}")
async def get_teacher_level_kit(
    kit_id: int, teacher: CurrentTeacher, session: DbSession
) -> TeacherLevelKitDetail:
    row = await session.get(TeacherLevelKit, kit_id)
    if row is None or not await _kit_readable(session, row, teacher):
        raise HTTPException(status_code=404, detail="素材不存在")
    owner_name = None
    if row.teacher_id != teacher.id:
        owner = await session.get(Teacher, row.teacher_id)
        owner_name = owner.name if owner else None
    return TeacherLevelKitDetail(
        id=row.id,
        name=row.name,
        desc=row.desc,
        category=row.category,
        updatedAt=_epoch_ms(row.updated_at),
        scope="mine" if row.teacher_id == teacher.id else "org",
        ownerName=owner_name,
        sharedWithOrg=row.shared_with_org if row.teacher_id == teacher.id else False,
        patch=row.patch,
    )


@router.post("/api/teacher/level-kits")
async def create_teacher_level_kit(
    body: CreateTeacherLevelKitRequest, teacher: CurrentTeacher, session: DbSession
) -> TeacherLevelKitDetail:
    if body.category not in KIT_CATEGORIES:
        raise HTTPException(status_code=400, detail="無效分類")
    errs = _validate_kit_patch(body.patch)
    if errs:
        raise HTTPException(status_code=400, detail="；".join(errs))
    row = TeacherLevelKit(
        teacher_id=teacher.id,
        name=body.name.strip(),
        desc=body.desc.strip(),
        category=body.category,
        patch=body.patch,
        shared_with_org=body.sharedWithOrg,
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return TeacherLevelKitDetail(
        id=row.id,
        name=row.name,
        desc=row.desc,
        category=row.category,
        updatedAt=_epoch_ms(row.updated_at),
        scope="mine",
        sharedWithOrg=row.shared_with_org,
        patch=row.patch,
    )


@router.patch("/api/teacher/level-kits/{kit_id}")
async def patch_teacher_level_kit(
    kit_id: int,
    body: PatchTeacherLevelKitRequest,
    teacher: CurrentTeacher,
    session: DbSession,
) -> TeacherLevelKitDetail:
    row = await session.get(TeacherLevelKit, kit_id)
    if row is None or row.teacher_id != teacher.id:
        raise HTTPException(status_code=404, detail="素材不存在")
    if body.name is not None:
        row.name = body.name.strip()
    if body.desc is not None:
        row.desc = body.desc.strip()
    if body.category is not None:
        if body.category not in KIT_CATEGORIES:
            raise HTTPException(status_code=400, detail="無效分類")
        row.category = body.category
    if body.patch is not None:
        errs = _validate_kit_patch(body.patch)
        if errs:
            raise HTTPException(status_code=400, detail="；".join(errs))
        row.patch = body.patch
    if body.sharedWithOrg is not None:
        row.shared_with_org = body.sharedWithOrg
    await session.commit()
    await session.refresh(row)
    return TeacherLevelKitDetail(
        id=row.id,
        name=row.name,
        desc=row.desc,
        category=row.category,
        updatedAt=_epoch_ms(row.updated_at),
        scope="mine",
        sharedWithOrg=row.shared_with_org,
        patch=row.patch,
    )


@router.delete("/api/teacher/level-kits/{kit_id}")
async def delete_teacher_level_kit(
    kit_id: int, teacher: CurrentTeacher, session: DbSession
) -> dict[str, Literal[True]]:
    row = await session.get(TeacherLevelKit, kit_id)
    if row is None or row.teacher_id != teacher.id:
        raise HTTPException(status_code=404, detail="素材不存在")
    await session.delete(row)
    await session.commit()
    return {"ok": True}


# ---------- 班級目錄 ----------


@router.get("/api/teams/{team_id}/catalog")
async def list_team_catalog(
    team_id: int, teacher: CurrentTeacher, session: DbSession
) -> TeamCatalogListResponse:
    """老師 Bearer：班級目錄全列（管理 UI；含未啟用項）。"""
    team = await _own_team(session, teacher.id, team_id)
    if team is None:
        raise HTTPException(status_code=404, detail="班級不存在")
    rows = await list_team_catalog_entries(session, team_id)
    return TeamCatalogListResponse(
        entries=[
            TeamCatalogEntry(
                levelId=r.level_id,
                title=r.title,
                kind=r.kind,
                groupLabel=r.group_label,
                sortOrder=r.sort_order,
                visibleInMenu=r.visible_in_menu,
                teacherBroadcastable=r.teacher_broadcastable,
                enabled=r.enabled,
            )
            for r in rows
        ]
    )


@router.post("/api/teams/{team_id}/catalog")
async def assign_to_catalog(
    team_id: int,
    body: CatalogAssignRequest,
    teacher: CurrentTeacher,
    session: DbSession,
) -> dict[str, Literal[True]]:
    team = await _own_team(session, teacher.id, team_id)
    if team is None:
        raise HTTPException(status_code=404, detail="班級不存在")
    lvl = (
        await session.execute(
            select(Level).where(Level.level_id == body.levelId, Level.status == "published")
        )
    ).scalar_one_or_none()
    if lvl is None:
        raise HTTPException(status_code=404, detail="關卡不存在或未發布")
    existing = (
        await session.execute(
            select(TeamLevelEntry).where(
                TeamLevelEntry.team_id == team_id,
                TeamLevelEntry.level_id == body.levelId,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(status_code=409, detail="已在班級目錄中")
    max_sort = (
        await session.execute(
            select(TeamLevelEntry.sort_order)
            .where(TeamLevelEntry.team_id == team_id)
            .order_by(TeamLevelEntry.sort_order.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    session.add(
        TeamLevelEntry(
            team_id=team_id,
            level_id=body.levelId,
            group_label=body.groupLabel,
            sort_order=(max_sort or 0) + 1,
            visible_in_menu=body.visibleInMenu,
            teacher_broadcastable=body.teacherBroadcastable,
            enabled=True,
            assigned_by=teacher.id,
        )
    )
    await session.commit()
    return {"ok": True}


@router.patch("/api/teams/{team_id}/catalog/{level_id}")
async def patch_catalog_entry(
    team_id: int,
    level_id: str,
    body: CatalogPatchRequest,
    teacher: CurrentTeacher,
    session: DbSession,
) -> dict[str, Literal[True]]:
    team = await _own_team(session, teacher.id, team_id)
    if team is None:
        raise HTTPException(status_code=404, detail="班級不存在")
    entry = (
        await session.execute(
            select(TeamLevelEntry).where(
                TeamLevelEntry.team_id == team_id,
                TeamLevelEntry.level_id == level_id,
            )
        )
    ).scalar_one_or_none()
    if entry is None:
        raise HTTPException(status_code=404, detail="目錄項不存在")
    if body.groupLabel is not None:
        entry.group_label = body.groupLabel
    if body.sortOrder is not None:
        entry.sort_order = body.sortOrder
    if body.visibleInMenu is not None:
        entry.visible_in_menu = body.visibleInMenu
    if body.teacherBroadcastable is not None:
        entry.teacher_broadcastable = body.teacherBroadcastable
    if body.enabled is not None:
        entry.enabled = body.enabled
    await session.commit()
    return {"ok": True}
