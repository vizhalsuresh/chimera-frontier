#!/usr/bin/env python3
"""
miraie/sync_state.py — Background MQTT status listener.

Subscribes to the AC's telemetry topic and updates ac_state.json in real-time
whenever the AC state changes (physical remote, official app, cron commands).

Usage:
  Imported by web.py → runs as daemon background thread automatically.
  Also directly runnable for a one-shot sync:
    python3 miraie/sync_state.py
"""

import json
import logging
import ssl
import threading
import time
import random
from datetime import datetime, timezone
from pathlib import Path

import certifi
import paho.mqtt.client as mqtt

log = logging.getLogger(__name__)

HERE          = Path(__file__).parent
SESSION_FILE  = HERE / "miraie_session.json"
AC_STATE_FILE = HERE / "ac_state.json"

MQTT_HOST = "mqtt.miraie.in"
MQTT_PORT = 8883

# ── Mapping numeric codes → human strings (mirrors miraie_scheduler.py) ──────
_MODE_MAP_REV = {0: "auto", 1: "cool", 2: "heat", 3: "dry", 4: "fan"}
_FAN_MAP_REV  = {0: "auto", 1: "low",  2: "medium", 3: "high"}


def _load_session() -> dict | None:
    if not SESSION_FILE.exists():
        return None
    try:
        return json.loads(SESSION_FILE.read_text())
    except Exception:
        return None


def _load_state() -> dict:
    if not AC_STATE_FILE.exists():
        return {}
    try:
        return json.loads(AC_STATE_FILE.read_text())
    except Exception:
        return {}


def _save_state(state: dict) -> None:
    AC_STATE_FILE.write_text(json.dumps(state, indent=2))


def _parse_status(payload_str: str) -> dict | None:
    """
    Parse a MirAIe status packet into our internal state dict.
    Handles both the 'control' echo and the 'status' telemetry format.
    """
    try:
        data = json.loads(payload_str)
    except Exception:
        return None

    # Miraie packets: ps=on/off, tm=temp(int), md=mode(int), fs=fan(int)
    # sv=swing-v(str), sh=swing-h(str), ec=eco, tt=turbo, qt=quiet, na=nanoe
    state: dict = {}

    if "ps" in data:
        state["power"] = data["ps"] == "on"
    if "tm" in data:
        try:
            state["temp"] = int(data["tm"])
        except (TypeError, ValueError):
            pass
    if "md" in data:
        state["mode"] = _MODE_MAP_REV.get(int(data["md"]), "cool")
    if "fs" in data:
        state["fan"] = _FAN_MAP_REV.get(int(data["fs"]), "auto")
    if "sv" in data:
        state["swing_v"] = data["sv"] == "auto"
    if "ec" in data:
        state["eco"] = data["ec"] == "on"
    if "tt" in data:
        state["powerful"] = data["tt"] == "on"
    if "na" in data:
        state["nanoe"] = data["na"] == "on"

    return state if state else None


