"""場地地板圖：類型與大小規範，以及關卡 JSON 裡的網址檢查。

只接受 JPEG、PNG、WebP，最大 2 MB。檔頭必須與類型一致，
不收 SVG / HTML（避免把可執行內容存進關卡）。
關卡 definition 只允許指向本關自己的 `/api/levels/{levelId}/floor`。
"""

from __future__ import annotations

import re

MAX_FLOOR_BYTES = 2 * 1024 * 1024

_FLOOR_QUERY = re.compile(r"\?v=\d+")


def sniff_floor_image(data: bytes, content_type: str | None) -> str:
    """回傳正規化的 image/*。不符規範時丟 ValueError。"""
    if len(data) < 12 or len(data) > MAX_FLOOR_BYTES:
        raise ValueError("size")
    if data[:3] == b"\xff\xd8\xff":
        detected = "image/jpeg"
    elif data[:8] == b"\x89PNG\r\n\x1a\n":
        detected = "image/png"
    elif data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        detected = "image/webp"
    else:
        raise ValueError("magic")
    ct = (content_type or "").split(";")[0].strip().lower()
    if ct in ("image/jpg", "image/pjpeg"):
        ct = "image/jpeg"
    if ct and ct != detected:
        raise ValueError("mismatch")
    return detected


def floor_image_path(level_id: str, version: int) -> str:
    return f"/api/levels/{level_id}/floor?v={version}"


def sanitize_floor_image(definition: dict, level_id: str) -> None:
    """留下指向本關地板的相對網址；其餘（外站、別關、奇怪 query）拿掉。"""
    raw = definition.get("floorImage")
    if raw is None:
        return
    prefix = f"/api/levels/{level_id}/floor"
    if not isinstance(raw, str) or not raw.startswith(prefix):
        definition.pop("floorImage", None)
        return
    rest = raw[len(prefix) :]
    if rest != "" and _FLOOR_QUERY.fullmatch(rest) is None:
        definition.pop("floorImage", None)
