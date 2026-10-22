"""每間房自己的足球場地（F9A-A／F9A-B）。

沒釘選的房用 SOCCER_CLASS。部署腳本沒設這個變數，程式預設 F9A-A，
所以既有房間（含預設房 MAIN）跟改版前一樣。舊客戶端不送 soccerClass 也開得了房。
"""

from fastapi.testclient import TestClient

from app.config import Settings
from app.games.soccer_presets import F9A_A, F9A_B, RoomSoccerClass
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


def test_預設房是F9A_A且舊客戶端不送場地也能開房(
    client: TestClient, teacher_ticket: str
) -> None:
    """SOCCER_CLASS 沒設 → F9A-A。room_create 不帶 soccerClass 維持這個預設。"""
    soccer = client.app.state.soccer
    assert soccer.field.code == "F9A-A"
    assert soccer.field.half_z == F9A_A.half_z
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
        assert created.soccer.field.code == "F9A-A"
        assert created.info().soccerClass == "F9A-A"
        assert created.info().soccerClassPinned is False


def test_釘選F9A_B後學生收到新場地且超過人數會卸隊(
    client: TestClient, teacher_ticket: str
) -> None:
    soccer = client.app.state.soccer
    with teacher_connect(client, teacher_ticket) as t:
        recv_until(t, "student_list")
        sockets = [client.websocket_connect("/") for _ in range(5)]
        entered = [s.__enter__() for s in sockets]
        try:
            for i, ws in enumerate(entered):
                ws.receive_json()
                recv_until(t, "student_list")
                ws.send_json({"type": "register", "name": f"生{i}", "emoji": "🐱"})
                recv_until(t, "student_list")
                ws.send_json({"type": "soccer_join"})
                recv_until(ws, "soccer_state")
            # 自動分隊是 3 藍 2 紅。把紅隊也調來藍隊，藍隊滿 5 人（A 的上限）。
            for sid in ("s2", "s4"):
                t.send_json({"type": "soccer_set_team", "studentId": sid, "team": "blue"})
                settle(client)
            assert sum(1 for p in soccer.players.values() if p.team == "blue") == 5
            striker_ids = {
                p.record.id
                for p in soccer.players.values()
                if p.striker and p.team == "blue"
            }

            t.send_json(
                {"type": "room_update", "roomCode": "MAIN", "settings": {"soccerClass": "F9A-B"}}
            )
            # set_team 也會先送 soccer_state，要讀到場地已經換成 B 的那一則。
            field = None
            for _ in range(8):
                snap = recv_until(entered[0], "soccer_state")
                if snap["field"]["halfZ"] == F9A_B.half_z:
                    field = snap["field"]
                    break
            assert field is not None
            assert field["halfX"] == F9A_B.half_x
            assert field["halfZ"] == F9A_B.half_z
            assert field["ceil"] == F9A_B.ceil
            assert field["goalR"] == F9A_B.goal_r
            assert field["shieldR"] == F9A_B.shield_r
            assert field["startDepth"] == F9A_B.start_depth
            assert soccer.field.code == "F9A-B"
            assert soccer.field.max_players == 3
            blue = [p for p in soccer.players.values() if p.team == "blue"]
            assert len(blue) == 3
            assert striker_ids <= {p.record.id for p in blue}
            room = client.app.state.rooms.default
            assert room.settings.soccer_class == "F9A-B"
            assert room.info().soccerClassPinned is True
        finally:
            for s in sockets:
                s.__exit__(None, None, None)


def test_比賽中拒絕換場地(client: TestClient, teacher_ticket: str) -> None:
    soccer = client.app.state.soccer
    soccer.status = "countdown"
    with teacher_connect(client, teacher_ticket) as t:
        recv_until(t, "student_list")
        t.send_json(
            {"type": "room_update", "roomCode": "MAIN", "settings": {"soccerClass": "F9A-B"}}
        )
        settle(client)
        assert soccer.field.code == "F9A-A"
        assert client.app.state.rooms.default.settings.soccer_class is None
        assert client.app.state.rooms.default.info().soccerClassPinned is False


def test_取消釘選回到環境變數(tmp_path) -> None:
    """伺服器預設改成 F9A-B 時，沒釘選的房跟它走；釘了 A 就維持 A。"""
    static_dir = tmp_path / "dist"
    static_dir.mkdir()
    settings = Settings(
        port=3000,
        static_dir=static_dir,
        teacher_dist=tmp_path / "no-teacher",
        teacher_password="test123",
        game_tick_interval=0,
        database_url=None,
        soccer_class="F9A-B",
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
                {"type": "room_create", "settings": {"name": "釘A", "soccerClass": "F9A-A"}}
            )
            listed = recv_until(ws, "room_list")
            created = next(room for room in listed["rooms"] if room["name"] == "釘A")
            assert created["soccerClass"] == "F9A-A"
            assert created["soccerClassPinned"] is True
            code = created["code"]
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
