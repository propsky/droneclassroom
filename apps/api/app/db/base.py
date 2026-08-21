"""base.py — Declarative base 與約束命名慣例。

命名慣例讓 PK / FK / UNIQUE / CHECK / INDEX 的名稱由欄位推導、跨環境穩定，
Alembic autogenerate 才能正確比對與 drop（未命名約束在 PostgreSQL 會拿到隨機後綴）。
表達式索引（LOWER(email)）與部分索引仍需在 models.py 明確命名。
"""

from sqlalchemy import MetaData
from sqlalchemy.orm import DeclarativeBase

NAMING_CONVENTION = {
    "ix": "ix_%(table_name)s_%(column_0_N_name)s",
    "uq": "uq_%(table_name)s_%(column_0_N_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    """所有 model 的共同基底；Alembic 的 target_metadata 取 Base.metadata。"""

    metadata = MetaData(naming_convention=NAMING_CONVENTION)
