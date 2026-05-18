import json
import logging
import ssl
import sys
import certifi
import paho.mqtt.client as mqtt
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(message)s")

HERE = Path(__file__).parent
SESSION_FILE = HERE / "miraie_session.json"

if not SESSION_FILE.exists():
    logging.error("No session found. Run --setup first.")
    sys.exit(1)

session = json.loads(SESSION_FILE.read_text())
home_id = session["home_id"]
token = session["token"]
device = session["devices"][0]

log = logging.getLogger(__name__)
log.info(f"Pinging {device['name']} ({device['id']})...")

client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
client.username_pw_set(username=home_id, password=token)
client.tls_set_context(ssl.create_default_context(cafile=certifi.where()))

def on_connect(c, u, f, rc, p):
    if rc == 0:
        c.subscribe(device["topic"])
        log.info("Listening for any MQTT traffic... (timeout in 15s)")

def on_message(c, u, msg):
    try:
        data = json.loads(msg.payload.decode(errors="replace"))
        log.info("\n--- RAW DEVICE PAYLOAD ---")
        log.info(json.dumps(data, indent=2))
        log.info("--------------------------\n")
        c.disconnect()
    except Exception as e:
        log.info(f"Raw message: {msg.payload.decode()}")

client.on_connect = on_connect
client.on_message = on_message

client.connect("mqtt.miraie.in", 8883, keepalive=30)

# Request status update (standard Miraie ping)
payload = json.dumps({"ki": 1, "cnt": "an", "sid": "1", "type": "status_request"})
client.publish(device["control_topic"], payload, qos=1)

client.loop_start()
import time
time.sleep(15)
client.loop_stop()
client.disconnect()
