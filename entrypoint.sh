#!/usr/bin/env bash
# entrypoint.sh — starts web.py + cloudflared quick tunnel
# Runs inside Docker. Prints public URL to stdout when tunnel is ready.
set -euo pipefail

PORT="${MIRAIE_PORT:-8001}"
LOG_DIR="/app/miraie/logs"
mkdir -p "$LOG_DIR"

# ── Preflight: session must be present ───────────────────────────────────────
if [ ! -f "/app/miraie/miraie_session.json" ]; then
    echo ""
    echo "╔═══════════════════════════════════════════════════════════╗"
    echo "║  ERROR: miraie_session.json not found.                    ║"
    echo "║                                                           ║"
    echo "║  Mount it via docker-compose volume, OR run setup once:   ║"
    echo "║    docker compose run --rm miraie-ac python3              ║"
    echo "║      miraie/miraie_scheduler.py --setup                   ║"
    echo "║      --mobile <NUMBER> --password <PASS>                  ║"
    echo "╚═══════════════════════════════════════════════════════════╝"
    echo ""
    exit 1
fi

# ── 1. Start web.py in background ────────────────────────────────────────────
echo "[1/2] Starting Miraie web UI on port ${PORT}..."
MIRAIE_PORT="${PORT}" python3 /app/miraie/web.py \
    > >(tee -a "${LOG_DIR}/web.log") \
    2>&1 &
WEB_PID=$!
echo "      PID ${WEB_PID} | log: ${LOG_DIR}/web.log"
sleep 2

# Verify web server came up
if ! kill -0 "$WEB_PID" 2>/dev/null; then
    echo "[ERROR] web.py failed to start. Check logs/web.log"
    exit 1
fi

# ── 2. Start cloudflared quick tunnel ────────────────────────────────────────
echo "[2/2] Starting Cloudflare quick tunnel → http://localhost:${PORT}..."
cloudflared tunnel --url "http://localhost:${PORT}" \
    --logfile "${LOG_DIR}/cloudflared.log" \
    > /dev/null 2>&1 &
TUNNEL_PID=$!
echo "      PID ${TUNNEL_PID} | log: ${LOG_DIR}/cloudflared.log"

# Wait up to 20 s for the public URL to appear in the log
PUBLIC_URL=""
for i in $(seq 1 20); do
    sleep 1
    PUBLIC_URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' \
                 "${LOG_DIR}/cloudflared.log" 2>/dev/null | tail -1 || true)
    [ -n "$PUBLIC_URL" ] && break
done

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║           🌡  Miraie AC Control — LIVE                  ║"
echo "╠══════════════════════════════════════════════════════════╣"
printf  "║  Local (inside Docker):  http://localhost:%-15s║\n" "${PORT}"
if [ -n "$PUBLIC_URL" ]; then
printf  "║  Public URL:             %-34s║\n" "${PUBLIC_URL}"
else
echo   "║  Public URL:             (tunnel starting — check logs)  ║"
fi
echo "╠══════════════════════════════════════════════════════════╣"
echo "║  Logs: docker compose logs -f                            ║"
echo "║  Stop: docker compose down                               ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

# ── Cleanup on exit ───────────────────────────────────────────────────────────
cleanup() {
    echo "Shutting down..."
    kill "$WEB_PID"    2>/dev/null || true
    kill "$TUNNEL_PID" 2>/dev/null || true
    wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# Keep container alive — tail logs so `docker compose logs` works
wait "$WEB_PID"
