"""Deterministic personal-baseline anomaly detection. No clinical interpretation."""
from __future__ import annotations

from statistics import mean, stdev
from typing import Iterable

SIGNAL_CONFIG = {
    "heart_rate": {"label": "Heart rate", "unit": "bpm", "direction": "high"},
    "hrv": {"label": "Heart rate variability", "unit": "ms", "direction": "low"},
    "spo2": {"label": "Blood oxygen", "unit": "%", "direction": "low"},
    "sleep_hours": {"label": "Sleep duration", "unit": "h", "direction": "low"},
    "core_temperature": {"label": "Core temperature", "unit": "°C", "direction": "high"},
    "exercise_minutes": {"label": "Exercise", "unit": "min", "direction": "low"},
}


def _numbers(rows: Iterable[dict], signal: str) -> list[float]:
    return [float(row[signal]) for row in rows if signal in row]


def deviation_rule(rows: list[dict], signal: str, baseline_days: int = 30, threshold_sd: float = 2.0) -> dict:
    """Compare the current value to the preceding personal baseline window.

    The current reading is deliberately excluded from the baseline. This returns
    measurements only; it does not make a diagnosis or treatment recommendation.
    """
    values = _numbers(rows, signal)
    config = SIGNAL_CONFIG[signal]
    if len(values) < baseline_days + 1:
        return {
            "rule": f"{signal}_{'below' if config['direction'] == 'low' else 'above'}_personal_baseline",
            "signal": signal,
            "fired": False,
            "reason": "insufficient_personal_baseline",
            "required_readings": baseline_days + 1,
            "available_readings": len(values),
        }

    baseline = values[-(baseline_days + 1):-1]
    current = values[-1]
    mu = mean(baseline)
    sd = stdev(baseline) if len(baseline) > 1 else 0.0
    z = (current - mu) / sd if sd else 0.0
    is_low = config["direction"] == "low"
    fired = z <= -threshold_sd if is_low else z >= threshold_sd
    return {
        "rule": f"{signal}_{'below' if is_low else 'above'}_personal_baseline",
        "signal": signal,
        "label": config["label"],
        "unit": config["unit"],
        "current": round(current, 2),
        "baseline_mean": round(mu, 2),
        "baseline_sd": round(sd, 2),
        "z": round(z, 2),
        "fired": fired,
        "window_days": baseline_days,
        "direction": config["direction"],
        "timestamp": rows[-1].get("timestamp"),
    }


def hrv_deviation(series: list[float], baseline_days: int = 30, threshold_sd: float = 2.0) -> dict:
    """Flags an HRV drop below a personal baseline; returns numbers, not interpretation."""
    return deviation_rule([{"hrv": value} for value in series], "hrv", baseline_days, threshold_sd)


def multi_signal_rule(history: list[dict], baseline_days: int = 30, threshold_sd: float = 2.0, window_hours: int = 48) -> dict | None:
    """Fire only when >=2 tested signal rules are active in the same 48-hour window.

    Fixture timestamps are daily, so the final two rows represent the 48-hour window.
    """
    if len(history) < baseline_days + 1:
        return None
    recent_rows = history[-2:]
    active: dict[str, dict] = {}
    for ending_row in recent_rows:
        ending = history[: history.index(ending_row) + 1]
        for signal in SIGNAL_CONFIG:
            result = deviation_rule(ending, signal, baseline_days, threshold_sd)
            if result.get("fired"):
                active[signal] = result
    if len(active) < 2:
        return None
    return {
        "rule": "multi_signal_deviation_48h",
        "fired": True,
        "window_hours": window_hours,
        "signals": list(active),
        "evidence": list(active.values()),
        "timestamp": history[-1].get("timestamp"),
    }


def detect_alerts(history: list[dict], baseline_days: int = 30, threshold_sd: float = 2.0) -> list[dict]:
    alerts = []
    for signal in SIGNAL_CONFIG:
        result = deviation_rule(history, signal, baseline_days, threshold_sd)
        if result.get("fired"):
            alerts.append(result)
    multi = multi_signal_rule(history, baseline_days, threshold_sd)
    if multi:
        alerts.append(multi)
    return alerts


def crew_summary(alerts: list[dict]) -> str:
    """Plain language summary of rule outputs without clinical claims."""
    if not alerts:
        return "No baseline-deviation rules are currently firing in the simulated stream."
    multi = next((a for a in alerts if a["rule"] == "multi_signal_deviation_48h"), None)
    if multi:
        labels = ", ".join(SIGNAL_CONFIG[s]["label"].lower() for s in multi["signals"])
        return f"Two or more simulated signals deviated from this crew member’s personal baseline within 48 hours: {labels}."
    alert = alerts[0]
    return f"{alert['label']} is outside this crew member’s tested personal-baseline threshold in the simulated stream."
