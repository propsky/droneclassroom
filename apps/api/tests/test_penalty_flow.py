"""罰球會不會再打開：純判斷，不經 WebSocket。"""

from app.games.soccer_rules import PenaltyFlow


def test_留在自家圓環不算新的一筆() -> None:
    assert PenaltyFlow.own_ring_occupied(striker=False, disabled=False, inside=True)
    assert not PenaltyFlow.own_ring_occupied(striker=True, disabled=False, inside=True)
    assert not PenaltyFlow.own_ring_occupied(striker=False, disabled=True, inside=True)
    assert PenaltyFlow.open_own_ring(status="running", occupied=True, already_inside=False)
    assert PenaltyFlow.open_own_ring(status="golden", occupied=True, already_inside=False)
    assert not PenaltyFlow.open_own_ring(status="running", occupied=True, already_inside=True)
    assert not PenaltyFlow.open_own_ring(status="penalty", occupied=True, already_inside=False)
    assert not PenaltyFlow.open_own_ring(status="running", occupied=False, already_inside=False)


def test_未返場同一輪只開一次() -> None:
    assert PenaltyFlow.open_no_return(armed=False, sanctioned=False)
    assert not PenaltyFlow.open_no_return(armed=False, sanctioned=True)
    assert not PenaltyFlow.open_no_return(armed=True, sanctioned=False)
    assert not PenaltyFlow.open_no_return(armed=True, sanctioned=True)
