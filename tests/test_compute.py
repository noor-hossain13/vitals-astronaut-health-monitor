import json
from pathlib import Path
import unittest

from src.compute import detect_alerts, deviation_rule, multi_signal_rule

FIXTURES = Path(__file__).parent / "fixtures"


def load(name):
    return json.loads((FIXTURES / name).read_text())["rows"]


class BaselineDetectionTests(unittest.TestCase):
    def test_hrv_rule_fires_on_planted_anomaly(self):
        result = deviation_rule(load("planted_anomaly.json"), "hrv", baseline_days=5, threshold_sd=2)
        self.assertTrue(result["fired"])
        self.assertEqual(result["rule"], "hrv_below_personal_baseline")
        self.assertLess(result["z"], -2)

    def test_each_single_signal_rule_fires_on_a_planted_deviation(self):
        """Each deterministic signal rule has an explicit planted-anomaly test."""
        baseline = load("clean_fixture.json")
        planted_values = {
            "heart_rate": 82, "hrv": 28, "spo2": 92,
            "sleep_hours": 3.5, "core_temperature": 38.3, "exercise_minutes": 5,
        }
        for signal, planted_value in planted_values.items():
            with self.subTest(signal=signal):
                rows = [dict(row) for row in baseline]
                rows[-1][signal] = planted_value
                result = deviation_rule(rows, signal, baseline_days=5, threshold_sd=2)
                self.assertTrue(result["fired"])

    def test_each_single_signal_rule_is_clean_fixture_safe(self):
        alerts = detect_alerts(load("clean_fixture.json"), baseline_days=5, threshold_sd=2)
        self.assertEqual(alerts, [])

    def test_multi_signal_rule_fires_for_same_48_hour_window(self):
        result = multi_signal_rule(load("planted_anomaly.json"), baseline_days=5, threshold_sd=2)
        self.assertIsNotNone(result)
        self.assertTrue(result["fired"])
        self.assertGreaterEqual(len(result["signals"]), 2)


if __name__ == "__main__":
    unittest.main()
