"""場地地板圖的檔頭與網址規範（不碰資料庫）。"""

import pytest

from app.floor_image import (
    MAX_FLOOR_BYTES,
    floor_image_path,
    sanitize_floor_image,
    sniff_floor_image,
)

JPEG = b"\xff\xd8\xff" + b"\x00" * 16
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 16
WEBP = b"RIFF" + b"\x00\x00\x00\x00" + b"WEBP" + b"\x00" * 8


def test_sniff_accepts_jpeg_png_webp():
    assert sniff_floor_image(JPEG, "image/jpeg") == "image/jpeg"
    assert sniff_floor_image(PNG, "image/png") == "image/png"
    assert sniff_floor_image(WEBP, "image/webp") == "image/webp"
    assert sniff_floor_image(JPEG, None) == "image/jpeg"
    assert sniff_floor_image(JPEG, "image/jpg") == "image/jpeg"


def test_sniff_rejects_html_mismatch_and_oversize():
    with pytest.raises(ValueError):
        sniff_floor_image(b"<html>" + b" " * 20, "text/html")
    with pytest.raises(ValueError):
        sniff_floor_image(PNG, "image/jpeg")
    with pytest.raises(ValueError):
        sniff_floor_image(JPEG + b"\x00" * MAX_FLOOR_BYTES, "image/jpeg")


def test_sanitize_keeps_only_this_level_path():
    ok = floor_image_path("cl-7", 12)
    definition = {"floorImage": ok, "name": "練習"}
    sanitize_floor_image(definition, "cl-7")
    assert definition["floorImage"] == ok

    for bad in (
        "https://evil.example/x.png",
        "/api/levels/cl-8/floor",
        "/api/levels/cl-7/floor?x=1",
        12,
    ):
        definition = {"floorImage": bad}
        sanitize_floor_image(definition, "cl-7")
        assert "floorImage" not in definition
