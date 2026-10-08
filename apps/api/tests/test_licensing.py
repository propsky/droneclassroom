"""授權期限：空白不限期，到期才擋。"""

from datetime import UTC, datetime, timedelta

from app.licensing import license_expired


def test_blank_license_never_expires() -> None:
    assert license_expired(None) is False


def test_future_license_is_valid() -> None:
    assert license_expired(datetime.now(UTC) + timedelta(days=1)) is False


def test_past_license_expires() -> None:
    assert license_expired(datetime.now(UTC) - timedelta(seconds=1)) is True
