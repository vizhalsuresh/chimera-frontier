#!/usr/bin/env python3
"""
web_ui.py — E-Agent FastAPI dashboard.

Serves a local web interface at http://localhost:8000 (or configured host:port).
Provides status, logs, mission viewer, and manual sync trigger.
"""

import asyncio
import json
import logging
import os
import re
from datetime import datetime, timezone
from pathlib import Path

from fastapi import BackgroundTasks, FastAPI
from fastapi.responses import HTMLResponse, JSONResponse

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [web_ui] %(levelname)s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger(__name__)

CONFIG_PATH = os.environ.get("EAGENT_CONFIG", "/root/agents/config.json")

app = FastAPI(title="E-Agent Control Panel", version="1.0.0")

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def load_config(path: str = CONFIG_PATH) -> dict:
    with open(path) as f:
        return json.load(f)


def read_cycle_state(state_file: str) -> dict:
    try:
        with open(state_file) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {
            "cycle_index": 0,
            "hour_in_cycle": 0,
            "last_run_iso": None,
            "sync_pending": False,
        }


def get_log_files(logs_dir: str, limit: int = 10) -> list[dict]:
    logs_path = Path(logs_dir)
    if not logs_path.exists():
        return []
    files = sorted(
        logs_path.glob("*.md"),
        key=lambda f: f.stat().st_mtime,
        reverse=True,
    )[:limit]

    result = []
    for f in files:
        # Parse agent name from filename: YYYY-MM-DD_HH_agent_name.md
        parts = f.stem.split("_", 2)
        agent = parts[2] if len(parts) >= 3 else f.stem
        mtime = datetime.fromtimestamp(f.stat().st_mtime, tz=timezone.utc)
        result.append({
            "filename": f.name,
            "agent": agent.replace("_", " ").title(),
            "timestamp": mtime.isoformat(),
            "content": f.read_text(encoding="utf-8"),
        })
    return result


def minutes_until_next_hour(last_run_iso: str | None) -> int:
    if not last_run_iso:
        return 60
    try:
        last = datetime.fromisoformat(last_run_iso)
        now = datetime.now(timezone.utc)
        elapsed = (now - last).total_seconds()
        remaining = max(0, 3600 - elapsed)
        return int(remaining / 60)
    except (ValueError, TypeError):
        return 60


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/status")
async def get_status() -> JSONResponse:
    config = load_config()
    state = read_cycle_state(config["state_file"])

    rotation = config["rotation_order"]
    current_idx = state.get("cycle_index", 0) % len(rotation)
    current_agent = rotation[current_idx].replace("_", " ").title()
    hour_in_cycle = state.get("hour_in_cycle", 0)

    return JSONResponse({
        "current_agent": current_agent,
        "hour_in_cycle": hour_in_cycle,
        "total_hours": len(rotation),
        "minutes_until_next_rotation": minutes_until_next_hour(state.get("last_run_iso")),
        "sync_pending": state.get("sync_pending", False),
        "last_run": state.get("last_run_iso") or "never",
        "last_sync": state.get("last_sync_iso") or "never",
    })


@app.get("/logs")
async def get_logs(limit: int = 10) -> JSONResponse:
    config = load_config()
    logs = get_log_files(config["logs_dir"], limit=limit)
    return JSONResponse(logs)


@app.get("/mission")
async def get_mission() -> JSONResponse:
    config = load_config()
    mission_path = Path(config["mission_file"])
    if mission_path.exists():
        content = mission_path.read_text(encoding="utf-8")
    else:
        content = "No mission file found yet."
    return JSONResponse({"content": content})


