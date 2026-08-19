"""多房間（Room）測試 — 開房 / 進房門檢 / 鎖房 / 滿員 / 踢人 / 關房 / 切房 / 兩房隔離 / 閒置關房。

不帶 roomCode 的既有流程（預設房 MAIN）由其他測試檔覆蓋；這裡專測房間相關行為。
老師 WS 用原始 session（不用 conftest.teacher_connect，因為那層會濾掉 room_list）。
"""

from collections.abc import Callable, Iterator
from contextlib import contextmanager

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.config import Settings
from app.protocol import WS_CLOSE_KICKED
from app.ws import MAX_BAD_PASSWORD_TRIES
from tests.conftest import FakeClock, recv_until, settle

# ---------- helpers ----------


class Teacher:
    """老師 WS 小包裝：記住目前選定的房、開房等到 room_list.selected 變成新碼。"""

    def __init__(self, ws) -> None:
        self.ws = ws
        self.selected = "MAIN"
        self.burst: list[dict] = []
        assert recv_until(ws, "room_list")["selected"] == "MAIN"  # 連上先收房間列表

    def send_json(self, data: dict) -> None:
        self.ws.send_json(data)

    def receive_json(self) -> dict:
        return self.ws.receive_json()

    def create_room(self, settings: dict | None = None) -> str:
        """開房，回傳新房碼（開完伺服器自動 select 新房）；沿路訊息留在 self.burst 供斷言。"""
        msg: dict = {"type": "room_create"}
        if settings is not None:
            msg["settings"] = settings
        self.send_json(msg)
        self.burst = []
        while True:
            m = self.ws.receive_json()
            self.burst.append(m)
            if m["type"] == "room_list" and m["selected"] not in (self.selected, "MAIN"):
                self.selected = m["selected"]
                return self.selected

    def select(self, code: str) -> None:
        self.send_json({"type": "room_select", "roomCode": code})
        self.selected = code

    def room_list(self, pred: Callable[[dict], bool] = lambda lst: True) -> dict:
        """要一份房間列表，讀到符合 pred 的那份為止（略過佇列裡較早的推送）。"""
        self.send_json({"type": "room_list_req"})
        for _ in range(50):
            lst = recv_until(self.ws, "room_list")
            if pred(lst):
                return lst
        raise AssertionError("50 份 room_list 內沒有符合條件的")


@contextmanager
def _teacher(client: TestClient, ticket: str) -> Iterator[Teacher]:
    with client.websocket_connect(f"/teacher?ticket={ticket}") as ws:
        yield Teacher(ws)


@contextmanager
def _join(client: TestClient, code: str, name: str, password: str | None = None) -> Iterator[tuple]:
    """學生以 ?room= 連上並 register；yield (ws, 收到的第一則回應)。"""
    with client.websocket_connect(f"/?room={code}") as ws:
        assert ws.receive_json()["type"] == "welcome"
        reg: dict = {"type": "register", "name": name, "emoji": "🐱"}
        if password is not None:
            reg["roomPassword"] = password
        ws.send_json(reg)
        yield ws, ws.receive_json()


def _rooms_by_code(lst: dict) -> dict[str, dict]:
    return {r["code"]: r for r in lst["rooms"]}


def _names(lst: dict) -> list[str]:
    return [x["name"] for x in lst["students"]]


def _wait_students(t, names: list[str]) -> dict:
    """讀 student_list 直到名單等於 names（略過佇列裡較早的名冊推送，如 register 前的 '?'）。"""
    for _ in range(50):
        lst = recv_until(t, "student_list")
        if _names(lst) == names:
            return lst
    raise AssertionError(f"50 份 student_list 內沒有 {names}")


# ---------- 開房 ----------


def test_老師連上先收room_list_只有預設房(client: TestClient, teacher_ticket: str) -> None:
    with client.websocket_connect(f"/teacher?ticket={teacher_ticket}") as t:
        lst = t.receive_json()
        assert lst["type"] == "room_list"
        assert lst["selected"] == "MAIN"
        assert [r["code"] for r in lst["rooms"]] == ["MAIN"]
        main = lst["rooms"][0]
        assert main["studentCount"] == 0 and main["locked"] is False
        assert main["hasPassword"] is False and main["maxStudents"] == 12
        # 接著才是預設房名冊（既有流程）
        assert t.receive_json() == {"type": "student_list", "students": []}


