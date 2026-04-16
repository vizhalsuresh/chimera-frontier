#!/usr/bin/env bash
set -euo pipefail

# Start React frontend (Vite dev server) + Miraie backend together.
# Usage:
#   MIRAIE_API_TOKEN='your-token' ./start_both.sh
#
# Optional:
#   FRONTEND_PORT=5173 MIRAIE_PORT=8001 MIRAIE_API_TOKEN='your-token' ./start_both.sh

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="${ROOT_DIR}/frontend"
BACKEND_DIR="${ROOT_DIR}/miraie"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"
BACKEND_PORT="${MIRAIE_PORT:-8001}"

if [[ -z "${MIRAIE_API_TOKEN:-}" ]]; then
  echo "[ERROR] MIRAIE_API_TOKEN is required."
  echo "Run: MIRAIE_API_TOKEN='your-token' ./start_both.sh"
  exit 1
fi

if [[ ! -d "${FRONTEND_DIR}" ]]; then
  echo "[ERROR] frontend folder not found at ${FRONTEND_DIR}"
  exit 1
fi

if [[ ! -f "${BACKEND_DIR}/web.py" ]]; then
  echo "[ERROR] backend file not found at ${BACKEND_DIR}/web.py"
  exit 1
fi

cleanup() {
  echo
  echo "[INFO] Stopping frontend + backend..."
  [[ -n "${FRONTEND_PID:-}" ]] && kill "${FRONTEND_PID}" >/dev/null 2>&1 || true
  [[ -n "${BACKEND_PID:-}" ]] && kill "${BACKEND_PID}" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

echo "[1/3] Starting backend on :${BACKEND_PORT} ..."
(
  cd "${BACKEND_DIR}"
  exec env MIRAIE_PORT="${BACKEND_PORT}" MIRAIE_API_TOKEN="${MIRAIE_API_TOKEN}" python3 web.py
) &
BACKEND_PID=$!

echo "[2/3] Starting frontend dev server on :${FRONTEND_PORT} ..."
(
  cd "${FRONTEND_DIR}"
  source "${HOME}/.nvm/nvm.sh"
  exec npm run dev -- --host 0.0.0.0 --port "${FRONTEND_PORT}"
) &
FRONTEND_PID=$!

echo "[3/3] Running both services."
echo "Frontend: http://localhost:${FRONTEND_PORT}"
echo "Backend : http://localhost:${BACKEND_PORT}"
echo "API     : http://localhost:${BACKEND_PORT}/api/status"
echo
echo "Press Ctrl+C to stop both."

wait "${FRONTEND_PID}" "${BACKEND_PID}"
