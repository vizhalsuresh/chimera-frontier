#!/usr/bin/env python3
"""
miraie/web.py — Miraie AC control web UI + REST API.

Serves the terminal-style dashboard at / and exposes a JSON API under /api/.
Legacy form-based routes (/add, /delete, /send) remain for backwards compat.

Start: python3 miraie/web.py
Expose: cloudflared tunnel --url http://localhost:8001
"""

import json
import logging
import os
import subprocess
import sys
import threading as _th
import secrets
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, Form, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse
from pydantic import BaseModel

log = logging.getLogger(__name__)

HERE           = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))   # make cron_manager / miraie_scheduler importable
SESSION_FILE   = HERE / "miraie_session.json"
SCHEDULES_FILE = HERE / "miraie_schedules.json"
AC_STATE_FILE  = HERE / "ac_state.json"
PROFILES_FILE  = HERE / "ac_profiles.json"
STATIC_DIR     = HERE / "static"
FRONTEND_DIST  = HERE.parent / "frontend" / "dist"

app = FastAPI(title="Miraie Control", docs_url=None, redoc_url=None)

# ---------------------------------------------------------------------------
# Cron manager — import lazily so a missing crontab binary doesn't break startup
# ---------------------------------------------------------------------------

try:
    import cron_manager as _cron
    _CRON_AVAILABLE = True
except Exception as _e:
    log.warning("cron_manager unavailable: %s", _e)
    _CRON_AVAILABLE = False


def _sync_crontab() -> dict:
    """Sync schedules → crontab. Returns result dict; never raises."""
    if not _CRON_AVAILABLE:
        return {"ok": False, "jobs": 0, "error": "cron_manager not available"}
    try:
        return _cron.sync()
    except Exception as exc:
        log.warning("Crontab sync failed: %s", exc)
        return {"ok": False, "jobs": 0, "error": str(exc)}

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------

_DEFAULT_STATE = {
    # Core
    "power":       False,
    "temp":        22,
    "mode":        "cool",    # cool | dry | fan | auto
    "fan":         "auto",    # auto | quiet | low | medium | high
    # Airflow
    "swing_v":     True,      # vertical swing (auto sweep)
    "swing_h":     False,     # horizontal swing
    "swing_angle": 3,         # 1–5 fixed position when swing_v=False
    # Advanced features
    "eco":         False,
    "powerful":    False,     # turbo/powerful mode
    "quiet":       False,     # sleep/quiet mode
    "nanoe":       False,     # air purification
    "iauto":       False,     # AI auto mode
    # Meta
    "last_action":  None,
    "last_updated": None,
}

_DEFAULT_PROFILES = [
    {"name": "SLEEP",    "temp": 24, "mode": "cool", "fan": "low",    "icon": "bed"},
    {"name": "WORK_HUB", "temp": 22, "mode": "cool", "fan": "medium", "icon": "work"},
    {"name": "ECO_MAX",  "temp": 26, "mode": "cool", "fan": "auto",   "icon": "savings"},
]

DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

API_TOKEN = os.environ.get("MIRAIE_API_TOKEN", "").strip()

# ---------------------------------------------------------------------------
# Helpers
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


def load_ac_state() -> dict:
    if not AC_STATE_FILE.exists():
        return _DEFAULT_STATE.copy()
    return {**_DEFAULT_STATE, **json.loads(AC_STATE_FILE.read_text())}


def save_ac_state(state: dict) -> None:
    AC_STATE_FILE.write_text(json.dumps(state, indent=2))


def load_profiles() -> list:
    if not PROFILES_FILE.exists():
        return _DEFAULT_PROFILES.copy()
    return json.loads(PROFILES_FILE.read_text())


def save_profiles(profiles: list) -> None:
    PROFILES_FILE.write_text(json.dumps(profiles, indent=2))


