#!/usr/bin/env bash
set -euo pipefail

# One-command Miraie launcher with safety checks.
# Usage:
#   MIRAIE_API_TOKEN='your-token' ./miraie/launch.sh
# Optional:
#   MIRAIE_PORT=8001 MIRAIE_API_TOKEN='your-token' ./miraie/launch.sh

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${MIRAIE_PORT:-8001}"
CUR_DIR="$(pwd)"

echo "[INFO] Current directory: ${CUR_DIR}"
echo "[INFO] Launcher directory: ${ROOT_DIR}"

if [[ -z "${MIRAIE_API_TOKEN:-}" ]]; then
  echo "[ERROR] MIRAIE_API_TOKEN is not set."
  echo "Set it and re-run with one of:"
  echo "  (from repo root)   MIRAIE_API_TOKEN='your-token' ./miraie/launch.sh"
  echo "  (from miraie dir)  MIRAIE_API_TOKEN='your-token' ./launch.sh"
  exit 1
fi

echo "[1/4] Running smoke test..."
python3 "${ROOT_DIR}/smoke_test.py"

echo "[2/4] Verifying Miraie session..."
if [[ ! -f "${ROOT_DIR}/miraie_session.json" ]]; then
  echo "[ERROR] Missing ${ROOT_DIR}/miraie_session.json"
  echo "Run setup first:"
  echo "  python3 ${ROOT_DIR}/miraie_scheduler.py --setup --mobile '<MOBILE>' --password '<PASSWORD>'"
  exit 1
fi

echo "[3/4] Syncing schedules into crontab..."
if python3 "${ROOT_DIR}/cron_manager.py" >/dev/null 2>&1; then
  echo "[OK] Cron schedules synced."
else
  echo "[WARN] Cron sync failed (likely permission/no crontab access in this environment)."
  echo "[WARN] Web UI will still start; recurring schedule execution may require manual cron setup."
fi

# If requested/default port is busy, probe the next few ports.
if command -v ss >/dev/null 2>&1 && ss -ltn | awk '{print $4}' | grep -qE "(^|:)${PORT}$"; then
  echo "[WARN] Port ${PORT} is already in use. Searching for a free port..."
  for p in $(seq $((PORT + 1)) $((PORT + 20))); do
    if ! ss -ltn | awk '{print $4}' | grep -qE "(^|:)${p}$"; then
      PORT="${p}"
      echo "[OK] Using fallback port ${PORT}."
      break
    fi
  done
fi

echo "[4/4] Starting Miraie dashboard on port ${PORT}..."
echo "Open: http://localhost:${PORT}"
exec env MIRAIE_PORT="${PORT}" python3 "${ROOT_DIR}/web.py"
