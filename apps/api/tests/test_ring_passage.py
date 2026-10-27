"""穿環判定：與前端 crossing.ts 跑同一份案例，並驗證比賽裡的進球 / 扣分 / 烏龍。"""

import asyncio
import json
from pathlib import Path

import pytest
from starlette.websockets import WebSocketState

from app.games.soccer import SoccerGame
from app.games.soccer_rules import RingPassage, advance_ring_passage
from app.protocol import SoccerPosMsg
from app.roster import Roster, StudentRecord
from tests.conftest import FakeClock

_CASES_PATH = (
    Path(__file__).resolve().parents[2] / "simulator/src/soccer/ringPassageCases.json"
)
_DATA = json.loads(_CASES_PATH.read_text(encoding="utf-8"))


@pytest.mark.parametrize("case", _DATA["cases"], ids=[c["name"] for c in _DATA["cases"]])
def test_共用案例與前端一致(case: dict) -> None:
    ring = _DATA["ring"]
    state = RingPassage()
    passed = False
    points = [tuple(p) for p in case["points"]]
    for prev, curr in zip(points, points[1:], strict=False):
        passed = (
            advance_ring_passage(
                state,
                prev,
                curr,
                goal_z=case["goalZ"],
                goal_y=ring["goalY"],
                goal_r=ring["goalR"],
                attack_sign=case["attackSign"],
                half_thick=ring["halfThick"],
                shield_r=ring["shieldR"],
            )
            or passed
        )
    assert passed is case["passed"]


class _WS:
    client_state = WebSocketState.CONNECTED

    async def send_text(self, data: str) -> None:
        _ = data


async def _match() -> tuple[SoccerGame, FakeClock, StudentRecord, StudentRecord]:
    game = SoccerGame(Roster())
    clock = FakeClock()
    game.now_ms = clock
    blue = StudentRecord(id="b", ws=_WS(), name="藍", emoji="🐱")
    red = StudentRecord(id="r", ws=_WS(), name="紅", emoji="🐶")
    await game.join(blue)
    await game.join(red)
    players = {p.record.id: p for p in game.players.values()}
    players["b"].team, players["r"].team = "blue", "red"
    players["b"].striker = players["r"].striker = True
    await game.start(60)
    for _ in range(5):
        clock.advance(1000)
        await game.tick()
    assert game.status == "running"
    return game, clock, blue, red


async def _fly(game: SoccerGame, clock: FakeClock, rec: StudentRecord, zs: list[float]) -> None:
    for z in zs:
        clock.advance(100)
        await game.pos(rec, SoccerPosMsg(type="soccer_pos", x=0, y=game.field.goal_y, z=z, yaw=0))


def test_正面穿對方門才算進球() -> None:
    async def run() -> SoccerGame:
        game, clock, blue, _ = await _match()
        gz = game._teams["blue"]["attackGoalZ"]
        await _fly(game, clock, blue, [gz - 0.8, gz - 0.4, gz + 0.3])
        await game.goal(blue)
        return game

    assert asyncio.run(run()).scores["blue"] == 1


def test_從對方門後伸進再退出_不算進球() -> None:
    async def run() -> SoccerGame:
        game, clock, blue, _ = await _match()
        gz = game._teams["blue"]["attackGoalZ"]
        await _fly(game, clock, blue, [gz + 0.4, gz + 0.1, gz + 0.2, gz + 0.4])
        await game.goal(blue)
        return game

    assert asyncio.run(run()).scores["blue"] == 0


def test_自家門前伸進再退回場內_不扣分() -> None:
    async def run() -> SoccerGame:
        game, clock, blue, _ = await _match()
        dz = game._teams["blue"]["defendGoalZ"]  # 藍隊守 -z 門，場內在 +z 側
        await _fly(game, clock, blue, [dz + 0.5, dz + 0.15, dz + 0.25, dz + 0.6])
        return game

    assert asyncio.run(run()).deductions["blue"] == 0


def test_從自家門後反向穿回場內_扣分() -> None:
    async def run() -> SoccerGame:
        game, clock, blue, _ = await _match()
        dz = game._teams["blue"]["defendGoalZ"]
        await _fly(game, clock, blue, [dz - 0.4, dz - 0.2, dz + 0.3])
        return game

    assert asyncio.run(run()).deductions["blue"] == 1