def test_開房拿碼_4碼去混淆字元_自動切到新房(client: TestClient, teacher_ticket: str) -> None:
    cfg: Settings = client.app.state.settings
    with _teacher(client, teacher_ticket) as t:
        code = t.create_room({"name": "三年二班", "maxStudents": 5})
        assert len(code) == cfg.room_code_length
        assert all(ch in cfg.room_code_alphabet for ch in code)
        assert not set(code) & set("0O1I")
        # 切到新房：補送新房空名冊 + 賽局快照，最後才是 room_list
        by_type = {m["type"]: m for m in t.burst}
        assert by_type["student_list"]["students"] == []
        assert by_type["arena_state"]["status"] == "idle"
        assert by_type["soccer_state"]["status"] == "idle"
        rooms = _rooms_by_code(t.room_list())
        assert set(rooms) == {"MAIN", code}
        assert rooms[code]["name"] == "三年二班" and rooms[code]["maxStudents"] == 5


def test_房間數上限_拒絕再開(client: TestClient, teacher_ticket: str) -> None:
    cfg: Settings = client.app.state.settings
    with _teacher(client, teacher_ticket) as t:
        for _ in range(cfg.room_max_rooms - 1):  # 含預設房共 room_max_rooms 間
            t.create_room()
        t.send_json({"type": "room_create"})
        settle(client)
        assert len(t.room_list()["rooms"]) == cfg.room_max_rooms


# ---------- 進房門檢 ----------


def test_進房_房不存在拒絕_不斷線可改碼重試(client: TestClient, teacher_ticket: str) -> None:
    with _teacher(client, teacher_ticket) as t:
        code = t.create_room()
        with _join(client, "ZZZZ", "小明") as (ws, resp):
            assert resp == {"type": "room_rejected", "reason": "not_found"}
            # 同一連線改碼重試 → 進房
            ws.send_json({"type": "register", "name": "小明", "emoji": "🐱", "roomCode": code})
            joined = ws.receive_json()
            assert joined["type"] == "room_joined"
            assert joined["room"]["code"] == code and joined["room"]["studentCount"] == 1


def test_進房_密碼錯拒絕_對了進房_連錯N次斷線(client: TestClient, teacher_ticket: str) -> None:
    with _teacher(client, teacher_ticket) as t:
        code = t.create_room({"password": "1234"})
        with _join(client, code, "小明") as (ws, resp):  # 沒帶密碼
            assert resp == {"type": "room_rejected", "reason": "bad_password"}
            ws.send_json(
                {"type": "register", "name": "小明", "emoji": "🐱", "roomPassword": "0000"}
            )
            assert ws.receive_json()["reason"] == "bad_password"
            ws.send_json(
                {"type": "register", "name": "小明", "emoji": "🐱", "roomPassword": "1234"}
            )
            assert ws.receive_json()["type"] == "room_joined"

        # 連錯 MAX_BAD_PASSWORD_TRIES 次 → 斷線（防暴力）
        with _join(client, code, "小華", password="x") as (ws2, resp):
            assert resp["reason"] == "bad_password"
            for _ in range(MAX_BAD_PASSWORD_TRIES - 1):
                ws2.send_json(
                    {"type": "register", "name": "小華", "emoji": "🐱", "roomPassword": "x"}
                )
                assert ws2.receive_json()["reason"] == "bad_password"
            with pytest.raises(WebSocketDisconnect) as exc:
                ws2.receive_text()
            assert exc.value.code == 1008


def test_鎖房_新人拒但舊人在_解鎖後可進(client: TestClient, teacher_ticket: str) -> None:
    with _teacher(client, teacher_ticket) as t:
        code = t.create_room()
        with _join(client, code, "小明") as (s1, resp):
            assert resp["type"] == "room_joined"
            t.send_json({"type": "room_update", "roomCode": code, "settings": {"locked": True}})
            settle(client)
            with _join(client, code, "小華") as (_, resp2):
                assert resp2 == {"type": "room_rejected", "reason": "locked"}
            # 舊人還在：老師廣播照收
            t.send_json(
                {
                    "type": "broadcast",
                    "roomCode": code,
                    "payload": {"type": "show_message", "text": "hi"},
                }
            )
            assert recv_until(s1, "show_message")["text"] == "hi"
            t.room_list(lambda lst: _rooms_by_code(lst)[code]["locked"] is True)
            t.send_json({"type": "room_update", "roomCode": code, "settings": {"locked": False}})
            settle(client)
            with _join(client, code, "小華") as (_, resp3):
                assert resp3["type"] == "room_joined"


def test_滿員拒絕_同名重連不佔額(client: TestClient, teacher_ticket: str) -> None:
    with _teacher(client, teacher_ticket) as t:
        code = t.create_room({"maxStudents": 1})
        with _join(client, code, "小明") as (s1, resp):
            assert resp["type"] == "room_joined"
            with _join(client, code, "小華") as (_, resp2):
                assert resp2 == {"type": "room_rejected", "reason": "full"}
            # 同名重連（換裝置 / 重整）不算新人：進得去、舊連線被 4000 取代
            with _join(client, code, "小明") as (_, resp3):
                assert resp3["type"] == "room_joined"
                with pytest.raises(WebSocketDisconnect) as exc:
                    s1.receive_text()
                assert exc.value.code == 4000