def send_command(
    action: str,
    temp: int = 22,
    mode: str = "cool",
    fan: str = "auto",
    swing_v: bool = True,
    swing_h: bool = False,
    swing_angle: int = 3,
    eco: bool = False,
    powerful: bool = False,
    quiet: bool = False,
    nanoe: bool = False,
) -> str:
    """Run miraie_scheduler.py --send in a subprocess. Returns combined stdout+stderr."""
    result = subprocess.run(
        [
            "python3", str(HERE / "miraie_scheduler.py"),
            "--send",        action,
            "--temp",        str(temp),
            "--mode",        mode,
            "--fan",         fan,
            "--swing-v",     "1" if swing_v     else "0",
            "--swing-h",     "1" if swing_h     else "0",
            "--swing-angle", str(swing_angle),
            "--eco",         "1" if eco         else "0",
            "--powerful",    "1" if powerful     else "0",
            "--quiet",       "1" if quiet        else "0",
            "--nanoe",       "1" if nanoe        else "0",
        ],
        capture_output=True,
        text=True,
        timeout=20,
    )
    return result.stdout + result.stderr


def _is_authorized(request: Request) -> bool:
    """
    Token auth for state-changing API routes.
    If MIRAIE_API_TOKEN is unset, auth is treated as disabled.
    """
    if not API_TOKEN:
        return True
    auth = request.headers.get("authorization", "")
    supplied = request.headers.get("x-api-token", "")
    if auth.lower().startswith("bearer "):
        supplied = auth.split(" ", 1)[1].strip()
    return bool(supplied) and secrets.compare_digest(supplied, API_TOKEN)


def _unauthorized() -> JSONResponse:
    return JSONResponse(
        {"ok": False, "error": "unauthorized"},
        status_code=401,
        headers={"WWW-Authenticate": "Bearer"},
    )


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class ControlRequest(BaseModel):
    power:        Optional[bool] = None
    temp:         Optional[int]  = None
    mode:         Optional[str]  = None
    fan:          Optional[str]  = None
    swing_v:      Optional[bool] = None
    swing_h:      Optional[bool] = None
    swing_angle:  Optional[int]  = None
    eco:          Optional[bool] = None
    powerful:     Optional[bool] = None
    quiet:        Optional[bool] = None
    nanoe:        Optional[bool] = None
    iauto:        Optional[bool] = None


class TimerRequest(BaseModel):
    timer_id: str   # "on" | "off" | "sleep"
    hours:    int   = 0
    minutes:  int   = 0


class ProfileRequest(BaseModel):
    name: str
    temp: int
    mode: str
    fan:  str
    icon: Optional[str] = "settings"


# ---------------------------------------------------------------------------
# ── Timer engine  (in-process threading.Timer — no daemon required)
# ---------------------------------------------------------------------------

# Active one-shot timers: "on" | "off"
_timers: dict[str, dict] = {}

# Sleep timer state (gradual temp increment every 30 min)
_sleep_state: dict = {"active": False, "timer": None, "steps": 0, "fires_at": None}


def _fire_one_shot(timer_id: str) -> None:
    """Called when a one-shot timer fires."""
    data   = _timers.pop(timer_id, None)
    action = timer_id  # "on" or "off"
    state  = load_ac_state()
    send_command(
        action,
        state["temp"], state["mode"], state["fan"],
        state.get("swing_v", True), state.get("swing_h", False),
        state.get("swing_angle", 3), state.get("eco", False),
        state.get("powerful", False), state.get("quiet", False),
        state.get("nanoe", False),
    )
    state["power"]        = action == "on"
    state["last_action"]  = f"TIMER_{timer_id.upper()}_FIRED"
    state["last_updated"] = datetime.now(timezone.utc).isoformat()
    save_ac_state(state)
    log.info("Timer '%s' fired → AC %s", timer_id, action.upper())


def _sleep_step() -> None:
    """Increment temp by 1°C and schedule the next step (or finish)."""
    if not _sleep_state["active"]:
        return
    state    = load_ac_state()
    if not state.get("power"):
        _sleep_state["active"] = False
        return
    new_temp = min(30, state["temp"] + 1)
    state["temp"] = new_temp
    save_ac_state(state)
    send_command("on", new_temp, state["mode"], state["fan"])
    _sleep_state["steps"] += 1
    log.info("Sleep timer step %d: temp → %d°C", _sleep_state["steps"], new_temp)

    if new_temp < 30:
        t = _th.Timer(1800, _sleep_step)   # next step in 30 min
        t.daemon = True
        t.start()
        _sleep_state["timer"] = t
    else:
        _sleep_state["active"] = False
        _sleep_state["timer"]  = None


