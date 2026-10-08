"""帳號授權期限。NULL = 不限期（與改版前相同）。"""

from datetime import UTC, datetime


def license_expired(until: datetime | None, now: datetime | None = None) -> bool:
    if until is None:
        return False
    now = now or datetime.now(UTC)
    if until.tzinfo is None:
        until = until.replace(tzinfo=UTC)
    return until <= now