def test_同名重連只在房內比對_不同房同名互不影響(client: TestClient, teacher_ticket: str) -> None:
    with _teacher(client, teacher_ticket) as t:
        code = t.create_room()
        with client.websocket_connect("/") as main_ws:  # 不帶 ?room= → 預設房
            main_ws.receive_json()
            main_ws.send_json({"type": "register", "name": "小明", "emoji": "🐱"})
            assert main_ws.receive_json()["room"]["code"] == "MAIN"
            with _join(client, code, "小明") as (_, resp):
                assert resp["room"]["code"] == code
                # 預設房的小明沒被踢：老師切回 MAIN 仍看到他在線
                t.select("MAIN")
                lst = _wait_students(t, ["小明"])
                assert lst["students"][0]["connected"] is True
                t.send_json({"type": "broadcast", "payload": {"type": "show_message", "text": "M"}})
                assert main_ws.receive_json() == {"type": "show_message", "text": "M"}


# ---------- 踢人 / 關房 ----------


def test_踢人_4001_整筆移除_可重進(client: TestClient, teacher_ticket: str) -> None:
    with _teacher(client, teacher_ticket) as t:
        code = t.create_room()
        with _join(client, code, "小明") as (s1, resp):
            assert resp["type"] == "room_joined"
            sid = _wait_students(t, ["小明"])["students"][0]["id"]
            t.send_json({"type": "room_kick", "roomCode": code, "studentId": sid})
            assert s1.receive_json() == {"type": "room_closed", "reason": "kicked"}
            with pytest.raises(WebSocketDisconnect) as exc:
                s1.receive_text()
            assert exc.value.code == WS_CLOSE_KICKED
            # 名冊整筆移除（不留離線列）
            _wait_students(t, [])
        # 可重進
        with _join(client, code, "小明") as (_, resp2):
            assert resp2["type"] == "room_joined"


def test_關房_全員4001_房移除_預設房拒關(client: TestClient, teacher_ticket: str) -> None:
    with _teacher(client, teacher_ticket) as t:
        code = t.create_room()
        with _join(client, code, "小明") as (s1, r1), _join(client, code, "小華") as (s2, r2):
            assert r1["type"] == r2["type"] == "room_joined"
            t.send_json({"type": "room_close", "roomCode": code})
            for s in (s1, s2):
                assert s.receive_json() == {"type": "room_closed", "reason": "closed"}
                with pytest.raises(WebSocketDisconnect) as exc:
                    s.receive_text()
                assert exc.value.code == WS_CLOSE_KICKED
        # 老師被切回預設房、列表沒有該房
        lst = t.room_list(lambda lst: code not in _rooms_by_code(lst))
        assert lst["selected"] == "MAIN"
        assert client.app.state.rooms.get(code) is None
        # 預設房拒關
        t.send_json({"type": "room_close", "roomCode": "MAIN"})
        settle(client)
        assert "MAIN" in _rooms_by_code(t.room_list())
        assert client.app.state.rooms.get("MAIN") is client.app.state.rooms.default
        # 已關的房進不去
        with _join(client, code, "小美") as (_, r3):
            assert r3 == {"type": "room_rejected", "reason": "not_found"}


# ---------- 老師切房 / 路由 ----------


def test_老師select切房_收到對應名冊_人數推送(client: TestClient, teacher_ticket: str) -> None:
    with _teacher(client, teacher_ticket) as t:
        code = t.create_room()
        with client.websocket_connect("/") as main_ws:
            main_ws.receive_json()
            main_ws.send_json({"type": "register", "name": "主房生", "emoji": "🐱"})
            main_ws.receive_json()  # room_joined
            with _join(client, code, "分房生") as (_, resp):
                assert resp["type"] == "room_joined"
                # 目前選定分房：收到分房名冊
                _wait_students(t, ["分房生"])
                # 房間列表人數各 1
                rooms = _rooms_by_code(
                    t.room_list(lambda lst: _rooms_by_code(lst)[code]["studentCount"] == 1)
                )
                assert rooms["MAIN"]["studentCount"] == 1
                # 切回 MAIN → MAIN 名冊 + 快照 + room_list.selected=MAIN
                t.select("MAIN")
                _wait_students(t, ["主房生"])
                recv_until(t, "arena_state")
                recv_until(t, "soccer_state")
                assert recv_until(t, "room_list")["selected"] == "MAIN"
                # 再切分房
                t.select(code)
                _wait_students(t, ["分房生"])


