"""cli.py — `uv run creafly-migrate [alembic 參數]`：Alembic 薄殼。

不帶參數 = `upgrade head`；帶參數原樣轉給 alembic（例：`creafly-migrate downgrade -1`、
`creafly-migrate revision --autogenerate -m "..."`）。alembic.ini 以本檔位置定位，
所以在任何工作目錄（含 Docker 的 /app）都能跑，不必先 cd 到 apps/api。
"""

import sys
from pathlib import Path

from alembic.config import main as alembic_main

# app/db/cli.py → parents[2] = apps/api（alembic.ini 所在）
_INI = Path(__file__).resolve().parents[2] / "alembic.ini"


def main() -> None:
    args = sys.argv[1:] or ["upgrade", "head"]
    alembic_main(argv=["-c", str(_INI), *args])
