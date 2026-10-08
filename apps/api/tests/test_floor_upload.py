"""場地地板上傳：先讀完 multipart，無資料庫時回明確狀態，而不是讓瀏覽器當成斷線。"""

from fastapi.testclient import TestClient

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 16


def test_記憶體模式壞圖回400(client: TestClient) -> None:
    response = client.post(
        "/api/teacher/levels/1/floor",
        files={"file": ("floor.png", b"this is not an image!!", "image/png")},
        headers={"Authorization": "Bearer nope"},
    )
    assert response.status_code == 400
    assert "JPEG" in response.json()["detail"]


def test_記憶體模式沒有檔案回400(client: TestClient) -> None:
    response = client.post(
        "/api/teacher/levels/1/floor",
        files={"note": (None, "hi")},
        headers={"Authorization": "Bearer nope"},
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "請上傳圖片檔"


def test_記憶體模式合法圖回需要資料庫(client: TestClient) -> None:
    response = client.post(
        "/api/teacher/levels/1/floor",
        files={"file": ("floor.png", PNG, "image/png")},
        headers={"Authorization": "Bearer nope"},
    )
    assert response.status_code == 503
    assert "資料庫" in response.json()["detail"]