def test_broadcast帶roomCode只到該房_缺省用選定房(client: TestClient, teacher_ticket: str) -> None:
    with _teacher(client, teacher_ticket) as t:
        code_a = t.create_room()
        code_b = t.create_room()  # 目前選定 B
        with _join(client, code_a, "A生") as (sa, ra), _join(client, code_b, "B生") as (sb, rb):
            assert ra["type"] == rb["type"] == "room_joined"
            t.send_json(
                {
                    "type": "broadcast",
                    "roomCode": code_a,
                    "payload": {"type": "show_message", "text": "給A"},
                }
            )
            t.send_json({"type": "broadcast", "payload": {"type": "show_message", "text": "給B"}})
            assert sa.receive_json() == {"type": "show_message", "text": "給A"}
            assert sb.receive_json() == {"type": "show_message", "text": "給B"}
            # 帶不存在的房碼 → 丟棄，B 生下一則仍是後續這則
            t.send_json(
                {
                    "type": "broadcast",
                    "roomCode": "ZZZZ",
                    "payload": {"type": "show_message", "text": "無"},
                }
            )
            t.send_json({"type": "broadcast", "payload": {"type": "show_message", "text": "再給B"}})
            assert sb.receive_json() == {"type": "show_message", "text": "再給B"}


def test_兩房各自開賽互不干擾(client: TestClient, teacher_ticket: str) -> None:
    rooms = client.app.state.rooms
    with _teacher(client, teacher_ticket) as t:
        code_a = t.create_room()
        code_b = t.create_room()
        with _join(client, code_a, "A生") as (sa, _), _join(client, code_b, "B生") as (sb, _):
            sa.send_json({"type": "arena_join"})
            sb.send_json({"type": "arena_join"})
            for s in (sa, sb):
                assert recv_until(s, "arena_state")["status"] == "idle"
                recv_until(s, "arena_scores")  # join 後自己房的排行廣播
            # A 房開賽（帶 roomCode）
            t.send_json(
                {"type": "arena_start", "roomCode": code_a, "durationSec": 40, "mode": "balloon"}
            )
            assert recv_until(sa, "arena_state")["status"] == "countdown"
            assert recv_until(sa, "arena_countdown")["n"] == 3
            assert rooms.get(code_a).arena.status == "countdown"
            assert rooms.get(code_b).arena.status == "idle"
            # B 房學生什麼都沒收到：下一則是 B 房廣播
            t.send_json(
                {
                    "type": "broadcast",
                    "roomCode": code_b,
                    "payload": {"type": "show_message", "text": "B"},
                }
            )
            assert sb.receive_json() == {"type": "show_message", "text": "B"}
            # 房間列表反映 A 房賽局狀態
            lst = _rooms_by_code(
                t.room_list(lambda lst: _rooms_by_code(lst)[code_a]["arenaStatus"] == "countdown")
            )
            assert lst[code_b]["arenaStatus"] == "idle"
            # 老師 arena_stop 缺省用選定房（B）→ A 不受影響；帶 roomCode 停 A
            t.send_json({"type": "arena_stop"})
            settle(client)
            assert rooms.get(code_a).arena.status == "countdown"
            t.send_json({"type": "arena_stop", "roomCode": code_a})
            assert recv_until(sa, "arena_end")["reason"] == "teacher_stop"


# ---------- 閒置自動關房 ----------


def test_閒置自動關房_注入時間(client: TestClient, teacher_ticket: str) -> None:
    cfg: Settings = client.app.state.settings
    rooms = client.app.state.rooms
    clock = FakeClock()
    rooms.now_ms = clock
    idle_ms = cfg.room_idle_close_sec * 1000
    with _teacher(client, teacher_ticket) as t:
        code = t.create_room()
        room = rooms.get(code)
        assert room is not None
        client.portal.call(rooms.tick)  # 0 人 → 開始計閒置
        clock.advance(idle_ms - 1)
        client.portal.call(rooms.tick)
        assert rooms.get(code) is room  # 還沒到
        # 有人進來 → 閒置歸零
        with _join(client, code, "小明") as (_, resp):
            assert resp["type"] == "room_joined"
            clock.advance(idle_ms)
            client.portal.call(rooms.tick)
            assert rooms.get(code) is room
        settle(client)
        client.portal.call(rooms.tick)  # 人走了 → 重新開始計
        clock.advance(idle_ms)
        client.portal.call(rooms.tick)
        assert rooms.get(code) is None
        # 預設房永遠不關；看著該房的老師被切回 MAIN
        assert rooms.get("MAIN") is rooms.default
        assert t.room_list(lambda lst: code not in _rooms_by_code(lst))["selected"] == "MAIN"
