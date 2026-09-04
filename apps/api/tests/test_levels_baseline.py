"""關卡系統 baseline 測試 — 重構前鎖定現有行為（靜態 JSON、/api/levels、廣播、entitlement）。

不依賴 DATABASE_URL 的測試在此檔；DB 相關見 test_levels_catalog.py。
"""

from pathlib import Path

from fastapi.testclient import TestClient

from app.rest import known_level_ids, load_levels
from tests.conftest import teacher_connect

LEVELS_DIR = Path(__file__).resolve().parents[2] / "simulator" / "public" / "levels"

OFFICIAL_IDS = frozenset(
    {
        "1-0",
        "1-1",
        "1-2",
        "1-3",
        "1-4",
        "1-5",
        "1-6",
        "2-1",
        "2-2",
        "2-3",
        "2-4",
        "2-5",
        "3-1",
        "3-2",
        "3-3",
        "3-4",
    }
)


def test_load_levels_官方十六關完整() -> None:
    levels = load_levels(LEVELS_DIR)
    ids = known_level_ids(levels)
    assert ids == OFFICIAL_IDS
    assert len(levels.chapters) == 3
    ch1 = next(c for c in levels.chapters if c.chapter == 1)
    assert ch1.name == "新手村"
    assert ch1.levels[0].id == "1-0"
    assert ch1.levels[0].name == "搖桿熱身"


def test_load_levels_每章關卡數() -> None:
    levels = load_levels(LEVELS_DIR)
    counts = {c.chapter: len(c.levels) for c in levels.chapters}
    assert counts == {1: 7, 2: 5, 3: 4}


def test_api_levels_與靜態檔一致(client: TestClient) -> None:
    r = client.get("/api/levels")
    assert r.status_code == 200
    ids = {lvl["id"] for ch in r.json()["chapters"] for lvl in ch["levels"]}
    assert ids == OFFICIAL_IDS


def test_teacher_broadcast_load_level_轉發學生(client: TestClient, teacher_ticket: str) -> None:
    with teacher_connect(client, teacher_ticket) as t:
        t.receive_json()  # student_list
        with client.websocket_connect("/") as s:
            s.receive_json()  # welcome
            t.receive_json()  # 連上名冊
            t.send_json({"type": "broadcast", "payload": {"type": "load_level", "levelId": "2-3"}})
            assert s.receive_json() == {"type": "load_level", "levelId": "2-3"}


def test_chapter_json_含完整definition欄位() -> None:
    """學生端 fetch 靜態 JSON 時，每關至少要有 id / name（LevelDef 最小集）。"""
    import json

    for path in sorted(LEVELS_DIR.glob("chapter*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        assert isinstance(data.get("chapter"), int)
        assert isinstance(data.get("levels"), list)
        for lvl in data["levels"]:
            assert isinstance(lvl.get("id"), str) and lvl["id"]
            assert isinstance(lvl.get("name"), str) and lvl["name"]