class StatusListener:
    """
    Persistent MQTT listener that keeps ac_state.json up-to-date.
    Runs as a daemon thread — started by web.py on startup.

    Subscribes to both the base device topic (telemetry) and the
    control-echo topic so it picks up changes from any source:
      - Physical remote
      - Official MirAIe app
      - Our own control commands (confirmation echo)
    """

    def __init__(self):
        self._stop_event  = threading.Event()
        self._thread: threading.Thread | None = None
        self._client: mqtt.Client | None      = None
        self._connected   = threading.Event()

    # ── Public API ────────────────────────────────────────────────────────────

    def start(self) -> None:
        """Start the background listener thread."""
        if self._thread and self._thread.is_alive():
            return
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._run, daemon=True, name="miraie-sync")
        self._thread.start()
        log.info("[StatusListener] Background sync thread started.")

    def stop(self) -> None:
        """Gracefully stop the listener."""
        self._stop_event.set()
        if self._client:
            try:
                self._client.loop_stop()
                self._client.disconnect()
            except Exception:
                pass
        if self._thread:
            self._thread.join(timeout=5)
        log.info("[StatusListener] Stopped.")

    # ── Internal ──────────────────────────────────────────────────────────────

    def _run(self) -> None:
        """Main loop with automatic reconnect on failure."""
        retry_delay = 5  # start at 5 s, back off up to 120 s
        while not self._stop_event.is_set():
            try:
                self._connect_and_listen()
            except Exception as exc:
                log.warning("[StatusListener] Connection lost: %s — retrying in %ds", exc, retry_delay)
            finally:
                self._connected.clear()

            if self._stop_event.wait(timeout=retry_delay):
                break
            retry_delay = min(retry_delay * 2, 120)

    def _connect_and_listen(self) -> None:
        session = _load_session()
        if not session:
            log.error("[StatusListener] No session file — cannot sync. Will retry.")
            raise RuntimeError("missing session")

        home_id = session["home_id"]
        token   = session["token"]
        device  = session["devices"][0]

        # Subscribe to both telemetry topic AND control echo
        topics = [
            (device["topic"], 0),                    # telemetry / status updates
            (device["control_topic"], 0),             # echo of sent commands
        ]
        log.info("[StatusListener] Subscribing to telemetry for %s", device["name"])

        client = mqtt.Client(
            mqtt.CallbackAPIVersion.VERSION2,
            client_id=f"eagent-sync-{random.randint(1000, 9999)}",
        )
        client.username_pw_set(username=home_id, password=token)
        ctx = ssl.create_default_context(cafile=certifi.where())
        client.tls_set_context(ctx)
        self._client = client

        def on_connect(client, userdata, flags, reason_code, properties):
            if reason_code == 0:
                log.info("[StatusListener] MQTT connected → subscribing to %d topic(s)", len(topics))
                client.subscribe(topics)
                self._connected.set()
            else:
                log.error("[StatusListener] MQTT connect failed: %s", reason_code)

        def on_disconnect(client, userdata, flags, reason_code, properties):
            log.warning("[StatusListener] MQTT disconnected (%s)", reason_code)
            self._connected.clear()

        def on_message(client, userdata, msg):
            payload = msg.payload.decode(errors="replace")
            log.debug("[StatusListener] Message on %s: %s", msg.topic, payload[:120])
            new_state = _parse_status(payload)
            if not new_state:
                return

            # Merge into saved state (preserve fields we don't get from AC)
            current = _load_state()
            current.update(new_state)
            current["last_synced"] = datetime.now(timezone.utc).isoformat()
            _save_state(current)

            changed = ", ".join(
                f"{k}={v}" for k, v in new_state.items()
                if k not in ("last_synced",)
            )
            log.info("[StatusListener] AC state updated: %s", changed)

        client.on_connect    = on_connect
        client.on_disconnect = on_disconnect
        client.on_message    = on_message

        client.connect(MQTT_HOST, MQTT_PORT, keepalive=60)
        client.loop_start()

        if not self._connected.wait(timeout=15):
            client.loop_stop()
            raise ConnectionError("MQTT connection timed out")

        # Stay alive until stop requested or disconnect
        while not self._stop_event.is_set() and self._connected.is_set():
            time.sleep(1)

        client.loop_stop()


# Singleton used by web.py
_listener = StatusListener()


def start_listener() -> None:
    """Called by web.py on startup."""
    _listener.start()


def stop_listener() -> None:
    """Called by web.py on shutdown."""
    _listener.stop()


# ── One-shot manual sync ──────────────────────────────────────────────────────

def one_shot_sync(timeout: int = 10) -> bool:
    """
    Block until one status packet is received or timeout.
    Returns True on success. Used as standalone script.
    """
    session = _load_session()
    if not session:
        print("ERROR: No miraie_session.json. Run --setup first.")
        return False

    received = threading.Event()

    home_id = session["home_id"]
    token   = session["token"]
    device  = session["devices"][0]

    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
    client.username_pw_set(username=home_id, password=token)
    ctx = ssl.create_default_context(cafile=certifi.where())
    client.tls_set_context(ctx)

    def on_connect(c, _u, _f, rc, _p):
        if rc == 0:
            c.subscribe(device["topic"])

    def on_message(c, _u, msg):
        state = _parse_status(msg.payload.decode(errors="replace"))
        if state:
            current = _load_state()
            current.update(state)
            current["last_synced"] = datetime.now(timezone.utc).isoformat()
            _save_state(current)
            print(f"Synced: {state}")
            received.set()

    client.on_connect  = on_connect
    client.on_message  = on_message
    client.connect(MQTT_HOST, MQTT_PORT, keepalive=30)
    client.loop_start()
    ok = received.wait(timeout=timeout)
    client.loop_stop()
    client.disconnect()
    if not ok:
        print(f"Timeout: no status received in {timeout}s")
    return ok


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s %(levelname)s %(message)s")
    import sys
    ok = one_shot_sync(timeout=int(sys.argv[1]) if len(sys.argv) > 1 else 10)
    sys.exit(0 if ok else 1)
