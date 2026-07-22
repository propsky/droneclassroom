"""auth.py — 教師後台認證與 Origin 白名單。

設計取捨（教室場景）：
- ticket secret 每次啟動隨機產生 → 重啟後所有 ticket 立即失效，老師重新登入即可
  （教室現場一堂課一次啟動，不需要跨重啟的 session）
- 不引入 PyJWT 等套件：payload 只有到期時間，stdlib hmac + sha256 已足夠
- Origin 白名單「預設放行私有網段」是刻意的：學生用 LAN IP（如 192.168.x.x:3000）
  連進來、老師可能用 localhost 開後台；教室區網沒有公網攻擊面，
  公開部署時再用 ALLOWED_ORIGINS 收斂
"""

import base64
import hashlib
import hmac
import ipaddress
import secrets
import time
from urllib.parse import urlsplit

# WS 升級被拒的 close codes（對齊 packages/shared/src/rest.ts）
WS_CLOSE_UNAUTHORIZED = 4401  # ticket 無效 / 過期
WS_CLOSE_BAD_ORIGIN = 4403  # Origin 不在白名單

# 同 IP 每分鐘登入嘗試上限：6 位數 PIN 共 100 萬種組合，
# 每分鐘 5 次的暴力猜測要平均 190 年，對一堂課綽綽有餘
LOGIN_MAX_PER_MINUTE = 5


def generate_pin() -> str:
    """產生 6 位數隨機 PIN（TEACHER_PASSWORD 未設定時的預設密碼）。"""
    return f"{secrets.randbelow(1_000_000):06d}"


def _b64url(data: bytes) -> str:
    """base64url 編碼（去 padding，方便放 query string）。"""
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def _b64url_decode(text: str) -> bytes:
    """base64url 解碼（補回 padding）；非法輸入拋 ValueError。"""
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


class TeacherAuth:
    """教師 ticket 發放 / 驗證 + 登入限流。

    ticket 格式：base64url(exp_timestamp).base64url(HMAC-SHA256(secret, exp))
    secret 每次啟動以 secrets 隨機產生（重啟即全失效，可接受）。
    """

    def __init__(self, password: str, ttl: int, disabled: bool = False) -> None:
        # disabled=True（TEACHER_AUTH_DISABLED=1）：免登入模式 —— 任何密碼都放行，
        # ticket 機制照常運作（前端流程不變），僅密碼檢查跳過。測試環境專用。
        self.disabled = disabled
        self.password = password
        self.ttl = ttl
        self._secret = secrets.token_bytes(32)
        # 登入限流：ip → (視窗起點 monotonic 秒, 視窗內嘗試次數)
        self._attempts: dict[str, tuple[float, int]] = {}

    def check_password(self, password: str) -> bool:
        """密碼比對（constant-time，避免 timing attack）；免登入模式一律放行。"""
        if self.disabled:
            return True
        return hmac.compare_digest(password.encode("utf-8"), self.password.encode("utf-8"))

    def issue_ticket(self, now: float | None = None) -> str:
        """發一張 ttl 秒後過期的 ticket。now 可注入（測試用），預設 time.time()。"""
        exp = int((time.time() if now is None else now) + self.ttl)
        payload = str(exp).encode("ascii")
        sig = hmac.new(self._secret, payload, hashlib.sha256).digest()
        return f"{_b64url(payload)}.{_b64url(sig)}"

    def verify_ticket(self, ticket: str, now: float | None = None) -> bool:
        """驗 ticket：格式 / 簽章 / 到期時間，任一不符回 False。"""
        try:
            payload_b64, sig_b64 = ticket.split(".", 1)
            payload = _b64url_decode(payload_b64)
            sig = _b64url_decode(sig_b64)
            exp = int(payload.decode("ascii"))
        except (ValueError, UnicodeDecodeError):
            return False
        expected = hmac.new(self._secret, payload, hashlib.sha256).digest()
        if not hmac.compare_digest(sig, expected):
            return False
        return (time.time() if now is None else now) <= exp

    def allow_login_attempt(self, ip: str, now: float | None = None) -> bool:
        """登入限流（固定視窗 60 秒）：回 False = 超速，呼叫端應回 429。"""
        if now is None:
            now = time.monotonic()
        start, count = self._attempts.get(ip, (now, 0))
        if now - start >= 60.0:
            start, count = now, 0
        count += 1
        self._attempts[ip] = (start, count)
        return count <= LOGIN_MAX_PER_MINUTE


def origin_allowed(origin: str | None, host: str | None, extra_origins: frozenset[str]) -> bool:
    """Origin 白名單判定（學生 / 老師 WS 與 POST /auth/teacher 共用）。

    - 沒有 Origin header → 放行（curl / python 腳本等非瀏覽器工具、測試 client）
    - Origin 的 host 與請求 Host 相同（忽略 port）→ 放行（同站，最常見）
    - localhost / loopback / 私有網段（10. / 172.16-31. / 192.168.）→ 放行：
      教室場景學生用 LAN IP 連、老師可能用 localhost，預設放行是刻意的
    - 在 ALLOWED_ORIGINS 設定內（完整 origin 或 hostname 皆可）→ 放行
    - 其餘 → 拒絕（WS close 4403 / HTTP 403）
    """
    if origin is None:
        return True
    hostname = urlsplit(origin).hostname
    if hostname is None:
        return False
    if origin in extra_origins or hostname in extra_origins:
        return True
    # 與請求 Host 同 host（忽略 port）：urlsplit 順便處理 "ip:port" / "[v6]:port"
    req_host = urlsplit(f"//{host}").hostname if host else None
    if req_host and hostname.lower() == req_host.lower():
        return True
    if hostname.lower() == "localhost":
        return True
    try:
        ip = ipaddress.ip_address(hostname)
    except ValueError:
        return False  # 非 IP 的外部網域：不在白名單就拒絕
    return ip.is_loopback or ip.is_private
