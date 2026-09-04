"""levels_catalog 單元測試（不需 DATABASE_URL）。"""

import json
from pathlib import Path

from app.levels_catalog import load_chapters_from_dir


def test_load_chapters_from_dir_讀取章節(tmp_path: Path) -> None:
    (tmp_path / "chapter1.json").write_text(
        json.dumps(
            {
                "chapter": 1,
                "name": "測試章",
                "levels": [{"id": "1-0", "name": "關 A"}, {"id": "1-1", "name": "關 B"}],
            }
        ),
        encoding="utf-8",
    )
    (tmp_path / "chapter2.json").write_text(
        json.dumps({"chapter": 2, "name": "第二章", "levels": [{"id": "2-1", "name": "關 C"}]}),
        encoding="utf-8",
    )
    chapters = load_chapters_from_dir(tmp_path)
    assert [c["chapter"] for c in chapters] == [1, 2]
    assert len(chapters[0]["levels"]) == 2


def test_load_chapters_from_dir_壞檔略過(tmp_path: Path) -> None:
    (tmp_path / "chapter9.json").write_text("not json", encoding="utf-8")
    assert load_chapters_from_dir(tmp_path) == []
