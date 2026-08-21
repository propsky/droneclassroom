"""mailer.py — AWS SES 寄信（邀請信等交易郵件）。

設計：
- 憑證零管理：正式機用 EC2 instance role（allow-ses-send，僅限 propskynet.com 身分）、
  本機開發用開發者自己的 AWS CLI 憑證 —— 程式裡沒有任何金鑰。
- MAIL_FROM 未設定 = 停用模式：內容記 log（除錯用）、回傳 False，不擋任何流程 ——
  邀請信寄不出去時老師仍可用「班級碼 + 學生碼」路徑（寄信永遠只是加分項）。
- boto3 是同步 SDK：量小（邀請信），以 asyncio.to_thread 包住即可，不為此引入 aioboto3。
"""

import asyncio
import logging

from .config import Settings

logger = logging.getLogger("creafly.api.mailer")


class Mailer:
    """SES 寄信器；用法：`await app.state.mailer.send(...)`。"""

    def __init__(self, settings: Settings) -> None:
        self._from = settings.mail_from
        self._region = settings.ses_region
        self._client = None  # lazy：停用模式連 boto3 都不載

    @property
    def enabled(self) -> bool:
        return bool(self._from)

    def _get_client(self):  # noqa: ANN202 — boto3 無型別
        if self._client is None:
            import boto3  # noqa: PLC0415 — lazy import，停用模式不付启動成本

            self._client = boto3.client("sesv2", region_name=self._region)
        return self._client

    async def send(self, *, to: str, subject: str, html: str, text: str) -> bool:
        """寄一封信；成功 True、失敗/停用 False（呼叫端不需 try）。內容不進 log。"""
        if not self.enabled:
            logger.info("[MAIL] 停用模式（未設 MAIL_FROM），略過寄信 → %s（%s）", to, subject)
            return False
        try:
            await asyncio.to_thread(self._send_sync, to, subject, html, text)
            logger.info("[MAIL] 已寄出 → %s（%s）", to, subject)
            return True
        except Exception:  # noqa: BLE001 — 寄信失敗不能炸到業務流程
            logger.warning("[MAIL] 寄信失敗 → %s（%s）", to, subject, exc_info=True)
            return False

    def _send_sync(self, to: str, subject: str, html: str, text: str) -> None:
        self._get_client().send_email(
            FromEmailAddress=self._from,
            Destination={"ToAddresses": [to]},
            Content={
                "Simple": {
                    "Subject": {"Data": subject, "Charset": "UTF-8"},
                    "Body": {
                        "Html": {"Data": html, "Charset": "UTF-8"},
                        "Text": {"Data": text, "Charset": "UTF-8"},
                    },
                }
            },
        )
