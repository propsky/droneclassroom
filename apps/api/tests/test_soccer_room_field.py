"""每間房的足球場地固定 F9A-B。

舊的 soccerRuleset=f9a、釘選的 F9A-A、環境變數 SOCCER_CLASS 都留在 JSON 或設定裡，
比賽讀到一律臺北賽制 + 小場。不回填。
"""

from fastapi.testclient import TestClient

from app.config import Settings
from app.games.soccer_presets import F9A_B, RoomSoccerClass
from app.main import create_app
from tests.conftest import recv_until, settle, teacher_connect


class TestRoomSoccerClass:
    def test_讀寫釘選不弄丟其他設定(self) -> None:
        saved = RoomSoccerClass.write({"rooms": {"subs": [{"code": "AB12"}]}}, "F9A-B")
        assert saved["soccerClass"] == "F9A-B"
        assert saved["rooms"]["subs"][0]["code"] == "AB12"
        assert RoomSoccerClass.read(saved) == "F9A-B"
        cleared = RoomSoccerClass.write(saved, None)
        assert "soccerClass" not in cleared
        assert cleared["rooms"]["subs"][0]["code"] == "AB12"
        assert RoomSoccerClass.read({}) is None
        assert RoomSoccerClass.read({"soccerClass": "nope"}) is None
        assert RoomSoccerClass.read(None) is None

    def test_沒釘選時用伺服器預設_打錯的代碼回到F9A_A(self) -> None:
        assert RoomSoccerClass.resolve(None, "F9A-B").code == "F9A-B"
        assert RoomSoccerClass.resolve("F9A-A", "F9A-B").code == "F9A-A"
        assert RoomSoccerClass.resolve("F9A-C", "F9A-B").code == "F9A-B"
        assert RoomSoccerClass.parse("server") is None
        assert RoomSoccerClass.parse("F9A-B") == "F9A-B"


def test_預設房是臺北賽制小場且舊客戶端不送場地也一樣(
    client: TestClient, teacher_ticket: str
) -> None:
    """沒寫 soccerRuleset／soccerClass → 臺北賽制 + F9A-B。不讀環境變數的大場。"""
    soccer = client.app.state.soccer
    assert soccer.ruleset == "taipei"
    assert soccer.field.code == "F9A-B"
    assert soccer.field.half_z == F9A_B.half_z
    with teacher_connect(client, teacher_ticket) as t:
        recv_until(t, "student_list")
        t.send_json({"type": "room_create", "settings": {"name": "舊客戶端"}})
        created = None
        for _ in range(20):
            settle(client)
            created = next(
                (r for r in client.app.state.rooms.rooms if r.settings.name == "舊客戶端"),
                None,
            )
            if created is not None:
                break
        assert created is not None
        assert created.settings.soccer_class is None
        assert created.settings.soccer_ruleset is None
        assert created.soccer.ruleset == "taipei"
        assert created.soccer.field.code == "F9A-B"
        assert created.info().soccerClass == "F9A-B"
        assert created.info().soccerRuleset == "taipei"
        assert created.info().soccerClassPinned is False


def test_舊的f9a與大場釘選仍讀得了但打小場(
    client: TestClient, teacher_ticket: str
) -> None:
    """送來 f9a + F9A-A：JSON 留著，實際賽制與場地不變。每隊上限仍是 3。"""
    soccer = client.app.state.soccer
    with teacher_connect(client, teacher_ticket) as t:
        recv_until(t, "student_list")
        t.send_json(
            {
                "type": "room_update",
                "roomCode": "MAIN",
                "settings": {"soccerRuleset": "f9a", "soccerClass": "F9A-A"},
            }
        )
        settle(client)
        room = client.app.state.rooms.default
        assert room.settings.soccer_ruleset == "f9a"
        assert room.settings.soccer_class == "F9A-A"
        assert soccer.ruleset == "taipei"
        assert soccer.field.code == "F9A-B"
        assert soccer.field.max_players == 3
        assert room.info().soccerRuleset == "taipei"
        assert room.info().soccerClass == "F9A-B"
        assert room.info().soccerClassPinned is True
        sockets = [client.websocket_connect("/") for _ in range(4)]
        entered = [s.__enter__() for s in sockets]
        try:
            for i, ws in enumerate(entered):
                ws.receive_json()
                recv_until(t, "student_list")
                ws.send_json({"type": "register", "name": f"生{i}", "emoji": "🐱"})
                recv_until(t, "student_list")
                ws.send_json({"type": "soccer_join"})
                recv_until(ws, "soccer_state")
            for sid in ("s2", "s4"):
                t.send_json({"type": "soccer_set_team", "studentId": sid, "team": "blue"})
                settle(client)
            blue = [p for p in soccer.players.values() if p.team == "blue"]
            assert len(blue) == 3
        finally:
            for s in sockets:
                s.__exit__(None, None, None)


