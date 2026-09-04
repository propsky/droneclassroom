"""老師自訂關卡素材 API（需 DATABASE_URL）。"""

from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from tests.test_accounts import (
    _bearer,
    _email,
    _make_client,
    _register,
    needs_db,
)

RING_PATCH = {
    "rings": [{"x": 0, "y": 2.5, "z": -4, "label": "1"}],
    "returnHome": True,
}


@pytest.fixture
def db_client(tmp_path: Path) -> Iterator[TestClient]:
    with _make_client(tmp_path) as c:
        yield c


@needs_db
def test_建立素材_列出_刪除(db_client: TestClient) -> None:
    token = _register(db_client, _email("kitA"))["ticket"]
    headers = _bearer(token)
    r = db_client.post(
        "/api/teacher/level-kits",
        headers=headers,
        json={
            "name": "我的三圈",
            "desc": "測試用",
            "category": "rings",
            "patch": RING_PATCH,
        },
    )
    assert r.status_code == 200, r.text
    kit_id = r.json()["id"]
    assert r.json()["sharedWithOrg"] is False

    lst = db_client.get("/api/teacher/level-kits", headers=headers).json()
    assert any(k["id"] == kit_id for k in lst["mine"])
    assert lst["org"] == []

    r = db_client.get(f"/api/teacher/level-kits/{kit_id}", headers=headers)
    assert r.status_code == 200
    assert r.json()["patch"]["rings"][0]["label"] == "1"

    r = db_client.delete(f"/api/teacher/level-kits/{kit_id}", headers=headers)
    assert r.status_code == 200
    mine = db_client.get("/api/teacher/level-kits", headers=headers).json()["mine"]
    assert not any(k["id"] == kit_id for k in mine)


@needs_db
def test_同校分享_另一位老師可讀不可刪(db_client: TestClient) -> None:
    token_a = _register(db_client, _email("kitShareA"))["ticket"]
    token_b = _register(db_client, _email("kitShareB"))["ticket"]
    headers_a = _bearer(token_a)
    headers_b = _bearer(token_b)

    r = db_client.post(
        "/api/teacher/level-kits",
        headers=headers_a,
        json={
            "name": "分享片段",
            "category": "rings",
            "patch": RING_PATCH,
            "sharedWithOrg": True,
        },
    )
    assert r.status_code == 200, r.text
    kit_id = r.json()["id"]

    lst_b = db_client.get("/api/teacher/level-kits", headers=headers_b).json()
    assert any(k["id"] == kit_id and k["scope"] == "org" for k in lst_b["org"])

    r = db_client.get(f"/api/teacher/level-kits/{kit_id}", headers=headers_b)
    assert r.status_code == 200
    assert r.json()["scope"] == "org"

    r = db_client.delete(f"/api/teacher/level-kits/{kit_id}", headers=headers_b)
    assert r.status_code == 404

    r = db_client.patch(
        f"/api/teacher/level-kits/{kit_id}",
        headers=headers_a,
        json={"sharedWithOrg": False},
    )
    assert r.status_code == 200
    assert db_client.get("/api/teacher/level-kits", headers=headers_b).json()["org"] == []

    db_client.delete(f"/api/teacher/level-kits/{kit_id}", headers=headers_a)


@needs_db
def test_空patch拒絕建立(db_client: TestClient) -> None:
    token = _register(db_client, _email("kitBad"))["ticket"]
    r = db_client.post(
        "/api/teacher/level-kits",
        headers=_bearer(token),
        json={"name": "空的", "category": "rings", "patch": {}},
    )
    assert r.status_code == 400
    assert "素材需至少包含" in r.json()["detail"]


@needs_db
def test_自訂關卡草稿建立與發布(db_client: TestClient) -> None:
    token = _register(db_client, _email("lvlDraft"))["ticket"]
    headers = _bearer(token)
    r = db_client.post("/api/teacher/levels", headers=headers, json={"title": "期中考 A"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["levelId"].startswith("cl-")
    assert body["status"] == "draft"

    pk = body["id"]
    r = db_client.get(f"/api/teacher/levels/{pk}", headers=headers)
    assert r.status_code == 200
    assert r.json()["definition"]["name"] == "期中考 A"

    r = db_client.patch(
        f"/api/teacher/levels/{pk}",
        headers=headers,
        json={"definition": {**r.json()["definition"], "rings": RING_PATCH["rings"]}},
    )
    assert r.status_code == 200

    r = db_client.post(f"/api/teacher/levels/{pk}/publish", headers=headers)
    assert r.status_code == 200
    assert r.json()["status"] == "published"


@needs_db
def test_自訂關卡加入班級目錄(db_client: TestClient) -> None:
    token = _register(db_client, _email("lvlCat"))["ticket"]
    headers = _bearer(token)
    with db_client.websocket_connect(f"/teacher?ticket={token}") as ws:
        from tests.test_rooms import Teacher as TeacherWS

        t = TeacherWS(ws)
        code = t.create_room({"name": "目錄班", "maxStudents": 10})
        rooms = {r["code"]: r for r in t.room_list()["rooms"]}
        team_id = rooms[code]["teamId"]

    r = db_client.post("/api/teacher/levels", headers=headers, json={"title": "目錄測試"})
    assert r.status_code == 200
    pk = r.json()["id"]
    level_id = r.json()["levelId"]
    db_client.post(f"/api/teacher/levels/{pk}/publish", headers=headers)

    r = db_client.post(
        f"/api/teams/{team_id}/catalog",
        headers=headers,
        json={
            "levelId": level_id,
            "groupLabel": "本班 · 測試",
            "visibleInMenu": True,
            "teacherBroadcastable": True,
        },
    )
    assert r.status_code == 200, r.text

    r = db_client.get(f"/api/teams/{team_id}/catalog", headers=headers)
    assert r.status_code == 200
    assert any(e["levelId"] == level_id for e in r.json()["entries"])
