#!/bin/bash
# orchestrator.sh — E-Agent hourly cron wrapper
#
# Called every hour by cron:
#   0 * * * * /root/agents/orchestrator.sh >> /root/agents/logs/orchestrator.log 2>&1
#
# Logic:
#   - Read hour_in_cycle from .cycle_state.json
#   - If sync_pending == true  → run claude_sync.py
#   - Else                     → run scheduler.py --once

set -euo pipefail

AGENTS_DIR="/root/agents"
CONFIG="$AGENTS_DIR/config.json"
STATE="$AGENTS_DIR/.cycle_state.json"
LOG_DIR="$AGENTS_DIR/logs"

echo "=== $(date -u '+%Y-%m-%d %H:%M:%S UTC') === orchestrator tick ==="

# Ensure log dir exists
mkdir -p "$LOG_DIR"

# Read sync_pending from state file (default false if missing)
if [ -f "$STATE" ]; then
    SYNC_PENDING=$(python3 -c "
import json, sys
try:
    d = json.load(open('$STATE'))
    print('true' if d.get('sync_pending', False) else 'false')
except Exception:
    print('false')
")
else
    SYNC_PENDING="false"
fi

echo "sync_pending=$SYNC_PENDING"

if [ "$SYNC_PENDING" = "true" ]; then
    echo "--- Running Claude sync (hour 5) ---"
    python3 "$AGENTS_DIR/claude_sync.py" --config "$CONFIG"
    echo "--- Claude sync complete ---"
else
    echo "--- Running scheduler tick ---"
    python3 "$AGENTS_DIR/scheduler.py" --once --config "$CONFIG"
    echo "--- Scheduler tick complete ---"
fi

echo "=== done ==="
