#!/usr/bin/env python3
"""
miraie_scheduler.py — Custom Miraie schedule sender.

Bypasses the Miraie app's 1-hour minimum by calling the Panasonic API
directly with 5-minute granularity.

USAGE:
  1. Complete capture_setup.md to get your auth token and device ID.
  2. Fill in the CONFIG section below (or set env vars).
  3. Run: python3 miraie_scheduler.py --list       (show current schedules)
          python3 miraie_scheduler.py --add "08:30" on
          python3 miraie_scheduler.py --add "08:35" off
          python3 miraie_scheduler.py --delete <schedule_id>
"""

import argparse
import json
import os
import sys
from datetime import datetime

import httpx

# ---------------------------------------------------------------------------
# CONFIG — fill these in after capturing the API traffic
# ---------------------------------------------------------------------------

CONFIG = {
    # Auth token from captured request headers (Bearer token or session cookie)
    "auth_token": os.environ.get("MIRAIE_TOKEN", "FILL_ME_IN"),

    # Device ID from captured request (your AC/appliance ID)
    "device_id": os.environ.get("MIRAIE_DEVICE_ID", "FILL_ME_IN"),

    # Base API URL — identify from captured traffic (e.g. "https://api.miraie.in")
    "api_base": os.environ.get("MIRAIE_API_BASE", "FILL_ME_IN"),

    # Home/account ID if required by the API
    "home_id": os.environ.get("MIRAIE_HOME_ID", ""),
}

# ---------------------------------------------------------------------------
# NOTE: The fields below are placeholders.
# After capturing a real schedule creation request from the Miraie app,
# update build_schedule_payload() to match the exact field names and structure.
# ---------------------------------------------------------------------------


def headers() -> dict:
    """Build request headers matching what the Miraie app sends."""
    return {
        "Authorization": f"Bearer {CONFIG['auth_token']}",
        "Content-Type": "application/json",
        "Accept": "application/json",
        # Add any other headers captured (User-Agent, X-App-Version, etc.)
    }


def build_schedule_payload(time_str: str, action: str, days: list[str] | None = None) -> dict:
    """
    Build the schedule creation payload.

    Args:
        time_str: "HH:MM" — supports any 5-minute interval (08:05, 14:35, etc.)
        action:   "on" or "off"
        days:     list of day names, e.g. ["Mon","Tue","Wed","Thu","Fri"]
                  defaults to all days if None

    TODO: Replace field names with actual ones from captured traffic.
          Common patterns seen in Panasonic/Miraie APIs:
          - "scheduleTime", "time", "triggerTime"
          - "command", "action", "powerState"
          - "deviceId", "applianceId"
          - "repeat", "days", "weekDays"
    """
    hour, minute = map(int, time_str.split(":"))
    if minute % 5 != 0:
        print(f"Warning: {time_str} is not a 5-minute interval. Rounding down.")
        minute = (minute // 5) * 5

    all_days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

    # PLACEHOLDER — update field names from captured request
    return {
        "deviceId": CONFIG["device_id"],
        "scheduleTime": f"{hour:02d}:{minute:02d}",
        "action": action.upper(),           # "ON" or "OFF" — verify from capture
        "days": days or all_days,
        "enabled": True,
        # Add any additional fields required by the real API
    }


# ---------------------------------------------------------------------------
# API calls — endpoints are placeholders until capture is complete
# ---------------------------------------------------------------------------

def list_schedules() -> list[dict]:
    """GET current schedules for the device."""
    # TODO: Update endpoint from captured traffic
    url = f"{CONFIG['api_base']}/v1/devices/{CONFIG['device_id']}/schedules"
    with httpx.Client(timeout=15) as client:
        resp = client.get(url, headers=headers())
        resp.raise_for_status()
        return resp.json()


def add_schedule(time_str: str, action: str, days: list[str] | None = None) -> dict:
    """POST a new schedule."""
    # TODO: Update endpoint from captured traffic
    url = f"{CONFIG['api_base']}/v1/devices/{CONFIG['device_id']}/schedules"
    payload = build_schedule_payload(time_str, action, days)
    print(f"Sending payload:\n{json.dumps(payload, indent=2)}")
    with httpx.Client(timeout=15) as client:
        resp = client.post(url, headers=headers(), json=payload)
        resp.raise_for_status()
        return resp.json()


def delete_schedule(schedule_id: str) -> None:
    """DELETE a schedule by ID."""
    # TODO: Update endpoint from captured traffic
    url = f"{CONFIG['api_base']}/v1/devices/{CONFIG['device_id']}/schedules/{schedule_id}"
    with httpx.Client(timeout=15) as client:
        resp = client.delete(url, headers=headers())
        resp.raise_for_status()
    print(f"Deleted schedule {schedule_id}")


# ---------------------------------------------------------------------------
# Config validation
# ---------------------------------------------------------------------------

def check_config() -> bool:
    missing = [k for k, v in CONFIG.items() if v == "FILL_ME_IN"]
    if missing:
        print("ERROR: CONFIG not filled in. Missing fields:", missing)
        print("\nEither set environment variables or edit CONFIG in this script:")
        print("  MIRAIE_TOKEN      — auth token from captured traffic")
        print("  MIRAIE_DEVICE_ID  — appliance/device ID")
        print("  MIRAIE_API_BASE   — base URL (e.g. https://api.miraie.in)")
        print("\nSee miraie/capture_setup.md for how to capture these.")
        return False
    return True


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Miraie custom scheduler — 5-minute granularity"
    )
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--list", action="store_true", help="List current schedules")
    group.add_argument("--add", metavar="HH:MM", help="Add a schedule at this time")
    group.add_argument("--delete", metavar="ID", help="Delete a schedule by ID")
    parser.add_argument(
        "action", nargs="?", choices=["on", "off"],
        help="Action for --add (on or off)"
    )
    parser.add_argument(
        "--days", nargs="+",
        metavar="DAY",
        help="Days to apply (Mon Tue Wed ...). Defaults to all days.",
    )

    args = parser.parse_args()

    if not check_config():
        sys.exit(1)

    if args.list:
        schedules = list_schedules()
        print(json.dumps(schedules, indent=2))

    elif args.add:
        if not args.action:
            parser.error("--add requires an action: on or off")
        result = add_schedule(args.add, args.action, args.days)
        print("Schedule added:")
        print(json.dumps(result, indent=2))

    elif args.delete:
        delete_schedule(args.delete)


if __name__ == "__main__":
    main()