# ---------------------------------------------------------------------------
# ── New dashboard (served from static/)
# ---------------------------------------------------------------------------

@app.get("/", response_class=HTMLResponse)
async def dashboard_new():
    index = STATIC_DIR / "index.html"
    if index.exists():
        return HTMLResponse(index.read_text())
    # Fallback: redirect to legacy
    return RedirectResponse("/legacy", status_code=302)


@app.get("/scheduler", response_class=HTMLResponse)
async def scheduler_page():
    page = STATIC_DIR / "scheduler.html"
    if page.exists():
        return HTMLResponse(page.read_text())
    return RedirectResponse("/", status_code=302)


@app.get("/logs", response_class=HTMLResponse)
async def logs_page():
    page = STATIC_DIR / "logs.html"
    if page.exists():
        return HTMLResponse(page.read_text())
    return JSONResponse({"ok": False, "error": "logs.html missing"}, status_code=404)


@app.get("/onefile", response_class=HTMLResponse)
async def onefile_page():
    page = STATIC_DIR / "onefile_app.html"
    if page.exists():
        return HTMLResponse(page.read_text())
    return JSONResponse({"ok": False, "error": "onefile_app.html missing"}, status_code=404)


@app.get("/app", response_class=HTMLResponse)
async def react_app_root():
    index = FRONTEND_DIST / "index.html"
    if index.exists():
        return HTMLResponse(index.read_text())
    return JSONResponse({"ok": False, "error": "React frontend not built yet"}, status_code=503)


@app.get("/app/{subpath:path}")
async def react_app_paths(subpath: str):
    if not FRONTEND_DIST.exists():
        return JSONResponse({"ok": False, "error": "React frontend not built yet"}, status_code=503)
    target = (FRONTEND_DIST / subpath).resolve()
    try:
        target.relative_to(FRONTEND_DIST.resolve())
    except ValueError:
        return JSONResponse({"ok": False, "error": "invalid path"}, status_code=400)
    if target.exists() and target.is_file():
        return FileResponse(target)
    index = FRONTEND_DIST / "index.html"
    if index.exists():
        return HTMLResponse(index.read_text())
    return JSONResponse({"ok": False, "error": "React frontend not built yet"}, status_code=503)


# ---------------------------------------------------------------------------
# ── REST API
# ---------------------------------------------------------------------------

@app.get("/api/state")
async def api_get_state():
    session  = load_session()
    state    = load_ac_state()
    return JSONResponse({
        **state,
        "online":         session is not None,
        "device":         session["devices"][0]["name"] if session else None,
        "schedule_count": len(load_schedules()),
    })


@app.post("/api/control")
async def api_control(req: ControlRequest, request: Request):
    if not _is_authorized(request):
        return _unauthorized()
    state = load_ac_state()

    # ── Core ───────────────────────────────────────────────────────────────
    if req.power is not None:
        state["power"] = req.power
    if req.temp is not None:
        state["temp"] = max(16, min(30, req.temp))
    if req.mode is not None and req.mode in ("auto", "cool", "dry", "fan"):
        state["mode"] = req.mode
    if req.fan is not None and req.fan in ("auto", "quiet", "low", "medium", "high"):
        state["fan"] = req.fan

    # ── Airflow ────────────────────────────────────────────────────────────
    if req.swing_v is not None:
        state["swing_v"] = req.swing_v
    if req.swing_h is not None:
        state["swing_h"] = req.swing_h
    if req.swing_angle is not None:
        state["swing_angle"] = max(1, min(5, req.swing_angle))

    # ── Advanced features (mutually exclusive: powerful ↔ eco) ─────────────
    if req.powerful is not None:
        state["powerful"] = req.powerful
        if req.powerful:
            state["eco"] = False
    if req.eco is not None:
        state["eco"] = req.eco
        if req.eco:
            state["powerful"] = False
    if req.quiet is not None:
        state["quiet"] = req.quiet
    if req.nanoe is not None:
        state["nanoe"] = req.nanoe
    if req.iauto is not None:
        state["iauto"] = req.iauto

    action = "on" if state["power"] else "off"
    result = send_command(
        action,
        state["temp"],         state["mode"],   state["fan"],
        state["swing_v"],      state["swing_h"], state["swing_angle"],
        state["eco"],          state["powerful"], state["quiet"],
        state["nanoe"],
    )
    log.info("API ctrl → %s T:%d M:%s F:%s eco=%s powerful=%s | %s",
             action.upper(), state["temp"], state["mode"], state["fan"],
             state["eco"], state["powerful"], result.strip()[:80])

    state["last_action"]  = (
        f"{action.upper()} T:{state['temp']} M:{state['mode']} "
        f"F:{state['fan']}"
    )
    state["last_updated"] = datetime.now(timezone.utc).isoformat()
    save_ac_state(state)
    return JSONResponse(state)


