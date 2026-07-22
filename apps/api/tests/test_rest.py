"""REST 端點測試 — /api/levels、/api/info、老師後台靜態頁切換。"""

from pathlib import Path

from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.rest import API_VERSION, known_level_ids, load_levels

# ---------- /api/levels ----------


def test_levels_三章關卡清單(client: TestClient) -> None:
    r = client.get("/api/levels")
    assert r.status_code == 200
    chapters = r.json()["chapters"]
    assert [c["chapter"] for c in chapters] == [1, 2, 3]
    assert chapters[0]["name"] == "新手村"
    # 只帶 id / name，不含 rings / passZones 等場景資料
    assert chapters[0]["levels"][0] == {"id": "1-0", "name": "搖桿熱身"}
    assert {lvl["id"] for lvl in chapters[2]["levels"]} == {"3-1", "3-2", "3-3", "3-4"}


def test_load_levels_目錄不存在_回空清單不crash(tmp_path: Path) -> None:
    levels = load_levels(tmp_path / "nope")
    assert levels.chapters == []
    assert known_level_ids(levels) == frozenset()


def test_load_levels_壞檔略過(tmp_path: Path) -> None:
    (tmp_path / "chapter1.json").write_text("not json", encoding="utf-8")
    (tmp_path / "chapter2.json").write_text(
        '{"chapter": 2, "name": "測試章", "levels": [{"id": "2-1", "name": "關卡"}]}',
        encoding="utf-8",
    )
    levels = load_levels(tmp_path)
    assert [c.chapter for c in levels.chapters] == [2]
    assert known_level_ids(levels) == frozenset({"2-1"})


# ---------- /api/info ----------


def test_info_欄位齊全(client: TestClient) -> None:
    r = client.get("/api/info")
    assert r.status_code == 200
    body = r.json()
    assert body["port"] == 3000
    assert body["maxStudents"] == 12  # 預設 MAX_STUDENTS
    assert body["version"] == API_VERSION
    assert isinstance(body["lanAddresses"], list)
    for addr in body["lanAddresses"]:  # 只列私有網段 IPv4
        assert addr.count(".") == 3


# ---------- 老師後台靜態頁切換 ----------


def test_teacher_dist存在_服務dist的index與assets(tmp_path: Path) -> None:
    """TEACHER_DIST 目錄存在 → /teacher 服務其 index.html、assets 掛 /teacher-assets。"""
    static_dir = tmp_path / "dist"
    static_dir.mkdir()
    teacher_dist = tmp_path / "teacher-dist"
    (teacher_dist / "assets").mkdir(parents=True)
    (teacher_dist / "index.html").write_text("<html>new teacher</html>", encoding="utf-8")
    (teacher_dist / "assets" / "app.js").write_text("console.log('hi')", encoding="utf-8")

    settings = Settings(
        port=3000, static_dir=static_dir, teacher_dist=teacher_dist, teacher_password="pw"
    )
    with TestClient(create_app(settings)) as c:
        r = c.get("/teacher")
        assert r.status_code == 200
        assert "new teacher" in r.text
        r = c.get("/teacher-assets/assets/app.js")
        assert r.status_code == 200
        assert "console.log" in r.text


def test_teacher_dist不存在_fallback_legacy頁(client: TestClient) -> None:
    """過渡期：沒有 build 產物就回 static/teacher.html。"""
    r = client.get("/teacher")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/html")
    r = client.get("/teacher-assets/whatever.js")
    assert r.status_code == 404
