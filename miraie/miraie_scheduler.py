#!/usr/bin/env python3
"""
miraie_scheduler.py — Miraie AC custom scheduler (5-minute granularity).

Bypasses the Miraie app's 1-hour minimum by publishing MQTT commands
directly to mqtt.miraie.in. Any interval is supported — even every minute.

Authentication: mobile number + password (same as the Miraie app).
Control:        MQTT over TLS to mqtt.miraie.in:8883.

USAGE:
  python3 miraie_scheduler.py --setup               # authenticate & save session
  python3 miraie_scheduler.py --list                # list active schedules
  python3 miraie_scheduler.py --add 08:30 on        # turn ON at 08:30 every day
  python3 miraie_scheduler.py --add 08:35 off       # turn OFF at 08:35 every day
  python3 miraie_scheduler.py --add 14:00 on --days Mon Wed Fri
  python3 miraie_scheduler.py --delete 08:30_on     # remove a schedule
  python3 miraie_scheduler.py --run                 # start the scheduler daemon

All schedules are stored locally in miraie_schedules.json.
The --run daemon must be running for schedules to fire.
"""

import argparse
import json
import logging
import os
import ssl
import time
import random
import threading
from datetime import datetime, timezone
from pathlib import Path

import certifi
import httpx
import paho.mqtt.client as mqtt

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [miraie] %(levelname)s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
HERE = Path(__file__).parent
SESSION_FILE = HERE / "miraie_session.json"
SCHEDULES_FILE = HERE / "miraie_schedules.json"

# ---------------------------------------------------------------------------
# Miraie API constants (from reverse-engineered source)
# ---------------------------------------------------------------------------
LOGIN_URL  = "https://auth.miraie.in/simplifi/v1/userManagement/login"
HOMES_URL  = "https://app.miraie.in/simplifi/v1/homeManagement/homes"
CLIENT_ID  = "PBcMcfG19njNCL8AOgvRzIC8AjQa"
MQTT_HOST  = "mqtt.miraie.in"
MQTT_PORT  = 8883

# ---------------------------------------------------------------------------
# Auth & session
# ---------------------------------------------------------------------------

def login(mobile: str, password: str) -> dict:
    resp = httpx.post(LOGIN_URL, json={
        "clientId": CLIENT_ID,
        "mobile": mobile,
        "password": password,
        "scope": f"an_{random.randint(100000000, 999999999)}",
    }, timeout=15)
    resp.raise_for_status()
    data = resp.json()
    return {
        "token": data["accessToken"],
        "refresh_token": data["refreshToken"],
        "user_id": data["userId"],
        "expires_in": data["expiresIn"],
    }


def get_devices(token: str) -> list[dict]:
    headers = {"Authorization": f"Bearer {token}"}
    homes = httpx.get(HOMES_URL, headers=headers, timeout=15).json()
    devices = []
    for space in homes[0].get("spaces", []):
        for d in space.get("devices", []):
            devices.append({
                "name": d["deviceName"],
                "id": d["deviceId"],
                "topic": d["topic"][0],
                "control_topic": d["topic"][0] + "/control",
            })
    return devices, homes[0]["homeId"]


def load_session() -> dict:
    if not SESSION_FILE.exists():
        raise FileNotFoundError(
            "No session found. Run: python3 miraie_scheduler.py --setup"
        )
    return json.loads(SESSION_FILE.read_text())


def save_session(data: dict) -> None:
    SESSION_FILE.write_text(json.dumps(data, indent=2))
    log.info("Session saved to %s", SESSION_FILE)


def setup(mobile: str, password: str) -> None:
    log.info("Authenticating as %s...", mobile)
    auth = login(mobile, password)
    devices, home_id = get_devices(auth["token"])
    session = {**auth, "home_id": home_id, "devices": devices}
    save_session(session)
    log.info("Logged in. Found %d device(s):", len(devices))
    for d in devices:
        log.info("  %s  (%s)", d["name"], d["id"])


