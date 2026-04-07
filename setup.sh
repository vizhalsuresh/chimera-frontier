#!/bin/bash
# setup.sh — E-Agent one-shot bootstrap for Android (Termux + proot-distro Ubuntu)
#
# Run from Termux:
#   chmod +x setup.sh && bash setup.sh
#
# This script is idempotent — safe to re-run if interrupted.

set -euo pipefail

EAGENT_VERSION="1.0.0"
PROOT_DISTRO="ubuntu"
AGENTS_DIR="/root/agents"
MODEL="gemma2:2b"

log() { echo "[setup] $(date '+%H:%M:%S') $*"; }
err() { echo "[setup] ERROR: $*" >&2; exit 1; }
check() { command -v "$1" >/dev/null 2>&1; }

# ---------------------------------------------------------------------------
# Phase 1: Termux layer
# ---------------------------------------------------------------------------
setup_termux() {
    log "=== Phase 1: Termux layer ==="

    log "Updating pkg..."
    pkg update -y -o Dpkg::Options::="--force-confdef" 2>/dev/null || true

    log "Installing proot-distro, curl, wget..."
    pkg install -y proot-distro curl wget 2>/dev/null || \
        err "Failed to install Termux packages. Make sure you are running in Termux."

    log "Termux layer ready."
}

# ---------------------------------------------------------------------------
# Phase 2: Install proot-distro Ubuntu (idempotent)
# ---------------------------------------------------------------------------
setup_proot_distro() {
    log "=== Phase 2: proot-distro Ubuntu ==="

    if proot-distro list | grep -q "^$PROOT_DISTRO"; then
        log "Ubuntu already installed in proot-distro, skipping."
    else
        log "Installing Ubuntu via proot-distro (this may take a while)..."
        proot-distro install "$PROOT_DISTRO"
    fi

    log "proot-distro Ubuntu ready."
}

# ---------------------------------------------------------------------------
# Phase 3: Inner Ubuntu setup (runs inside proot)
# ---------------------------------------------------------------------------

