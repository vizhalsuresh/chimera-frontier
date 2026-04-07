#!/bin/bash
# miraie/start.sh — Start Miraie scheduler daemon + web UI + tunnel
#
# First time: read TUNNEL_SETUP.md to get a permanent URL.
# After setup: just run  bash miraie/start.sh
#
# Starts:
#   1. miraie_scheduler.py --run   (MQTT daemon)
#   2. web.py                      (web UI on port 8001)
#   3. Tailscale Funnel OR Cloudflare Tunnel (permanent public URL)

set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
PORT="${MIRAIE_PORT:-8001}"
LOG_DIR="$HERE/logs"
mkdir -p "$LOG_DIR"

DAEMON_PID=0; WEB_PID=0; TUNNEL_PID=0

cleanup() {
    echo ""
    echo "Stopping all processes..."
    [ "$DAEMON_PID" -ne 0 ] && kill "$DAEMON_PID" 2>/dev/null || true
    [ "$WEB_PID"    -ne 0 ] && kill "$WEB_PID"    2>/dev/null || true
    [ "$TUNNEL_PID" -ne 0 ] && kill "$TUNNEL_PID" 2>/dev/null || true
    wait 2>/dev/null || true
    echo "Done."
}
trap cleanup EXIT INT TERM

# ── Preflight ────────────────────────────────────────────────────────────────
if [ ! -f "$HERE/miraie_session.json" ]; then
    echo "ERROR: No session. Run first:"
    echo "  python3 miraie/miraie_scheduler.py --setup --mobile YOUR_NUMBER --password YOUR_PASS"
    exit 1
fi

# ── 1. Scheduler daemon ───────────────────────────────────────────────────────
echo "[1/3] Starting MQTT scheduler daemon..."
python3 "$HERE/miraie_scheduler.py" --run > "$LOG_DIR/daemon.log" 2>&1 &
DAEMON_PID=$!
echo "      PID $DAEMON_PID  |  log: $LOG_DIR/daemon.log"

# ── 2. Web UI ─────────────────────────────────────────────────────────────────
echo "[2/3] Starting web UI on port $PORT..."
MIRAIE_PORT=$PORT python3 "$HERE/web.py" > "$LOG_DIR/web.log" 2>&1 &
WEB_PID=$!
echo "      PID $WEB_PID  |  log: $LOG_DIR/web.log"
sleep 2

# ── 3. Tunnel ─────────────────────────────────────────────────────────────────
echo "[3/3] Starting tunnel..."

start_tailscale() {
    # Tailscale Funnel — permanent URL, free account required
    # Setup: see miraie/TUNNEL_SETUP.md
    tailscale funnel "$PORT" > "$LOG_DIR/tailscale.log" 2>&1 &
    TUNNEL_PID=$!
    sleep 3
    # Get the permanent URL from tailscale status
    URL=$(tailscale funnel status 2>/dev/null | grep -o 'https://[^ ]*' | head -1 || true)
    if [ -z "$URL" ]; then
        URL=$(tailscale status --json 2>/dev/null | python3 -c "
import json,sys
d=json.load(sys.stdin)
me=d.get('Self',{})
dns=me.get('DNSName','').rstrip('.')
print(f'https://{dns}') if dns else print('')
" 2>/dev/null || true)
    fi
    echo "$URL"
}

start_cloudflare_named() {
    # Cloudflare named tunnel — permanent URL, requires setup (see TUNNEL_SETUP.md)
    TUNNEL_NAME="${CLOUDFLARE_TUNNEL_NAME:-miraie-scheduler}"
    cloudflared tunnel run "$TUNNEL_NAME" > "$LOG_DIR/cloudflared.log" 2>&1 &
    TUNNEL_PID=$!
    sleep 4
    # Extract hostname from tunnel config
    URL=$(cloudflared tunnel info "$TUNNEL_NAME" 2>/dev/null | grep -o 'https://[^ ]*' | head -1 || true)
    echo "$URL"
}

start_cloudflare_quick() {
    # Cloudflare quick tunnel — temporary URL (changes on restart)
    cloudflared tunnel --url "http://localhost:$PORT" \
        --logfile "$LOG_DIR/cloudflared.log" > /dev/null 2>&1 &
    TUNNEL_PID=$!
    sleep 6
    URL=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' \
          "$LOG_DIR/cloudflared.log" 2>/dev/null | head -1 || true)
    echo "$URL"
}

# Auto-select best available tunnel
PUBLIC_URL=""

if command -v tailscale >/dev/null 2>&1 && tailscale status >/dev/null 2>&1; then
    echo "      Using Tailscale Funnel (permanent)..."
    PUBLIC_URL=$(start_tailscale)
elif command -v cloudflared >/dev/null 2>&1 && [ -n "${CLOUDFLARE_TUNNEL_NAME:-}" ]; then
    echo "      Using Cloudflare named tunnel (permanent)..."
    PUBLIC_URL=$(start_cloudflare_named)
elif command -v cloudflared >/dev/null 2>&1; then
    echo "      Using Cloudflare quick tunnel (temporary — see TUNNEL_SETUP.md for permanent)..."
    PUBLIC_URL=$(start_cloudflare_quick)
else
    echo "      No tunnel available. Install Tailscale (see miraie/TUNNEL_SETUP.md)."
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║        Miraie Scheduler is LIVE              ║"
echo "╠══════════════════════════════════════════════╣"
printf "║  Local:  http://localhost:%-19s║\n" "$PORT"
if [ -n "$PUBLIC_URL" ]; then
printf "║  Phone:  %-36s║\n" "$PUBLIC_URL"
else
echo "║  Phone:  (no tunnel — see TUNNEL_SETUP.md)   ║"
fi
echo "╚══════════════════════════════════════════════╝"
echo ""
echo "  Ctrl+C to stop everything."
echo ""

wait $DAEMON_PID
