"""VITALS FastAPI telemetry replay service.

All telemetry in this prototype is simulated. Detection is deterministic and
implemented in src.compute; no language model makes clinical determinations.
"""
from __future__ import annotations

import asyncio
import json
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from src.compute import detect_alerts, crew_summary
from src.explanation import explain_alert
from src.osdr_metadata import OSDR_STUDIES

ROOT = Path(__file__).resolve().parent
FIXTURE_PATH = ROOT / "demo_fixtures" / "vitals.json"

app = FastAPI(title="VITALS — Simulated Crew Health Console")
app.mount("/assets", StaticFiles(directory=ROOT / "assets"), name="assets")


def load_rows() -> list[dict]:
    """Load the explicitly simulated demo stream."""
    return json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))["rows"]


@app.get("/")
async def index() -> FileResponse:
    # Preserve the original VITALS experience as the primary application UI.
    return FileResponse(ROOT / "vitals.html")


@app.get("/api/health")
async def health() -> dict:
    return {"ok": True, "telemetry": "simulated", "stream_rows": len(load_rows())}


@app.get("/api/studies")
async def studies() -> dict:
    return {"studies": OSDR_STUDIES}


@app.websocket("/ws/replay")
async def replay(websocket: WebSocket) -> None:
    """Replay one simulated reading per tick. Clients can change speed/pause/reset."""
    await websocket.accept()
    rows = load_rows()
    index = 0
    speed = 1.0
    paused = False
    history: list[dict] = []

    await websocket.send_json({
        "type": "connected",
        "source_label": "SIMULATED TELEMETRY — NOT CLINICAL DATA",
        "total_rows": len(rows),
        "speed": speed,
    })

    try:
        while True:
            try:
                command = await asyncio.wait_for(websocket.receive_json(), timeout=1 / speed)
                action = command.get("action")
                if action == "speed":
                    speed = max(0.25, min(float(command.get("value", 1)), 10.0))
                    await websocket.send_json({"type": "speed", "speed": speed})
                elif action == "pause":
                    paused = not paused
                    await websocket.send_json({"type": "pause", "paused": paused})
                elif action == "reset":
                    index, history, paused = 0, [], False
                    await websocket.send_json({"type": "reset"})
                continue
            except asyncio.TimeoutError:
                pass

            if paused:
                continue
            if index >= len(rows):
                await websocket.send_json({"type": "complete"})
                paused = True
                continue

            row = rows[index]
            history.append(row)
            alerts = detect_alerts(history)
            enriched_alerts = [
                {**alert, "explanation": explain_alert(alert, OSDR_STUDIES)}
                for alert in alerts
            ]
            await websocket.send_json({
                "type": "tick",
                "index": index,
                "row": row,
                "history": history,
                "alerts": enriched_alerts,
                "summary": crew_summary(enriched_alerts),
                "source_label": "SIMULATED TELEMETRY — NOT CLINICAL DATA",
            })
            index += 1
    except WebSocketDisconnect:
        return
