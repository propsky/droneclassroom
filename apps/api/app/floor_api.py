"""老師上傳關卡場地地板，學生端用公開 GET 當貼圖。

先確認老師身分，再讀 multipart（單檔、最大 2 MB）。
位元組存在 level_floors，關卡 definition.floorImage 只存本機相對路徑。
"""

from __future__ import annotations

import time

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import select
from starlette.datastructures import UploadFile

from .accounts import CurrentTeacher, DbSession
from .db.models import Level, LevelFloor
from .floor_image import (
    MAX_FLOOR_BYTES,
    floor_image_path,
    sanitize_floor_image,
    sniff_floor_image,
)

router = APIRouter()


class FloorUploadResponse(BaseModel):
    floorImage: str  # noqa: N815


async def _owned_teacher_level(session, level_pk: int, teacher) -> Level:
    lvl = await session.get(Level, level_pk)
    if lvl is None or lvl.owner_teacher_id != teacher.id or lvl.scope != "teacher":
        raise HTTPException(status_code=404, detail="關卡不存在")
    return lvl


async def _read_upload(upload: UploadFile) -> bytes:
    chunks: list[bytes] = []
    size = 0
    while True:
        chunk = await upload.read(64 * 1024)
        if not chunk:
            break
        size += len(chunk)
        if size > MAX_FLOOR_BYTES:
            raise HTTPException(status_code=413, detail="圖片需小於 2 MB")
        chunks.append(chunk)
    return b"".join(chunks)


def _apply_floor_url(lvl: Level, path: str | None) -> None:
    definition = dict(lvl.definition)
    if path:
        definition["floorImage"] = path
    else:
        definition.pop("floorImage", None)
    sanitize_floor_image(definition, lvl.level_id)
    definition["id"] = lvl.level_id
    definition["name"] = lvl.title
    lvl.definition = definition


@router.post("/api/teacher/levels/{level_pk}/floor", response_model=FloorUploadResponse)
async def upload_level_floor(
    level_pk: int,
    request: Request,
    teacher: CurrentTeacher,
    session: DbSession,
) -> FloorUploadResponse:
    lvl = await _owned_teacher_level(session, level_pk, teacher)
    form = await request.form(max_files=1, max_fields=2, max_part_size=MAX_FLOOR_BYTES)
    upload = form.get("file")
    if not isinstance(upload, UploadFile):
        raise HTTPException(status_code=400, detail="請上傳圖片檔")
    data = await _read_upload(upload)
    try:
        content_type = sniff_floor_image(data, upload.content_type)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail="只接受 JPEG、PNG 或 WebP，且需小於 2 MB",
        ) from None
    row = await session.get(LevelFloor, lvl.id)
    if row is None:
        row = LevelFloor(
            level_pk=lvl.id,
            content_type=content_type,
            byte_size=len(data),
            data=data,
        )
        session.add(row)
    else:
        row.content_type = content_type
        row.byte_size = len(data)
        row.data = data
    path = floor_image_path(lvl.level_id, int(time.time()))
    _apply_floor_url(lvl, path)
    await session.commit()
    return FloorUploadResponse(floorImage=path)


@router.delete("/api/teacher/levels/{level_pk}/floor", status_code=204)
async def delete_level_floor(
    level_pk: int,
    teacher: CurrentTeacher,
    session: DbSession,
) -> None:
    lvl = await _owned_teacher_level(session, level_pk, teacher)
    row = await session.get(LevelFloor, lvl.id)
    if row is not None:
        await session.delete(row)
    _apply_floor_url(lvl, None)
    await session.commit()


@router.get("/api/levels/{level_id}/floor")
async def get_level_floor(level_id: str, session: DbSession) -> Response:
    lvl = (
        await session.execute(select(Level).where(Level.level_id == level_id))
    ).scalar_one_or_none()
    if lvl is None:
        raise HTTPException(status_code=404, detail="關卡不存在")
    row = await session.get(LevelFloor, lvl.id)
    if row is None:
        raise HTTPException(status_code=404, detail="這關沒有場地圖")
    return Response(content=bytes(row.data), media_type=row.content_type)
