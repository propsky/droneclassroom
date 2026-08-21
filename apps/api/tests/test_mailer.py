"""寄信模組測試 — 停用模式與 SES 參數（mock，不真寄）。"""

from unittest.mock import MagicMock

from app.config import Settings
from app.mailer import Mailer


async def test_停用模式_未設MAIL_FROM_回False不炸() -> None:
    m = Mailer(Settings(teacher_password="x"))
    assert m.enabled is False
    assert await m.send(to="a@b.c", subject="s", html="<p>h</p>", text="t") is False


async def test_啟用模式_以正確參數呼叫SES(monkeypatch) -> None:
    m = Mailer(Settings(teacher_password="x", mail_from="CREAFLY <noreply@propskynet.com>"))
    assert m.enabled is True
    fake = MagicMock()
    m._client = fake  # noqa: SLF001 — 測試注入假 client
    assert await m.send(to="kid@school.tw", subject="邀請", html="<b>hi</b>", text="hi") is True
    kwargs = fake.send_email.call_args.kwargs
    assert kwargs["FromEmailAddress"] == "CREAFLY <noreply@propskynet.com>"
    assert kwargs["Destination"] == {"ToAddresses": ["kid@school.tw"]}
    assert kwargs["Content"]["Simple"]["Subject"]["Data"] == "邀請"


async def test_SES丟例外_回False不炸(monkeypatch) -> None:
    m = Mailer(Settings(teacher_password="x", mail_from="noreply@propskynet.com"))
    fake = MagicMock()
    fake.send_email.side_effect = RuntimeError("boom")
    m._client = fake  # noqa: SLF001
    assert await m.send(to="a@b.c", subject="s", html="h", text="t") is False