@app.post("/sync")
async def trigger_sync(background_tasks: BackgroundTasks) -> JSONResponse:
    """Trigger a Claude sync in the background."""
    config = load_config()
    config_path = CONFIG_PATH

    async def run_sync():
        proc = await asyncio.create_subprocess_exec(
            "python3", "/root/agents/claude_sync.py", "--config", config_path,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await proc.communicate()
        if proc.returncode != 0:
            log.error("claude_sync failed: %s", stderr.decode())
        else:
            log.info("claude_sync completed successfully")

    background_tasks.add_task(run_sync)
    return JSONResponse({"triggered": True, "message": "Claude sync started in background."})


@app.get("/", response_class=HTMLResponse)
async def dashboard() -> HTMLResponse:
    """Minimal inline HTML dashboard — no template engine required."""
    config = load_config()
    state = read_cycle_state(config["state_file"])

    rotation = config["rotation_order"]
    current_idx = state.get("cycle_index", 0) % len(rotation)
    current_agent = rotation[current_idx].replace("_", " ").title()
    hour_in_cycle = state.get("hour_in_cycle", 0)
    total_hours = len(rotation)
    last_run = state.get("last_run_iso") or "Never"
    last_sync = state.get("last_sync_iso") or "Never"
    sync_pending = state.get("sync_pending", False)

    mission_path = Path(config["mission_file"])
    mission_preview = ""
    if mission_path.exists():
        raw = mission_path.read_text(encoding="utf-8")
        # Show first 600 chars of objectives section
        obj_match = re.search(r"## Current Objectives\n(.*?)(?=\n##|\Z)", raw, re.DOTALL)
        if obj_match:
            mission_preview = obj_match.group(1).strip()[:600]
        else:
            mission_preview = raw[:600]

    recent_logs = get_log_files(config["logs_dir"], limit=5)
    log_rows = ""
    for entry in recent_logs:
        log_rows += (
            f'<tr>'
            f'<td>{entry["timestamp"][:19].replace("T", " ")}</td>'
            f'<td>{entry["agent"]}</td>'
            f'<td><a href="/logs" style="color:#7dd3fc">view</a></td>'
            f'</tr>\n'
        )

    sync_badge = (
        '<span style="color:#fbbf24">⚠ Sync Pending</span>'
        if sync_pending else
        '<span style="color:#4ade80">✓ Up to date</span>'
    )

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>E-Agent Control Panel</title>
  <style>
    * {{ box-sizing: border-box; margin: 0; padding: 0; }}
    body {{ background: #0f172a; color: #e2e8f0; font-family: monospace; padding: 1rem; }}
    h1 {{ color: #7dd3fc; margin-bottom: 1rem; font-size: 1.4rem; }}
    h2 {{ color: #94a3b8; font-size: 1rem; margin: 1rem 0 0.5rem; }}
    .card {{ background: #1e293b; border-radius: 8px; padding: 1rem; margin-bottom: 1rem; }}
    .grid {{ display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; }}
    .label {{ color: #64748b; font-size: 0.8rem; }}
    .value {{ color: #f1f5f9; font-size: 1rem; font-weight: bold; }}
    .progress {{ background: #334155; border-radius: 4px; height: 8px; margin-top: 0.5rem; }}
    .progress-bar {{ background: #7dd3fc; border-radius: 4px; height: 8px; }}
    pre {{ background: #0f172a; padding: 0.75rem; border-radius: 4px; overflow-x: auto;
           font-size: 0.75rem; white-space: pre-wrap; color: #a5f3fc; max-height: 200px;
           overflow-y: auto; }}
    table {{ width: 100%; border-collapse: collapse; font-size: 0.8rem; }}
    th {{ color: #64748b; text-align: left; padding: 0.25rem 0.5rem; border-bottom: 1px solid #334155; }}
    td {{ padding: 0.25rem 0.5rem; border-bottom: 1px solid #1e293b; }}
    button {{ background: #0ea5e9; color: white; border: none; padding: 0.5rem 1.2rem;
              border-radius: 6px; cursor: pointer; font-family: monospace; font-size: 0.9rem; }}
    button:active {{ background: #0284c7; }}
    .note {{ color: #64748b; font-size: 0.75rem; margin-top: 0.4rem; }}
  </style>
</head>
<body>
  <h1>E-Agent Control Panel</h1>

  <div class="card">
    <h2>Current Status {sync_badge}</h2>
    <div class="grid">
      <div><div class="label">Active Agent</div><div class="value">{current_agent}</div></div>
      <div><div class="label">Cycle Progress</div><div class="value">{hour_in_cycle}/{total_hours} hours</div></div>
      <div><div class="label">Last Run</div><div class="value" style="font-size:0.8rem">{last_run[:19] if last_run != "Never" else "Never"}</div></div>
      <div><div class="label">Last Claude Sync</div><div class="value" style="font-size:0.8rem">{last_sync[:19] if last_sync != "Never" else "Never"}</div></div>
    </div>
    <div class="progress" style="margin-top:0.75rem">
      <div class="progress-bar" style="width:{int(hour_in_cycle/total_hours*100)}%"></div>
    </div>
    <p class="note">Progress: {hour_in_cycle} of {total_hours} sub-agent hours complete this cycle</p>
  </div>

  <div class="card">
    <h2>Current Mission Objectives</h2>
    <pre>{mission_preview or "(no objectives yet)"}</pre>
  </div>

  <div class="card">
    <h2>Recent Agent Logs</h2>
    <table>
      <tr><th>Time (UTC)</th><th>Agent</th><th>Log</th></tr>
      {log_rows or '<tr><td colspan="3" style="color:#64748b">No logs yet</td></tr>'}
    </table>
  </div>

  <div class="card">
    <h2>Manual Claude Sync</h2>
    <button onclick="triggerSync()">Sync Now</button>
    <p class="note" id="sync-status">Compiles all logs and sends them to Claude for mission update.</p>
  </div>

  <script>
    async function triggerSync() {{
      document.getElementById('sync-status').textContent = 'Triggering sync...';
      try {{
        const r = await fetch('/sync', {{method:'POST'}});
        const d = await r.json();
        document.getElementById('sync-status').textContent = d.message;
      }} catch(e) {{
        document.getElementById('sync-status').textContent = 'Error: ' + e.message;
      }}
    }}
    // Auto-refresh every 60 seconds
    setTimeout(() => location.reload(), 60000);
  </script>
</body>
</html>"""

    return HTMLResponse(content=html)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn
    config = load_config()
    uvicorn.run(
        app,
        host=config.get("web_host", "0.0.0.0"),
        port=config.get("web_port", 8000),
        log_level="info",
    )