# Build the inner setup script as a heredoc, then pass it to proot-distro
build_inner_script() {
    cat <<'INNER_SCRIPT'
#!/bin/bash
set -euo pipefail

AGENTS_DIR="/root/agents"
MODEL="gemma2:2b"

log() { echo "[inner] $(date '+%H:%M:%S') $*"; }

log "=== Phase 3: Ubuntu inner setup ==="

# ---- System packages ----
log "apt update..."
apt-get update -qq

log "Installing system dependencies..."
apt-get install -y -qq \
    python3 python3-pip python3-venv \
    nodejs npm \
    curl wget git cron \
    2>/dev/null

log "System packages installed."

# ---- Python deps ----
log "Installing Python packages..."
pip3 install --quiet --break-system-packages \
    "fastapi>=0.111.0" \
    "uvicorn[standard]>=0.29.0" \
    "httpx>=0.27.0" \
    2>/dev/null || \
pip3 install --quiet \
    "fastapi>=0.111.0" \
    "uvicorn>=0.29.0" \
    "httpx>=0.27.0"

log "Python packages installed."

# ---- Ollama ----
if command -v ollama >/dev/null 2>&1; then
    log "Ollama already installed, skipping."
else
    log "Installing Ollama (ARM64 auto-detected by install script)..."
    curl -fsSL https://ollama.ai/install.sh | sh
fi

# Start Ollama in background (needed for model pull)
log "Starting Ollama server..."
OLLAMA_HOST=127.0.0.1 ollama serve > /tmp/ollama_setup.log 2>&1 &
OLLAMA_PID=$!
log "Ollama PID: $OLLAMA_PID"

# Wait for Ollama to be ready
log "Waiting for Ollama to be ready..."
for i in $(seq 1 30); do
    if curl -sf http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
        log "Ollama is ready."
        break
    fi
    sleep 2
    if [ $i -eq 30 ]; then
        log "WARNING: Ollama did not start in time. You may need to run 'ollama pull $MODEL' manually."
    fi
done

# Pull model (skip if already present)
if ollama list 2>/dev/null | grep -q "$MODEL"; then
    log "Model $MODEL already pulled, skipping."
else
    log "Pulling model $MODEL (this will download ~1.6GB — safe to interrupt and re-run)..."
    ollama pull "$MODEL" || log "WARNING: Model pull failed. Run 'ollama pull $MODEL' manually."
fi

# Stop temp Ollama instance
kill $OLLAMA_PID 2>/dev/null || true

# ---- Claude Code CLI ----
if command -v claude >/dev/null 2>&1; then
    log "Claude Code CLI already installed, skipping."
else
    log "Installing Claude Code CLI via npm..."
    npm install -g @anthropic-ai/claude-code 2>/dev/null || \
        log "WARNING: npm install failed. Try manually: npm install -g @anthropic-ai/claude-code"
fi

# ---- Directory scaffold ----
log "Creating E-Agent directory structure..."
mkdir -p "$AGENTS_DIR/profiles"
mkdir -p "$AGENTS_DIR/logs"

# ---- config.json ----
if [ ! -f "$AGENTS_DIR/config.json" ]; then
cat > "$AGENTS_DIR/config.json" <<'CONFIG'
{
  "ollama_url": "http://127.0.0.1:11434",
  "model": "gemma2:2b",
  "cycle_hours": 5,
  "rotation_order": ["email_sorter", "research_scout", "code_reviewer", "daily_scheduler"],
  "profiles_dir": "/root/agents/profiles",
  "logs_dir": "/root/agents/logs",
  "mission_file": "/root/agents/master_mission.md",
  "state_file": "/root/agents/.cycle_state.json",
  "web_host": "0.0.0.0",
  "web_port": 8000
}
CONFIG
    log "config.json created."
else
    log "config.json already exists, skipping."
fi

# ---- Copy Python scripts and profiles ----
# Repo layout: src/{scheduler,claude_sync,orchestrator} web/web_ui.py profiles/
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

for f in scheduler.py claude_sync.py; do
    if [ -f "$SCRIPT_DIR/src/$f" ]; then
        cp "$SCRIPT_DIR/src/$f" "$AGENTS_DIR/$f"
        log "Copied src/$f"
    else
        log "WARNING: src/$f not found — copy it manually to $AGENTS_DIR/"
    fi
done

if [ -f "$SCRIPT_DIR/web/web_ui.py" ]; then
    cp "$SCRIPT_DIR/web/web_ui.py" "$AGENTS_DIR/web_ui.py"
    log "Copied web/web_ui.py"
else
    log "WARNING: web/web_ui.py not found — copy it manually to $AGENTS_DIR/"
fi

for profile in email_sorter research_scout code_reviewer daily_scheduler; do
    src="$SCRIPT_DIR/profiles/$profile.md"
    dst="$AGENTS_DIR/profiles/$profile.md"
    if [ -f "$src" ]; then
        cp "$src" "$dst"
        log "Copied profiles/$profile.md"
    else
        log "WARNING: profiles/$profile.md not found — copy it manually."
    fi
done

# ---- master_mission.md ----
if [ ! -f "$AGENTS_DIR/master_mission.md" ]; then
cat > "$AGENTS_DIR/master_mission.md" <<'MISSION'
# Master Mission

## Current Objectives
- [ ] (To be populated by Claude after first sync cycle)

## Active Context
Last updated: NOT YET SYNCED

## Sub-Agent Instructions
Each sub-agent should read the objectives above and produce output that advances or monitors those goals.

## Completed Items
(none yet)

## Notes
This file is automatically rewritten by claude_sync.py every 5 hours.
MISSION
    log "master_mission.md created."
fi

# ---- orchestrator.sh ----
cat > "$AGENTS_DIR/orchestrator.sh" <<'ORCH'
#!/bin/bash
set -euo pipefail
AGENTS_DIR="/root/agents"
CONFIG="$AGENTS_DIR/config.json"
STATE="$AGENTS_DIR/.cycle_state.json"
LOG_DIR="$AGENTS_DIR/logs"
echo "=== $(date -u '+%Y-%m-%d %H:%M:%S UTC') === orchestrator tick ==="
mkdir -p "$LOG_DIR"
if [ -f "$STATE" ]; then
    SYNC_PENDING=$(python3 -c "
import json
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
    echo "--- Running Claude sync ---"
    python3 "$AGENTS_DIR/claude_sync.py" --config "$CONFIG"
else
    echo "--- Running scheduler tick ---"
    python3 "$AGENTS_DIR/scheduler.py" --once --config "$CONFIG"
fi
echo "=== done ==="
ORCH
chmod +x "$AGENTS_DIR/orchestrator.sh"
log "orchestrator.sh written."

# ---- crontab ----
CRON_LINE="0 * * * * $AGENTS_DIR/orchestrator.sh >> $AGENTS_DIR/logs/orchestrator.log 2>&1"
if crontab -l 2>/dev/null | grep -qF "orchestrator.sh"; then
    log "Cron entry already exists, skipping."
else
    (crontab -l 2>/dev/null; echo "$CRON_LINE") | crontab -
    log "Cron entry added: $CRON_LINE"
fi

# Start cron daemon
service cron start 2>/dev/null || crond 2>/dev/null || log "Note: start cron manually if needed."

log ""
log "======================================================"
log "  E-Agent setup complete!"
log "======================================================"
log ""
log "IMPORTANT: Before starting, authenticate Claude Code:"
log "  1. Run: proot-distro login ubuntu"
log "  2. Run: claude"
log "  3. Complete the login flow"
log "  4. Exit the interactive session (Ctrl+C)"
log ""
log "To start the system:"
log "  proot-distro login ubuntu -- bash -c '"
log "    ollama serve > /root/agents/logs/ollama.log 2>&1 &"
log "    python3 /root/agents/web_ui.py > /root/agents/logs/web_ui.log 2>&1 &"
log "    echo Done. Open http://localhost:8000 in your browser."
log "  '"
log ""
log "To test one scheduler tick:"
log "  proot-distro login ubuntu -- python3 /root/agents/scheduler.py --once"
log ""
INNER_SCRIPT
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
main() {
    log "E-Agent Bootstrap v$EAGENT_VERSION"
    log "Target: proot-distro $PROOT_DISTRO at $AGENTS_DIR"
    log ""

    # Verify we're in Termux
    if [ -z "${TERMUX_VERSION:-}" ] && [ ! -d "/data/data/com.termux" ]; then
        log "WARNING: Does not appear to be running in Termux."
        log "This script is designed for Android Termux. Continuing anyway..."
    fi

    setup_termux
    setup_proot_distro

    log "=== Phase 3: Running inner Ubuntu setup via proot-distro ==="
    INNER_SCRIPT=$(build_inner_script)

    # Pass this script dir and the inner script to proot
    SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

    proot-distro login "$PROOT_DISTRO" \
        --bind "$SCRIPT_DIR:/setup_src" \
        -- bash -c "
            export SETUP_SRC=/setup_src
            $(build_inner_script)
        "

    log ""
    log "Bootstrap complete. Follow the instructions above to start E-Agent."
}

main "$@"
