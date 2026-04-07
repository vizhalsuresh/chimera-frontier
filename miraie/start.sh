#!/bin/bash
# miraie/start.sh — Start Miraie scheduler daemon + web UI + Cloudflare Tunnel
#
# Usage: bash miraie/start.sh
#
# Starts:
#   1. miraie_scheduler.py --run  (daemon, fires MQTT commands on schedule)
#   2. web.py                     (web UI on port 8001)
#   3. cloudflared tunnel         (public HTTPS URL for phone access)
#
# Stop all: Ctrl+C

set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
PORT="${MIRAIE_PORT:-8001}"
LOG_DIR="$HERE/logs"
mkdir -p "$LOG_DIR"

cleanup() {
    echo ""
    echo "Stopping all processes..."
    kill "$DAEMON_PID" "$WEB_PID" "$TUNNEL_PID" 2>/dev/null || true
    wait 2>/dev/null || true
    echo "Done."
}
trap cleanup EXIT INT TERM

# Check session exists
if [ ! -f "$HERE/miraie_session.json" ]; then
    echo "ERROR: No session found."
    echo "Run first: python3 miraie/miraie_scheduler.py --setup --mobile YOUR_NUMBER --password YOUR_PASS"
    exit 1
fi

# ---- 1. Scheduler daemon ----
echo "Starting scheduler daemon..."
python3 "$HERE/miraie_scheduler.py" --run > "$LOG_DIR/daemon.log" 2>&1 &
DAEMON_PID=$!
echo "  Daemon PID: $DAEMON_PID"

# ---- 2. Web UI ----
echo "Starting web UI on port $PORT..."
MIRAIE_PORT=$PORT python3 "$HERE/web.py" > "$LOG_DIR/web.log" 2>&1 &
WEB_PID=$!
echo "  Web UI PID: $WEB_PID"
sleep 2

# ---- 3. Cloudflare Tunnel ----
if command -v cloudflared >/dev/null 2>&1; then
    echo "Starting Cloudflare Tunnel..."
    cloudflared tunnel --url "http://localhost:$PORT" \
        --logfile "$LOG_DIR/cloudflared.log" > /tmp/cf_output.txt 2>&1 &
    TUNNEL_PID=$!

    # Extract the public URL from cloudflared output
    echo "  Waiting for tunnel URL..."
    for i in $(seq 1 20); do
        URL=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$LOG_DIR/cloudflared.log" 2>/dev/null | head -1)
        if [ -n "$URL" ]; then break; fi
        sleep 1
    done

    echo ""
    echo "========================================="
    echo "  Miraie Scheduler is LIVE"
    echo "========================================="
    echo "  Local:  http://localhost:$PORT"
    if [ -n "${URL:-}" ]; then
        echo "  Public: $URL"
        echo ""
        echo "  Open this on your phone:"
        echo "  $URL"
    else
        echo "  Public URL not ready yet — check $LOG_DIR/cloudflared.log"
    fi
    echo "========================================="
    echo ""
    echo "Press Ctrl+C to stop everything."
else
    TUNNEL_PID=0
    echo ""
    echo "========================================="
    echo "  Miraie Scheduler started"
    echo "========================================="
    echo "  Local: http://localhost:$PORT"
    echo ""
    echo "  cloudflared not installed. Install it for public access:"
    echo "  curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared"
    echo "  chmod +x /usr/local/bin/cloudflared"
    echo "========================================="
    echo ""
    echo "Press Ctrl+C to stop."
fi

# Keep running until Ctrl+C
wait $DAEMON_PID