@app.get("/api/schedules")
async def api_get_schedules():
    return JSONResponse({"schedules": load_schedules()})


@app.post("/api/schedules")
async def api_add_schedule(req: Request):
    if not _is_authorized(req):
        return _unauthorized()
    data      = await req.json()
    time_str  = data.get("time", "00:00")
    action    = data.get("action", "on").lower()
    days      = data.get("days", DAY_NAMES)

    if action not in ("on", "off"):
        return JSONResponse({"ok": False, "error": "action must be 'on' or 'off'"}, status_code=400)
    if not isinstance(days, list) or any(d not in DAY_NAMES for d in days):
        return JSONResponse({"ok": False, "error": "days must be a list of Mon..Sun values"}, status_code=400)

    try:
        h, m = map(int, time_str.split(":"))
    except (TypeError, ValueError):
        return JSONResponse({"ok": False, "error": "time must be in HH:MM format"}, status_code=400)
    if not (0 <= h <= 23 and 0 <= m <= 59):
        return JSONResponse({"ok": False, "error": "time must be between 00:00 and 23:59"}, status_code=400)

    m     = (m // 5) * 5
    time_str = f"{h:02d}:{m:02d}"

    schedules = load_schedules()
    sid = schedule_id(time_str, action)
    schedules[sid] = {
        "time":    time_str,
        "action":  action,
        "days":    days,
        "enabled": True,
        "created": datetime.now(timezone.utc).isoformat(),
    }
    save_schedules(schedules)
    cron = _sync_crontab()
    log.info("Schedule added: %s  |  cron: %d job(s) installed", sid, cron.get("jobs", 0))
    return JSONResponse({
        "ok":          True,
        "sid":         sid,
        "schedule":    schedules[sid],
        "cron_synced": cron["ok"],
        "cron_jobs":   cron.get("jobs", 0),
    })


@app.delete("/api/schedules/{sid:path}")
async def api_delete_schedule(sid: str, request: Request):
    if not _is_authorized(request):
        return _unauthorized()
    schedules = load_schedules()
    schedules.pop(sid, None)
    save_schedules(schedules)
    cron = _sync_crontab()
    log.info("Schedule deleted: %s  |  cron: %d job(s) remaining", sid, cron.get("jobs", 0))
    return JSONResponse({
        "ok":          True,
        "cron_synced": cron["ok"],
        "cron_jobs":   cron.get("jobs", 0),
    })


@app.post("/api/schedules/sync")
async def api_sync_schedules(request: Request):
    """Re-install all schedules into crontab. Idempotent."""
    if not _is_authorized(request):
        return _unauthorized()
    cron = _sync_crontab()
    return JSONResponse(cron)


@app.get("/api/schedules/crontab")
async def api_crontab_preview():
    """Return the MIRAIE_AC block that would be (or is) installed."""
    if not _CRON_AVAILABLE:
        return JSONResponse({"ok": False, "block": "", "installed": ""})
    try:
        block     = _cron.build_miraie_block()
        installed = _cron.get_installed_miraie_block()
        jobs      = _cron.count_installed_jobs()
        return JSONResponse({"ok": True, "block": block, "installed": installed, "jobs": jobs})
    except Exception as exc:
        return JSONResponse({"ok": False, "error": str(exc)})


@app.get("/api/timer")
async def api_get_timers():
    """Return status of all active timers."""
    now = datetime.now(timezone.utc).timestamp()
    result: dict = {}
    for tid, data in _timers.items():
        result[tid] = {
            "active":      True,
            "fires_at":    datetime.fromtimestamp(data["fires_at"], timezone.utc).isoformat(),
            "remaining_s": max(0, int(data["fires_at"] - now)),
        }
    result["sleep"] = {
        "active": _sleep_state["active"],
        "steps":  _sleep_state["steps"],
    }
    return JSONResponse(result)


@app.post("/api/timer")
async def api_set_timer(req: TimerRequest, request: Request):
    """Set a one-shot or sleep timer."""
    if not _is_authorized(request):
        return _unauthorized()
    delay = req.hours * 3600 + req.minutes * 60
    if delay <= 0:
        return JSONResponse({"ok": False, "error": "delay must be > 0"}, status_code=400)

    tid = req.timer_id

    if tid == "sleep":
        # Cancel any running sleep timer
        if _sleep_state["timer"]:
            _sleep_state["timer"].cancel()
        _sleep_state["active"] = True
        _sleep_state["steps"]  = 0
        t = _th.Timer(delay, _sleep_step)
        t.daemon = True
        t.start()
        _sleep_state["timer"]    = t
        _sleep_state["fires_at"] = datetime.now(timezone.utc).timestamp() + delay
        fires_iso = datetime.fromtimestamp(_sleep_state["fires_at"], timezone.utc).isoformat()
        log.info("Sleep timer set: first step in %ds", delay)
        return JSONResponse({"ok": True, "timer_id": "sleep", "fires_at": fires_iso})

    if tid not in ("on", "off"):
        return JSONResponse({"ok": False, "error": "timer_id must be on, off or sleep"}, status_code=400)

    # Cancel existing same-type timer
    if tid in _timers:
        _timers[tid]["timer"].cancel()
        del _timers[tid]

    fires_at = datetime.now(timezone.utc).timestamp() + delay
    t = _th.Timer(delay, _fire_one_shot, args=[tid])
    t.daemon = True
    t.start()
    _timers[tid] = {"timer": t, "fires_at": fires_at}
    log.info("Timer '%s' set: fires in %ds", tid, delay)
    fires_iso = datetime.fromtimestamp(fires_at, timezone.utc).isoformat()
    return JSONResponse({"ok": True, "timer_id": tid, "fires_at": fires_iso, "delay_s": delay})


@app.delete("/api/timer/{timer_id}")
async def api_cancel_timer(timer_id: str, request: Request):
    """Cancel an active timer."""
    if not _is_authorized(request):
        return _unauthorized()
    if timer_id == "sleep":
        if _sleep_state["timer"]:
            _sleep_state["timer"].cancel()
        _sleep_state.update({"active": False, "timer": None, "steps": 0, "fires_at": None})
        return JSONResponse({"ok": True})
    data = _timers.pop(timer_id, None)
    if data:
        data["timer"].cancel()
    return JSONResponse({"ok": True})


@app.get("/api/profiles")
async def api_get_profiles():
    return JSONResponse({"profiles": load_profiles()})


@app.post("/api/profiles")
async def api_save_profile(req: ProfileRequest, request: Request):
    if not _is_authorized(request):
        return _unauthorized()
    profiles = load_profiles()
    for i, p in enumerate(profiles):
        if p["name"].upper() == req.name.upper():
            profiles[i] = req.model_dump()
            break
    else:
        profiles.append(req.model_dump())
    save_profiles(profiles)
    return JSONResponse({"ok": True, "profiles": profiles})


@app.delete("/api/profiles/{name}")
async def api_delete_profile(name: str, request: Request):
    if not _is_authorized(request):
        return _unauthorized()
    profiles = [p for p in load_profiles() if p["name"].upper() != name.upper()]
    save_profiles(profiles)
    return JSONResponse({"ok": True})


@app.get("/api/status")
async def api_status():
    """Health-check endpoint (JSON)."""
    session = load_session()
    return JSONResponse({
        "ok":             session is not None,
        "device":         session["devices"][0]["name"] if session else None,
        "schedule_count": len(load_schedules()),
        "time":           datetime.now(timezone.utc).isoformat(),
    })


_ALLOWED_LOGS = {"cron", "daemon", "web"}

@app.get("/api/logs")
async def api_logs(file: str = "cron", n: int = 200):
    """Return last N lines from a log file (cron | daemon | web)."""
    if file not in _ALLOWED_LOGS:
        return JSONResponse(
            {"ok": False, "error": f"unknown log file '{file}'; choose from {sorted(_ALLOWED_LOGS)}"},
            status_code=400,
        )
    log_path = HERE / "logs" / f"{file}.log"
    if not log_path.exists():
        return JSONResponse({"ok": True, "file": file, "lines": [], "exists": False})
    lines = log_path.read_text(errors="replace").splitlines()
    return JSONResponse({
        "ok":    True,
        "file":  file,
        "lines": lines[-max(1, min(n, 2000)):],
        "total": len(lines),
    })


# ---------------------------------------------------------------------------
# ── Legacy routes (form-based, kept for backwards compat)
# ---------------------------------------------------------------------------

def _legacy_page(title: str, body: str, back: str = "/") -> str:
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
  <title>{title} — Miraie</title>
  <style>
    *, *::before, *::after {{ box-sizing: border-box; margin: 0; padding: 0; }}
    body {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            background: #0f172a; color: #e2e8f0; min-height: 100vh; padding: 1rem; }}
    .top-bar {{ display: flex; align-items: center; gap: 0.75rem; margin-bottom: 1.25rem; }}
    .back {{ color: #7dd3fc; text-decoration: none; font-size: 1.2rem; }}
    h1 {{ font-size: 1.2rem; font-weight: 700; color: #f1f5f9; }}
    .card {{ background: #1e293b; border-radius: 12px; padding: 1rem; margin-bottom: 1rem; }}
    .card h2 {{ font-size: 0.85rem; color: #94a3b8; margin-bottom: 0.75rem;
                text-transform: uppercase; letter-spacing: 0.05em; }}
    .btn {{ display: inline-flex; align-items: center; justify-content: center;
            padding: 0.6rem 1.2rem; border-radius: 8px; border: none;
            font-size: 0.9rem; font-weight: 600; cursor: pointer;
            text-decoration: none; transition: opacity 0.15s; }}
    .btn:active {{ opacity: 0.7; }}
    .btn-on  {{ background: #22c55e; color: #fff; }}
    .btn-off {{ background: #ef4444; color: #fff; }}
    .btn-blue {{ background: #0ea5e9; color: #fff; }}
    .btn-ghost {{ background: #334155; color: #e2e8f0; }}
    .btn-danger {{ background: #7f1d1d; color: #fca5a5; }}
    .btn-full {{ width: 100%; margin-bottom: 0.5rem; }}
    .row {{ display: flex; align-items: center; justify-content: space-between;
            padding: 0.6rem 0; border-bottom: 1px solid #334155; }}
    .row:last-child {{ border-bottom: none; }}
    label {{ display: block; color: #94a3b8; font-size: 0.8rem;
             margin-bottom: 0.3rem; margin-top: 0.75rem; }}
    label:first-child {{ margin-top: 0; }}
    input[type=time], select {{
      width: 100%; padding: 0.6rem 0.75rem; border-radius: 8px;
      background: #0f172a; border: 1px solid #334155; color: #f1f5f9; font-size: 1rem; }}
    .day-grid {{ display: grid; grid-template-columns: repeat(7, 1fr); gap: 0.3rem; margin-top: 0.5rem; }}
    .day-grid input {{ display: none; }}
    .day-grid label {{ display: flex; align-items: center; justify-content: center;
      background: #334155; border-radius: 6px; padding: 0.4rem 0;
      font-size: 0.7rem; color: #94a3b8; cursor: pointer; margin: 0; }}
    .day-grid input:checked + label {{ background: #0ea5e9; color: #fff; }}
    .empty {{ color: #475569; text-align: center; padding: 1.5rem 0; font-size: 0.9rem; }}
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


@app.get("/legacy", response_class=HTMLResponse)
async def legacy_dashboard(request: Request):
    session   = load_session()
    schedules = load_schedules()
    device_name = session["devices"][0]["name"] if session else "Not configured"

    rows = ""
    for sid, s in sorted(schedules.items(), key=lambda x: x[1]["time"]):
        ac = "sched-action-on"  if s["action"] == "on" else "sched-action-off"
        al = "TURN ON"          if s["action"] == "on" else "TURN OFF"
        days = ", ".join(s["days"]) if len(s["days"]) < 7 else "Every day"
        rows += f"""
        <div class="row">
          <div>
            <div style="font-size:1.1rem;font-weight:700;color:#f1f5f9">{s['time']}
              <span style="color:{'#4ade80' if s['action']=='on' else '#f87171'};font-weight:600;font-size:0.85rem">{al}</span>
            </div>
            <div style="color:#64748b;font-size:0.75rem">{days}</div>
          </div>
          <form method="post" action="/delete">
            <input type="hidden" name="sid" value="{sid}">
            <button class="btn btn-danger" style="padding:0.4rem 0.8rem;font-size:0.8rem">Delete</button>
          </form>
        </div>"""

    if not rows:
        rows = '<p class="empty">No schedules yet.</p>'

    body = f"""
    <div class="card"><h2>Device</h2>
      <div style="display:flex;align-items:center;justify-content:space-between">
        <span style="font-weight:600;color:#f1f5f9">{device_name}</span>
        <span style="font-size:0.75rem;color:#64748b">{len(schedules)} schedule(s)</span>
      </div>
    </div>
    <div class="card"><h2>Quick Control</h2>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem">
        <form method="post" action="/send"><input type="hidden" name="action" value="on">
          <button class="btn btn-on btn-full">Turn ON</button></form>
        <form method="post" action="/send"><input type="hidden" name="action" value="off">
          <button class="btn btn-off btn-full">Turn OFF</button></form>
      </div>
    </div>
    <div class="card"><h2>Schedules</h2>
      {rows}
      <div style="margin-top:0.75rem">
        <a href="/add" class="btn btn-blue btn-full">+ Add Schedule</a>
      </div>
    </div>
    <p style="text-align:center;margin-top:1rem">
      <a href="/" style="color:#7dd3fc;font-size:0.85rem">← Back to new dashboard</a>
    </p>
    """
    return HTMLResponse(_legacy_page("Miraie Legacy", body, back=""))


@app.get("/add", response_class=HTMLResponse)
async def add_page():
    day_checkboxes = ""
    for day in DAY_NAMES:
        day_checkboxes += f"""
        <input type="checkbox" id="d_{day}" name="days" value="{day}" checked>
        <label for="d_{day}">{day}</label>"""
    body = f"""
    <form method="post" action="/add">
      <div class="card"><h2>New Schedule</h2>
        <label>Time (5-minute intervals)</label>
        <input type="time" name="time" step="300" required value="{datetime.now().strftime('%H:%M')}">
        <label>Action</label>
        <select name="action">
          <option value="on">Turn ON</option>
          <option value="off">Turn OFF</option>
        </select>
        <label>Repeat on days</label>
        <div class="day-grid">{day_checkboxes}</div>
      </div>
      <button type="submit" class="btn btn-blue btn-full">Save Schedule</button>
      <a href="/legacy" class="btn btn-ghost btn-full" style="margin-top:0.5rem;text-align:center">Cancel</a>
    </form>"""
    return HTMLResponse(_legacy_page("Add Schedule", body))


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
        "time":    time_str,
        "action":  action.lower(),
        "days":    selected_days,
        "enabled": True,
        "created": datetime.now(timezone.utc).isoformat(),
    }
    save_schedules(schedules)
    return RedirectResponse("/legacy?added=1", status_code=303)


@app.post("/delete")
async def delete_schedule(sid: str = Form(...)):
    schedules = load_schedules()
    schedules.pop(sid, None)
    save_schedules(schedules)
    return RedirectResponse("/legacy?deleted=1", status_code=303)


@app.post("/send")
async def send_immediate(action: str = Form(...)):
    state  = load_ac_state()
    result = send_command(action, state["temp"], state["mode"], state["fan"])
    log.info("Immediate %s: %s", action, result.strip())
    return RedirectResponse(f"/legacy?sent={action}", status_code=303)


# Keep the old /status alias pointing to api/status
@app.get("/status")
async def status_alias():
    session = load_session()
    return JSONResponse({
        "ok":             session is not None,
        "device":         session["devices"][0]["name"] if session else None,
        "schedule_count": len(load_schedules()),
        "time":           datetime.now(timezone.utc).isoformat(),
    })


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("MIRAIE_PORT", 8001))
    if not API_TOKEN:
        log.warning("MIRAIE_API_TOKEN is not set; write API endpoints are unauthenticated.")
    print(f"\n  Miraie Dashboard → http://localhost:{port}\n")
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="warning")
