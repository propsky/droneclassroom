"""臺北賽制預設，而且一定配 F9A-B。已存的 JSON 不改寫，只在讀的時候換算。"""

from app.games.soccer_presets import F9A_A, F9A_B
from app.games.taipei_rules import SoccerPairing


class TestSoccerPairing:
    """每一列是 teams.settings 裡可能留下的舊值。before 是改版前的有效組合。"""

    ROWS = (
        # stored ruleset, stored class, env, before rules, before field, after rules, after field
        (None, None, "F9A-A", "f9a", "F9A-A", "taipei", "F9A-B"),
        (None, "F9A-A", "F9A-A", "f9a", "F9A-A", "taipei", "F9A-B"),
        (None, "F9A-B", "F9A-A", "f9a", "F9A-B", "taipei", "F9A-B"),
        ("f9a", None, "F9A-A", "f9a", "F9A-A", "f9a", "F9A-A"),
        ("f9a", "F9A-A", "F9A-B", "f9a", "F9A-A", "f9a", "F9A-A"),
        ("f9a", "F9A-B", "F9A-A", "f9a", "F9A-B", "f9a", "F9A-B"),
        ("taipei", None, "F9A-A", "taipei", "F9A-A", "taipei", "F9A-B"),
        ("taipei", "F9A-A", "F9A-A", "taipei", "F9A-A", "taipei", "F9A-B"),
        ("taipei", "F9A-B", "F9A-A", "taipei", "F9A-B", "taipei", "F9A-B"),
    )

    @staticmethod
    def _before(ruleset: str | None, field: str | None, env: str) -> tuple[str, str]:
        old_rules = ruleset if ruleset in ("f9a", "taipei") else "f9a"
        old_field = field if field in ("F9A-A", "F9A-B") else env
        return old_rules, old_field

    def test_舊設定換算表(self) -> None:
        for stored_rules, stored_class, env, b_rules, b_field, a_rules, a_field in self.ROWS:
            assert self._before(stored_rules, stored_class, env) == (b_rules, b_field)
            spec = SoccerPairing.field_spec(stored_rules, stored_class, env)
            assert SoccerPairing.ruleset(stored_rules) == a_rules
            assert spec.code == a_field

    def test_臺北賽制不能留在大場_進階F9A可以(self) -> None:
        assert SoccerPairing.allows_big_field("taipei") is False
        assert SoccerPairing.allows_big_field(None) is False
        assert SoccerPairing.allows_big_field("f9a") is True
        assert SoccerPairing.field_spec("taipei", "F9A-A", "F9A-A") is F9A_B
        assert SoccerPairing.field_spec("f9a", "F9A-A", "F9A-B") is F9A_A
        assert SoccerPairing.field_spec("nope", None, "F9A-A").code == "F9A-B"
