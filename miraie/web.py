#!/usr/bin/env python3
"""
miraie/web.py — Miraie AC schedule manager web UI.

Mobile-first web interface to add/delete/list schedules and send
immediate on/off commands. Runs on port 8001 by default.

Start: python3 miraie/web.py
Then expose via: cloudflared tunnel --url http://localhost:8001
"""

import json
import logging
import os
import subprocess
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, Form, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse

log = logging.getLogger(__name__)

HERE = Path(__file__).parent
SESSION_FILE  = HERE / "miraie_session.json"
SCHEDULES_FILE = HERE / "miraie_schedules.json"

app = FastAPI(title="Miraie Scheduler", docs_url=None, redoc_url=None)

# ---------------------------------------------------------------------------
# Helpers (duplicated lean versions — avoids importing the full CLI module)
# ---------------------------------------------------------------------------

def load_session() -> dict | None:
    if not SESSION_FILE.exists():
        return None
    return json.loads(SESSION_FILE.read_text())


def load_schedules() -> dict:
    if not SCHEDULES_FILE.exists():
        return {}
    return json.loads(SCHEDULES_FILE.read_text())


def save_schedules(s: dict) -> None:
    SCHEDULES_FILE.write_text(json.dumps(s, indent=2))


def schedule_id(time_str: str, action: str) -> str:
    return f"{time_str}_{action}"


def send_command(action: str) -> str:
    """Run miraie_scheduler.py --send in a subprocess. Returns log output."""
    result = subprocess.run(
        ["python3", str(HERE / "miraie_scheduler.py"), "--send", action],
        capture_output=True, text=True, timeout=20,
    )
    return result.stdout + result.stderr


# ---------------------------------------------------------------------------
# HTML helpers
# ---------------------------------------------------------------------------

DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

