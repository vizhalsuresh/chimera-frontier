#!/usr/bin/env python3
"""
smoke_test.py — Quick production-readiness smoke checks for Miraie.

This script runs fast, offline-safe checks:
1) Python compile check for all Miraie modules
2) Existing unit tests under miraie/test_*.py
3) FastAPI API sanity checks (no live Miraie account required)

Usage:
  python3 miraie/smoke_test.py
"""

from __future__ import annotations

import subprocess
import sys
import tempfile
from contextlib import contextmanager
from pathlib import Path


ROOT = Path(__file__).resolve().parent


def _run(cmd: list[str], label: str) -> None:
    print(f"[SMOKE] {label} ...")
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(result.stdout)
        print(result.stderr)
        raise RuntimeError(f"{label} failed (exit={result.returncode})")
    print(f"[OK] {label}")


@contextmanager
def _isolated_web_files():
    """
    Isolate web.py state files so smoke tests never mutate real user data.
    """
    import web

    with tempfile.TemporaryDirectory() as td:
        td_path = Path(td)
        old_paths = (
            web.SESSION_FILE,
            web.SCHEDULES_FILE,
            web.AC_STATE_FILE,
            web.PROFILES_FILE,
        )
        web.SESSION_FILE = td_path / "miraie_session.json"
        web.SCHEDULES_FILE = td_path / "miraie_schedules.json"
        web.AC_STATE_FILE = td_path / "ac_state.json"
        web.PROFILES_FILE = td_path / "ac_profiles.json"
        try:
            yield web
        finally:
            (
                web.SESSION_FILE,
                web.SCHEDULES_FILE,
                web.AC_STATE_FILE,
                web.PROFILES_FILE,
            ) = old_paths


def _api_smoke() -> None:
    print("[SMOKE] FastAPI endpoint sanity ...")
    import web
    from fastapi.testclient import TestClient

    old_token = web.API_TOKEN
    try:
        web.API_TOKEN = ""
        with _isolated_web_files() as web_mod:
            web_mod.send_command = lambda *args, **kwargs: "SMOKE_OK"
            web_mod._sync_crontab = lambda: {"ok": True, "jobs": 1}
            client = TestClient(web_mod.app)

            r = client.get("/api/status")
            assert r.status_code == 200, "status endpoint not healthy"
            payload = r.json()
            assert "ok" in payload and "time" in payload, "status payload missing keys"

            bad = client.post("/api/schedules", json={"time": "abc", "action": "on", "days": ["Mon"]})
            assert bad.status_code == 400, "invalid schedule payload should return 400"

            good = client.post("/api/schedules", json={"time": "08:31", "action": "on", "days": ["Mon", "Tue"]})
            assert good.status_code == 200, "valid schedule payload should succeed"
            body = good.json()
            assert body.get("ok") is True and body.get("sid") == "08:30_on", "schedule rounding mismatch"

            state = client.get("/api/state")
            assert state.status_code == 200, "state endpoint failed"

            control = client.post("/api/control", json={"power": True, "temp": 23, "mode": "cool", "fan": "auto"})
            assert control.status_code == 200, "control endpoint failed"
            control_body = control.json()
            assert control_body.get("power") is True and control_body.get("temp") == 23
    finally:
        web.API_TOKEN = old_token

    print("[OK] FastAPI endpoint sanity")


def _api_auth_smoke() -> None:
    print("[SMOKE] FastAPI auth guard sanity ...")
    import web
    from fastapi.testclient import TestClient

    old_token = web.API_TOKEN
    try:
        web.API_TOKEN = "smoke-token"
        with _isolated_web_files() as web_mod:
            web_mod.send_command = lambda *args, **kwargs: "SMOKE_OK"
            web_mod._sync_crontab = lambda: {"ok": True, "jobs": 1}
            client = TestClient(web_mod.app)

            unauth = client.post("/api/control", json={"power": True})
            assert unauth.status_code == 401, "write endpoint should require token"

            auth = client.post(
                "/api/control",
                json={"power": True},
                headers={"x-api-token": "smoke-token"},
            )
            assert auth.status_code == 200, "write endpoint should accept valid token"
    finally:
        web.API_TOKEN = old_token
    print("[OK] FastAPI auth guard sanity")


def main() -> int:
    try:
        _run([sys.executable, "-m", "compileall", str(ROOT)], "Compile Miraie modules")
        _run(
            [sys.executable, "-m", "unittest", "discover", "-s", str(ROOT), "-p", "test_*.py"],
            "Run unit tests",
        )
        _api_smoke()
        _api_auth_smoke()
        print("\n[PASS] Miraie smoke test suite passed.")
        return 0
    except Exception as exc:
        print(f"\n[FAIL] Smoke tests failed: {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
