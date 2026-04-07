#!/usr/bin/env python3
"""
cron_manager.py — Converts miraie_schedules.json into system crontab entries.

Manages a clearly-marked MIRAIE_AC_BEGIN … MIRAIE_AC_END block inside the
user crontab. Existing cron entries outside that block are untouched.

Each generated job calls send_command.py with no embedded AC settings —
send_command.py reads ac_state.json at runtime, so jobs never go stale.

Standalone usage:
  python3 cron_manager.py              # sync schedules → crontab
  python3 cron_manager.py --dry-run   # preview without writing
  python3 cron_manager.py --clear     # remove all Miraie cron jobs
  python3 cron_manager.py --list      # show the installed Miraie block

Called automatically by web.py whenever schedules change.
"""

import argparse
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

# ── Paths ─────────────────────────────────────────────────────────────────────
HERE           = Path(__file__).resolve().parent
SCHEDULES_FILE = HERE / "miraie_schedules.json"
SEND_CMD       = HERE / "send_command.py"
LOG_FILE       = HERE / "logs" / "cron.log"
PYTHON         = sys.executable     # use the same Python (venv) that's running us

MARKER_BEGIN   = "# MIRAIE_AC_BEGIN"
MARKER_END     = "# MIRAIE_AC_END"

# Miraie day name → cron day number (0 = Sunday, 1 = Monday … 6 = Saturday)
_DAY_NUM = {"Mon": 1, "Tue": 2, "Wed": 3, "Thu": 4, "Fri": 5, "Sat": 6, "Sun": 0}
_ALL_DAYS = set(_DAY_NUM)


# ── Schedule helpers ──────────────────────────────────────────────────────────

def load_schedules() -> dict:
    if not SCHEDULES_FILE.exists():
        return {}
    return json.loads(SCHEDULES_FILE.read_text())


def _day_spec(days: list[str]) -> str:
    """Return the cron 'day-of-week' field for the given day list."""
    normalized = {d for d in days if d in _DAY_NUM}
    if not normalized:
        return "*"
    if normalized >= _ALL_DAYS:
        return "*"
    nums = sorted({_DAY_NUM[d] for d in normalized})
    return ",".join(map(str, nums))


def schedule_to_cron_line(sid: str, sched: dict) -> Optional[str]:
    """
    Convert one schedule entry to a crontab line.
    Returns None if the schedule is disabled.

    No AC params are embedded — send_command.py reads ac_state.json at
    runtime, so the cron line is always valid regardless of setting changes.
    """
    if not sched.get("enabled", True):
        return None

    time_str = sched["time"]              # "HH:MM"
    action   = sched["action"]            # "on" | "off"
    days     = sched.get("days", list(_ALL_DAYS))

    h, m     = map(int, time_str.split(":"))
    dow      = _day_spec(days)

    # Pad minute to 2 digits for readability
    return (
        f"{m:02d} {h:02d} * * {dow}"
        f"  {PYTHON} {SEND_CMD} {action}"
        f" >> {LOG_FILE} 2>&1"
        f"  # JOB:{sid}"
    )


def build_miraie_block() -> str:
    """Return the full MIRAIE_AC_BEGIN … END block for all enabled schedules."""
    schedules = load_schedules()
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    lines = [
        MARKER_BEGIN,
        f"# Miraie AC Control — auto-generated ({ts})",
        "# DO NOT EDIT manually — managed by the Miraie Dashboard",
    ]

    for sid, sched in sorted(schedules.items(), key=lambda x: x[1]["time"]):
        line = schedule_to_cron_line(sid, sched)
        if line:
            lines.append(line)

    lines.append(MARKER_END)
    return "\n".join(lines)


# ── Crontab read / write ──────────────────────────────────────────────────────

def read_crontab() -> str:
    """Return the current user crontab, or '' if none exists."""
    r = subprocess.run(["crontab", "-l"], capture_output=True, text=True)
    # exit 1 is normal when no crontab exists yet
    return r.stdout if r.returncode == 0 else ""


def write_crontab(content: str) -> None:
    r = subprocess.run(["crontab", "-"], input=content, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"crontab install failed: {r.stderr.strip()}")


def strip_miraie_block(crontab: str) -> str:
    """Remove the MIRAIE_AC_BEGIN … MIRAIE_AC_END section from crontab text."""
    out, inside = [], False
    for line in crontab.splitlines():
        s = line.strip()
        if s == MARKER_BEGIN:
            inside = True
            continue
        if s == MARKER_END:
            inside = False
            continue
        if not inside:
            out.append(line)

    # Trim trailing blank lines
    while out and not out[-1].strip():
        out.pop()
    return "\n".join(out)


def get_installed_miraie_block() -> str:
    """Extract and return just the MIRAIE_AC block from the live crontab."""
    lines, out, inside = read_crontab().splitlines(), [], False
    for line in lines:
        if line.strip() == MARKER_BEGIN:
            inside = True
        if inside:
            out.append(line)
        if line.strip() == MARKER_END:
            inside = False
    return "\n".join(out)


def count_installed_jobs() -> int:
    return sum(1 for l in get_installed_miraie_block().splitlines() if "JOB:" in l)


# ── Public API ────────────────────────────────────────────────────────────────

def sync(dry_run: bool = False) -> dict:
    """
    Rebuild and (unless dry_run) install the Miraie crontab block.

    Returns:
        {"ok": True, "jobs": <n>, "block": <str>, "dry_run": <bool>}
    """
    existing  = read_crontab()
    stripped  = strip_miraie_block(existing)
    new_block = build_miraie_block()

    # Re-assemble: keep user's other cron jobs, append Miraie block
    separator = "\n" if stripped.strip() else ""
    new_tab   = stripped + separator + "\n" + new_block + "\n"

    if not dry_run:
        write_crontab(new_tab)

    job_count = sum(1 for l in new_block.splitlines() if "JOB:" in l)
    return {"ok": True, "jobs": job_count, "block": new_block, "dry_run": dry_run}


def clear(dry_run: bool = False) -> dict:
    """Remove all Miraie cron jobs without touching the rest of the crontab."""
    existing = read_crontab()
    stripped = strip_miraie_block(existing)
    if not dry_run:
        write_crontab(stripped + "\n")
    return {"ok": True, "jobs": 0, "dry_run": dry_run}


# ── CLI ───────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--dry-run", action="store_true",
                        help="Preview without writing to crontab")
    parser.add_argument("--clear",   action="store_true",
                        help="Remove all Miraie cron jobs")
    parser.add_argument("--list",    action="store_true",
                        help="Show the currently installed Miraie cron block")
    args = parser.parse_args()

    if args.list:
        block = get_installed_miraie_block()
        print(block or "(no Miraie cron jobs currently installed)")
        return

    if args.clear:
        result = clear(dry_run=args.dry_run)
        label = " (dry run)" if args.dry_run else ""
        print(f"✓ Cleared Miraie cron jobs{label}")
        return

    # Default: sync
    result = sync(dry_run=args.dry_run)
    label  = " (dry run)" if args.dry_run else ""
    print(f"✓{label} Installed {result['jobs']} Miraie cron job(s)\n")
    print(result["block"])


if __name__ == "__main__":
    main()