def page(title: str, body: str, back: str = "/") -> str:
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
  <title>{title} — Miraie</title>
  <style>
    *, *::before, *::after {{ box-sizing: border-box; margin: 0; padding: 0; }}
    body {{
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #0f172a; color: #e2e8f0;
      min-height: 100vh; padding: 1rem;
    }}
    .top-bar {{
      display: flex; align-items: center; gap: 0.75rem;
      margin-bottom: 1.25rem;
    }}
    .back {{ color: #7dd3fc; text-decoration: none; font-size: 1.2rem; }}
    h1 {{ font-size: 1.2rem; font-weight: 700; color: #f1f5f9; }}
    .card {{
      background: #1e293b; border-radius: 12px;
      padding: 1rem; margin-bottom: 1rem;
    }}
    .card h2 {{ font-size: 0.85rem; color: #94a3b8; margin-bottom: 0.75rem;
                text-transform: uppercase; letter-spacing: 0.05em; }}
    .btn {{
      display: inline-flex; align-items: center; justify-content: center;
      padding: 0.6rem 1.2rem; border-radius: 8px; border: none;
      font-size: 0.9rem; font-weight: 600; cursor: pointer;
      text-decoration: none; transition: opacity 0.15s;
    }}
    .btn:active {{ opacity: 0.7; }}
    .btn-on  {{ background: #22c55e; color: #fff; }}
    .btn-off {{ background: #ef4444; color: #fff; }}
    .btn-blue {{ background: #0ea5e9; color: #fff; }}
    .btn-ghost {{ background: #334155; color: #e2e8f0; }}
    .btn-danger {{ background: #7f1d1d; color: #fca5a5; }}
    .btn-full {{ width: 100%; margin-bottom: 0.5rem; }}
    .row {{
      display: flex; align-items: center; justify-content: space-between;
      padding: 0.6rem 0; border-bottom: 1px solid #334155;
    }}
    .row:last-child {{ border-bottom: none; }}
    .sched-time {{ font-size: 1.1rem; font-weight: 700; color: #f1f5f9; }}
    .sched-action-on  {{ color: #4ade80; font-weight: 600; font-size: 0.85rem; }}
    .sched-action-off {{ color: #f87171; font-weight: 600; font-size: 0.85rem; }}
    .sched-days {{ color: #64748b; font-size: 0.75rem; margin-top: 0.15rem; }}
    label {{ display: block; color: #94a3b8; font-size: 0.8rem;
             margin-bottom: 0.3rem; margin-top: 0.75rem; }}
    label:first-child {{ margin-top: 0; }}
    input[type=time], select {{
      width: 100%; padding: 0.6rem 0.75rem; border-radius: 8px;
      background: #0f172a; border: 1px solid #334155; color: #f1f5f9;
      font-size: 1rem;
    }}
    .day-grid {{
      display: grid; grid-template-columns: repeat(7, 1fr); gap: 0.3rem;
      margin-top: 0.5rem;
    }}
    .day-grid input {{ display: none; }}
    .day-grid label {{
      display: flex; align-items: center; justify-content: center;
      background: #334155; border-radius: 6px; padding: 0.4rem 0;
      font-size: 0.7rem; color: #94a3b8; cursor: pointer;
      margin: 0; text-align: center;
    }}
    .day-grid input:checked + label {{
      background: #0ea5e9; color: #fff;
    }}
    .flash {{
      background: #134e4a; border: 1px solid #0d9488;
      border-radius: 8px; padding: 0.75rem 1rem;
      color: #99f6e4; font-size: 0.85rem; margin-bottom: 1rem;
    }}
    .empty {{ color: #475569; text-align: center; padding: 1.5rem 0;
              font-size: 0.9rem; }}
  </style>
</head>
<body>
  <div class="top-bar">
    {"" if back == "" else f'<a class="back" href="{back}">←</a>'}
    <h1>{title}</h1>
  </div>
  {body}
</body>
</html>"""


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/", response_class=HTMLResponse)
async def dashboard(request: Request):
    session  = load_session()
    schedules = load_schedules()

    device_name = session["devices"][0]["name"] if session else "Not configured"

    # Schedule rows
    rows = ""
    for sid, s in sorted(schedules.items(), key=lambda x: x[1]["time"]):
        action_class = "sched-action-on" if s["action"] == "on" else "sched-action-off"
        action_label = "TURN ON" if s["action"] == "on" else "TURN OFF"
        days = ", ".join(s["days"]) if len(s["days"]) < 7 else "Every day"
        rows += f"""
        <div class="row">
          <div>
            <div class="sched-time">{s['time']} <span class="{action_class}">{action_label}</span></div>
            <div class="sched-days">{days}</div>
          </div>
          <form method="post" action="/delete">
            <input type="hidden" name="sid" value="{sid}">
            <button class="btn btn-danger" style="padding:0.4rem 0.8rem;font-size:0.8rem">Delete</button>
          </form>
        </div>"""

    if not rows:
        rows = '<p class="empty">No schedules yet.<br>Tap + Add Schedule below.</p>'

    body = f"""
    <div class="card">
      <h2>Device</h2>
      <div style="display:flex;align-items:center;justify-content:space-between">
        <span style="font-weight:600;color:#f1f5f9">{device_name}</span>
        <span style="font-size:0.75rem;color:#64748b">{len(schedules)} schedule(s)</span>
      </div>
    </div>

    <div class="card">
      <h2>Quick Control</h2>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem">
        <form method="post" action="/send">
          <input type="hidden" name="action" value="on">
          <button class="btn btn-on btn-full">Turn ON</button>
        </form>
        <form method="post" action="/send">
          <input type="hidden" name="action" value="off">
          <button class="btn btn-off btn-full">Turn OFF</button>
        </form>
      </div>
    </div>

    <div class="card">
      <h2>Schedules</h2>
      {rows}
      <div style="margin-top:0.75rem">
        <a href="/add" class="btn btn-blue btn-full">+ Add Schedule</a>
      </div>
    </div>
    """

    return HTMLResponse(page("Miraie Scheduler", body, back=""))


@app.get("/add", response_class=HTMLResponse)
async def add_page():
    day_checkboxes = ""
    for day in DAY_NAMES:
        day_checkboxes += f"""
        <input type="checkbox" id="d_{day}" name="days" value="{day}" checked>
        <label for="d_{day}">{day}</label>"""

    body = f"""
    <form method="post" action="/add">
      <div class="card">
        <h2>New Schedule</h2>

        <label>Time (any 5-minute interval)</label>
        <input type="time" name="time" step="300" required
               value="{datetime.now().strftime('%H:%M')}">

        <label>Action</label>
        <select name="action">
          <option value="on">Turn ON</option>
          <option value="off">Turn OFF</option>
        </select>

        <label>Repeat on days</label>
        <div class="day-grid">{day_checkboxes}</div>
      </div>

      <button type="submit" class="btn btn-blue btn-full">Save Schedule</button>
      <a href="/" class="btn btn-ghost btn-full" style="margin-top:0.5rem;text-align:center">Cancel</a>
    </form>
    """
    return HTMLResponse(page("Add Schedule", body))


@app.post("/add")
async def add_schedule(
    time: str = Form(...),
    action: str = Form(...),
    days: list[str] = Form(default=None),
):
    h, m = map(int, time.split(":"))
    m = (m // 5) * 5
    time_str = f"{h:02d}:{m:02d}"
    selected_days = days if days else DAY_NAMES

    schedules = load_schedules()
    sid = schedule_id(time_str, action)
    schedules[sid] = {
        "time": time_str,
        "action": action.lower(),
        "days": selected_days,
        "enabled": True,
        "created": datetime.now(timezone.utc).isoformat(),
    }
    save_schedules(schedules)
    return RedirectResponse("/?added=1", status_code=303)


@app.post("/delete")
async def delete_schedule(sid: str = Form(...)):
    schedules = load_schedules()
    schedules.pop(sid, None)
    save_schedules(schedules)
    return RedirectResponse("/?deleted=1", status_code=303)


@app.post("/send")
async def send_immediate(action: str = Form(...)):
    result = send_command(action)
    log.info("Immediate %s: %s", action, result.strip())
    return RedirectResponse(f"/?sent={action}", status_code=303)


@app.get("/status")
async def status():
    """JSON status endpoint for health checks."""
    session = load_session()
    return JSONResponse({
        "ok": session is not None,
        "device": session["devices"][0]["name"] if session else None,
        "schedule_count": len(load_schedules()),
        "time": datetime.now(timezone.utc).isoformat(),
    })


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("MIRAIE_PORT", 8001))
    print(f"\n  Miraie Scheduler UI → http://localhost:{port}\n")
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="warning")