def test_比賽中拒絕改成大場或換成進階F9A(client: TestClient, teacher_ticket: str) -> None:
    soccer = client.app.state.soccer
    soccer.status = "countdown"
    with teacher_connect(client, teacher_ticket) as t:
        recv_until(t, "student_list")
        t.send_json(
            {
                "type": "room_update",
                "roomCode": "MAIN",
                "settings": {"soccerRuleset": "f9a", "soccerClass": "F9A-A"},
            }
        )
        settle(client)
        assert soccer.ruleset == "taipei"
        assert soccer.field.code == "F9A-B"
        room = client.app.state.rooms.default
        assert room.settings.soccer_ruleset == "f9a"
        assert room.settings.soccer_class == "F9A-A"


def test_環境變數A或怪值都不改小場(tmp_path) -> None:
    """釘了 F9A-A 也只是把字留在設定。實際場地是 F9A-B。取消釘選也不放大場。"""
    static_dir = tmp_path / "dist"
    static_dir.mkdir()
    settings = Settings(
        port=3000,
        static_dir=static_dir,
        teacher_dist=tmp_path / "no-teacher",
        teacher_password="test123",
        game_tick_interval=0,
        database_url=None,
        soccer_class="not-a-class",
    )
    app = create_app(settings)
    with TestClient(app) as client:
        assert client.app.state.soccer.field.code == "F9A-B"
        r = client.post("/auth/teacher", json={"password": "test123"})
        ticket = r.json()["ticket"]
        with client.websocket_connect(f"/teacher?ticket={ticket}") as ws:
            assert recv_until(ws, "room_list")["rooms"][0]["soccerClass"] == "F9A-B"
            assert recv_until(ws, "student_list")
            ws.send_json(
                {
                    "type": "room_create",
                    "settings": {
                        "name": "釘A",
                        "soccerRuleset": "f9a",
                        "soccerClass": "F9A-A",
                    },
                }
            )
            listed = recv_until(ws, "room_list")
            created = next(room for room in listed["rooms"] if room["name"] == "釘A")
            assert created["soccerClass"] == "F9A-B"
            assert created["soccerRuleset"] == "taipei"
            assert created["soccerClassPinned"] is True
            code = created["code"]
            live = client.app.state.rooms.get(code)
            assert live is not None
            assert live.settings.soccer_ruleset == "f9a"
            assert live.settings.soccer_class == "F9A-A"
            assert live.soccer.field.code == "F9A-B"
            ws.send_json(
                {
                    "type": "room_update",
                    "roomCode": code,
                    "settings": {"soccerClass": "server"},
                }
            )
            # 開房當下可能還有一份舊的 room_list 在佇列，讀到釘選已取消的那份為止。
            updated = None
            for _ in range(4):
                again = recv_until(ws, "room_list")
                updated = next(room for room in again["rooms"] if room["code"] == code)
                if updated["soccerClassPinned"] is False:
                    break
            assert updated is not None
            assert updated["soccerClass"] == "F9A-B"
            assert updated["soccerClassPinned"] is False
            live = client.app.state.rooms.get(code)
            assert live is not None
            assert live.settings.soccer_class is None
            assert live.soccer.field.code == "F9A-B"


def test_環境變數B時預設房是B(tmp_path) -> None:
    static_dir = tmp_path / "dist"
    static_dir.mkdir()
    app = create_app(
        Settings(
            static_dir=static_dir,
            teacher_dist=tmp_path / "no-teacher",
            teacher_password="test123",
            game_tick_interval=0,
            database_url=None,
            soccer_class="F9A-B",
        )
    )
    with TestClient(app) as client:
        field = client.app.state.soccer.field
        assert field.code == "F9A-B"
        assert field.half_z == F9A_B.half_z
        assert field.max_players == 3
