# VITALS — Astronaut Health Evidence Console

> **Simulated telemetry → personal baseline → tested detection rule → exact evidence → safe explanation**

VITALS is a crew-health console built by **QuantumBytes** for the 2026 NASA Space Apps Challenge. It shows astronauts what changed in their own telemetry, when it changed, and which tested rule caused an alert—without presenting a diagnosis.

## Important data disclosure

**All telemetry displayed by this prototype is simulated.** It is generated for a transparent demonstration of the replay and detection pipeline. VITALS does not use, expose, or claim to process live astronaut medical data.

## What the demo proves

The WebSocket stream replays `demo_fixtures/vitals.json` at one row per second. After a 30-day simulated personal baseline is available, the final replay rows contain a deliberately planted multi-signal deviation. The console shows:

- Heart rate, HRV, SpO₂, sleep hours, core temperature, and exercise minutes.
- A live trace with a **±2 SD personal-baseline band** behind it.
- Exact current reading, 30-day mean, standard deviation, z-score, and rule name.
- A 48-hour multi-signal rule that fires only when two or more signals deviate.
- A crew-facing, plain-language summary and citable NASA OSDR metadata.

## Detection is deterministic

`src/compute.py` contains the detection logic. It does not call a language model.

1. Every current signal is compared with the **preceding** 30 readings; the current point is excluded from its own baseline.
2. A per-signal rule fires at a z-score threshold of ±2 standard deviations in the configured direction.
3. The 48-hour rule fires when at least two individual signal rules fire in the latest two daily readings.

The test suite verifies a planted anomaly, every clean-fixture signal rule, and the multi-signal rule.

## Safety boundary

The explanation layer receives only a verified alert object and cached OSDR study metadata. Its bounded system prompt and post-check prohibit diagnostic or treatment language. VITALS reports measurements and rule outputs; it is **not a medical device** and does not provide clinical advice.

## NASA sources

- [NASA OSDR OSD-575 — SpaceX Inspiration4 Serum Biomarker Study](https://osdr.nasa.gov/bio/repo/data/studies/OSD-575)
- [NASA OSDR OSD-656 — SpaceX Inspiration4 Urine Inflammation Panel](https://osdr.nasa.gov/bio/repo/data/studies/OSD-656)
- [NASA Human Performance — Radiation Exposure Standard](https://www.nasa.gov/reference/4-0-human-performance/)

These studies are cited as scientific context. This prototype does not infer medical conclusions from them.

## Run locally

Requirements: Python 3.10+.

```bash
python -m pip install -r requirements.txt
python -m uvicorn app:app --reload
```

Open [http://127.0.0.1:8000](http://127.0.0.1:8000). Use the speed control to replay the simulation faster.

### Deploy on Render

`render.yaml` is included. Connect this public GitHub repository to Render and it will install `requirements.txt`, start `uvicorn app:app`, and use `/api/health` for health checks.

## Test the detection rules

```bash
python -m unittest discover -s tests -v
```

## Project structure

```text
app.py                  # FastAPI routes and WebSocket replay
demo_fixtures/vitals.json
src/compute.py          # Deterministic baseline + z-score rules
src/explanation.py      # Alert-only, safety-checked evidence explanation
src/osdr_metadata.py    # Cached citable OSDR study metadata
tests/fixtures/         # Clean and planted-anomaly fixtures
tests/test_compute.py   # Detection-rule tests
index.html              # Crew-facing evidence console
assets/                 # UI styling, client code, and visual assets
```

## Team — QuantumBytes

**NASA Space Apps Challenge location:** Cumilla, Bangladesh

| Team member | Role |
| --- | --- |
| Noor Hossain | Team Leader, Developer, and System Architect |
| Bijoy Kumar Ray | Developer and Security Lead |
| Samiya Anzuman | Documentation Lead |
| MD. Nazmul Islam Hridoy | Researcher |
| Tanjil Al-Nayeef | QA Lead |

## License

Licensed under the [Apache License 2.0](LICENSE).
