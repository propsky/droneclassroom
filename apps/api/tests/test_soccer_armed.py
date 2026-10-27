"""進球後全隊回半場：還沒回來的隊員墜機、斷線或離場，不能讓整隊一直鎖住。"""

import asyncio

import pytest
from starlette.websockets import WebSocketState

from app.games.soccer import SoccerGame
from app.protocol import SoccerPosMsg
from app.roster import Roster, StudentRecord
from tests.conftest import FakeClock


class _WS:
    client_state = WebSocketState.CONNECTED

    async def send_text(self, data: str) -> None:
        _ = data


async def _scenario(mode: str) -> SoccerGame:
    game = SoccerGame(Roster())
    clock = FakeClock()
    game.now_ms = clock
    striker, defender, red = (
        StudentRecord(id=f"s{i}", ws=_WS(), name=name, emoji="🐱")
        for i, name in enumerate(["前鋒", "隊友", "紅隊"])
    )
    for rec in (striker, defender, red):
        await game.join(rec)
    by_name = {p.record.name: p for p in game.players.values()}
    by_name["前鋒"].team = by_name["隊友"].team = "blue"
    by_name["紅隊"].team = "red"
    by_name["前鋒"].striker = by_name["紅隊"].striker = True
    by_name["隊友"].striker = False
    await game.start(60)
    for _ in range(5):
        clock.advance(1000)
        await game.tick()
    assert game.status == "running"

    async def pos(rec: StudentRecord, x: float, y: float, z: float) -> None:
        clock.advance(100)
        await game.pos(rec, SoccerPosMsg(type="soccer_pos", x=x, y=y, z=z, yaw=0))

    goal_y = game.field.goal_y
    for z in (-2.0, -1.0, 0.0, 1.0):  # 隊友先飛進對方半場
        await pos(defender, 0.8, 1.0, z)
    for z in (-1.0, 0.0, 1.0, 1.5, 1.8, 2.3):  # 前鋒穿紅門
        await pos(striker, 0.0, goal_y, z)
    await game.goal(striker)
    assert game.scores["blue"] == 1
    for z in (1.5, 0.5, -0.5):  # 前鋒回己方半場，隊友還沒回
        await pos(striker, 0.0, 1.0, z)
    await game.tick()
    assert game.armed["blue"] is False

    if mode == "crash":
        await game.crash(defender)
    elif mode == "disconnect":
        await game.disconnect(defender)
    else:
        await game.leave(defender)
    clock.advance(80)
    await game.tick()
    assert game.armed["blue"] is True

    for z in (0.0, 1.0, 1.5, 1.8, 2.3):
        await pos(striker, 0.0, goal_y, z)
    await game.goal(striker)
    return game


@pytest.mark.parametrize("mode", ["crash", "disconnect", "leave"])
def test_沒回半場的隊員離開後_全隊恢復可得分(mode: str) -> None:
    game = asyncio.run(_scenario(mode))
    assert game.scores["blue"] == 2