# ---------------------------------------------------------------------------
# Schedule storage (local JSON file)
# ---------------------------------------------------------------------------

def load_schedules() -> dict:
    if not SCHEDULES_FILE.exists():
        return {}
    return json.loads(SCHEDULES_FILE.read_text())


def save_schedules(schedules: dict) -> None:
    SCHEDULES_FILE.write_text(json.dumps(schedules, indent=2))


def schedule_id(time_str: str, action: str) -> str:
    return f"{time_str}_{action}"


def add_schedule(time_str: str, action: str, days: list[str] | None = None) -> None:
    h, m = map(int, time_str.split(":"))
    if m % 5 != 0:
        m = (m // 5) * 5
        time_str = f"{h:02d}:{m:02d}"
        log.warning("Rounded to nearest 5 minutes: %s", time_str)

    all_days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    schedules = load_schedules()
    sid = schedule_id(time_str, action)
    schedules[sid] = {
        "time": time_str,
        "action": action.lower(),
        "days": days or all_days,
        "enabled": True,
        "created": datetime.now(timezone.utc).isoformat(),
    }
    save_schedules(schedules)
    log.info("Schedule added: %s → %s on %s", time_str, action.upper(),
             ", ".join(days or all_days))


def delete_schedule(sid: str) -> None:
    schedules = load_schedules()
    if sid not in schedules:
        log.error("Schedule '%s' not found.", sid)
        return
    del schedules[sid]
    save_schedules(schedules)
    log.info("Deleted: %s", sid)


def list_schedules() -> None:
    schedules = load_schedules()
    if not schedules:
        print("No schedules configured.")
        print("Add one: python3 miraie_scheduler.py --add HH:MM on|off")
        return
    print(f"\n{'ID':<20} {'Time':<8} {'Action':<6} {'Days':<35} {'Enabled'}")
    print("-" * 80)
    for sid, s in sorted(schedules.items()):
        days = ", ".join(s["days"])
        print(f"{sid:<20} {s['time']:<8} {s['action'].upper():<6} {days:<35} {s['enabled']}")
    print()


# ---------------------------------------------------------------------------
# MQTT control
# ---------------------------------------------------------------------------

def build_payload(action: str) -> str:
    return json.dumps({
        "ki": 1,
        "cnt": "an",
        "sid": "1",
        "ps": "on" if action == "on" else "off",
    })


class MiraieController:
    def __init__(self, session: dict):
        self.session = session
        self.client = None
        self._connected = threading.Event()

    def connect(self) -> None:
        home_id = self.session["home_id"]
        token   = self.session["token"]

        client = mqtt.Client(
            mqtt.CallbackAPIVersion.VERSION2,
            client_id=f"eagent-{random.randint(1000, 9999)}",
        )
        client.username_pw_set(username=home_id, password=token)
        ctx = ssl.create_default_context(cafile=certifi.where())
        client.tls_set_context(ctx)

        def on_connect(client, userdata, flags, reason_code, properties):
            if reason_code == 0:
                log.info("MQTT connected to %s:%d", MQTT_HOST, MQTT_PORT)
                self._connected.set()
            else:
                log.error("MQTT connect failed: %s", reason_code)

        def on_disconnect(client, userdata, flags, reason_code, properties):
            log.warning("MQTT disconnected (%s). Will reconnect...", reason_code)
            self._connected.clear()

        client.on_connect    = on_connect
        client.on_disconnect = on_disconnect
        client.connect(MQTT_HOST, MQTT_PORT, keepalive=60)
        client.loop_start()
        self.client = client

        if not self._connected.wait(timeout=15):
            raise ConnectionError("MQTT connection timed out")

    def send(self, action: str, device_index: int = 0) -> None:
        device = self.session["devices"][device_index]
        topic  = device["control_topic"]
        payload = build_payload(action)
        result = self.client.publish(topic, payload, qos=1)
        result.wait_for_publish(timeout=5)
        log.info("Sent %s → %s (topic: .../%s/control)",
                 action.upper(), device["name"], device["id"][-6:])

    def disconnect(self) -> None:
        if self.client:
            self.client.loop_stop()
            self.client.disconnect()


# ---------------------------------------------------------------------------
# Scheduler daemon
# ---------------------------------------------------------------------------

def should_fire(schedule: dict) -> bool:
    now = datetime.now()
    day_abbr = now.strftime("%a")  # Mon, Tue, ...
    time_str = now.strftime("%H:%M")
    return (
        schedule["enabled"]
        and time_str == schedule["time"]
        and day_abbr in schedule["days"]
    )


def run_daemon(device_index: int = 0) -> None:
    session = load_session()
    controller = MiraieController(session)
    controller.connect()

    fired_this_minute: set[str] = set()
    log.info("Scheduler daemon running. Checking every 30 seconds. Ctrl+C to stop.")
    log.info("Loaded %d schedule(s).", len(load_schedules()))

    try:
        while True:
            now_minute = datetime.now().strftime("%H:%M")
            schedules = load_schedules()  # reload each loop — picks up edits live

            for sid, s in schedules.items():
                fire_key = f"{now_minute}_{sid}"
                if should_fire(s) and fire_key not in fired_this_minute:
                    log.info("Firing schedule: %s → %s", sid, s["action"].upper())
                    try:
                        controller.send(s["action"], device_index)
                        fired_this_minute.add(fire_key)
                    except Exception as e:
                        log.error("Failed to send command: %s", e)

            # Clean fired set when minute changes
            if len(fired_this_minute) > 0:
                keys_to_remove = {k for k in fired_this_minute
                                  if not k.startswith(now_minute)}
                fired_this_minute -= keys_to_remove

            time.sleep(30)

    except KeyboardInterrupt:
        log.info("Daemon stopped.")
    finally:
        controller.disconnect()


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Miraie AC scheduler — any interval, bypasses app 1-hour minimum"
    )
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--setup",  action="store_true",
                       help="Authenticate and save session (run once)")
    group.add_argument("--list",   action="store_true",
                       help="List all schedules")
    group.add_argument("--add",    metavar="HH:MM",
                       help="Add a schedule at this time (any 5-min interval)")
    group.add_argument("--delete", metavar="ID",
                       help="Delete a schedule by ID (shown in --list)")
    group.add_argument("--run",    action="store_true",
                       help="Start the scheduler daemon")
    group.add_argument("--send",   choices=["on", "off"],
                       help="Send an immediate on/off command (no schedule)")

    parser.add_argument("action", nargs="?", choices=["on", "off"],
                        help="Action for --add")
    parser.add_argument("--days", nargs="+", metavar="DAY",
                        help="Days: Mon Tue Wed Thu Fri Sat Sun (default: all)")
    parser.add_argument("--mobile",   default=os.environ.get("MIRAIE_MOBILE", ""),
                        help="Mobile number (for --setup)")
    parser.add_argument("--password", default=os.environ.get("MIRAIE_PASSWORD", ""),
                        help="Password (for --setup)")
    parser.add_argument("--device",   type=int, default=0,
                        help="Device index if you have multiple ACs (default: 0)")

    args = parser.parse_args()

    if args.setup:
        if not args.mobile or not args.password:
            parser.error("--setup requires --mobile and --password")
        setup(args.mobile, args.password)

    elif args.list:
        list_schedules()

    elif args.add:
        if not args.action:
            parser.error("--add requires an action: on or off")
        add_schedule(args.add, args.action, args.days)

    elif args.delete:
        delete_schedule(args.delete)

    elif args.run:
        run_daemon(args.device)

    elif args.send:
        session = load_session()
        ctrl = MiraieController(session)
        ctrl.connect()
        ctrl.send(args.send, args.device)
        time.sleep(1)
        ctrl.disconnect()


if __name__ == "__main__":
    main()
