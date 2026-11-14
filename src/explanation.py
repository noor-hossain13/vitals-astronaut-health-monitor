"""Safety-limited explanation layer for already-detected alerts."""
from __future__ import annotations

from .compute import SIGNAL_CONFIG

SYSTEM_PROMPT = """You receive only a deterministic alert object and cached OSDR study metadata.
Describe what the rule measured, when it fired, and cite one provided study id and URL.
Never state or imply a diagnosis. Never recommend treatment, medication, or a clinical intervention."""

BANNED_TERMS = {
    "diagnosis", "diagnose", "disease", "disorder", "syndrome", "patient",
    "treatment", "treat", "medication", "prescribe", "therapy", "clinical advice",
}


def post_check(text: str) -> str:
    """Block unsafe diagnostic/treatment language as a final enforcement layer."""
    lower = text.lower()
    if any(term in lower for term in BANNED_TERMS):
        return "Explanation blocked by the health-safety language filter. Review the measured alert values and cited source."
    return text


def explain_alert(alert: dict, studies: dict) -> dict:
    """Generate a bounded, evidence-linked explanation from alert + cached metadata only."""
    study = studies["OSD-575"] if alert["rule"] != "multi_signal_deviation_48h" else studies["OSD-656"]
    if alert["rule"] == "multi_signal_deviation_48h":
        signals = ", ".join(SIGNAL_CONFIG[s]["label"] for s in alert["signals"])
        text = (
            f"The multi-signal rule fired at {alert['timestamp']}: {signals} each crossed their tested "
            f"personal-baseline threshold within the same {alert['window_hours']}-hour window."
        )
    else:
        direction = "below" if alert["direction"] == "low" else "above"
        text = (
            f"At {alert['timestamp']}, {alert['label']} measured {alert['current']} {alert['unit']}, "
            f"{direction} the prior {alert['window_days']}-day personal mean of {alert['baseline_mean']} "
            f"{alert['unit']} (z-score {alert['z']}). The tested rule named {alert['rule']} fired."
        )
    return {"text": post_check(text), "study": study, "system_prompt": SYSTEM_PROMPT}
