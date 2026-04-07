#!/usr/bin/env python3
"""
scheduler.py — E-Agent hourly sub-agent daemon.

Runs one tick per invocation (--once) or loops hourly.
Each tick: loads next profile → reads mission → calls Ollama → saves log → updates state.
"""

import argparse
import json
import logging
import os
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [scheduler] %(levelname)s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger(__name__)

CONFIG_PATH = os.environ.get("EAGENT_CONFIG", "/root/agents/config.json")


# ---------------------------------------------------------------------------
# Config & state
# ---------------------------------------------------------------------------

def load_config(path: str = CONFIG_PATH) -> dict:
    with open(path) as f:
        return json.load(f)


def read_cycle_state(state_file: str) -> dict:
    """Return state dict, creating a fresh one if missing or corrupt."""
    try:
        with open(state_file) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {"cycle_index": 0, "hour_in_cycle": 0, "last_run_iso": None}


def write_cycle_state(state_file: str, state: dict) -> None:
    """Atomic write via a temp file to avoid corruption on kill."""
    tmp = state_file + ".tmp"
    with open(tmp, "w") as f:
        json.dump(state, f, indent=2)
    os.replace(tmp, state_file)


# ---------------------------------------------------------------------------
# Profile management
# ---------------------------------------------------------------------------

def get_current_profile(config: dict, cycle_index: int) -> tuple[str, str]:
    """Return (agent_name, system_prompt_text) for the current rotation slot."""
    rotation = config["rotation_order"]
    agent_name = rotation[cycle_index % len(rotation)]
    prompt_text = load_profile(config["profiles_dir"], agent_name)
    return agent_name, prompt_text


def load_profile(profiles_dir: str, agent_name: str) -> str:
    profile_path = Path(profiles_dir) / f"{agent_name}.md"
    return profile_path.read_text(encoding="utf-8")


# ---------------------------------------------------------------------------
# Mission
# ---------------------------------------------------------------------------

def read_mission(mission_file: str) -> str:
    try:
        return Path(mission_file).read_text(encoding="utf-8")
    except FileNotFoundError:
        return "No mission file found yet. Proceed with general productivity tasks."


# ---------------------------------------------------------------------------
# Ollama
# ---------------------------------------------------------------------------

def call_ollama(
    base_url: str,
    model: str,
    system_prompt: str,
    user_message: str,
    timeout: int = 180,
    retries: int = 3,
    retry_delay: int = 30,
) -> str:
    """POST to Ollama /api/chat. Retries on connection errors (handles Ollama restart)."""
    url = base_url.rstrip("/") + "/api/chat"
    payload = {
        "model": model,
        "stream": False,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message},
        ],
    }
    for attempt in range(1, retries + 1):
        try:
            with httpx.Client(timeout=timeout) as client:
                resp = client.post(url, json=payload)
                resp.raise_for_status()
                data = resp.json()
                return data["message"]["content"]
        except httpx.ConnectError as e:
            log.warning("Ollama connect error (attempt %d/%d): %s", attempt, retries, e)
            if attempt < retries:
                log.info("Retrying in %ds...", retry_delay)
                time.sleep(retry_delay)
            else:
                raise
        except httpx.HTTPStatusError as e:
            log.error("Ollama HTTP error: %s", e)
            raise


# ---------------------------------------------------------------------------
# Log management
# ---------------------------------------------------------------------------

def save_log(logs_dir: str, agent_name: str, content: str) -> str:
    """Write output to logs/YYYY-MM-DD_HH_<agent_name>.md. Returns filepath."""
    Path(logs_dir).mkdir(parents=True, exist_ok=True)
    now = datetime.now(timezone.utc)
    filename = f"{now.strftime('%Y-%m-%d_%H')}_{agent_name}.md"
    filepath = Path(logs_dir) / filename
    header = f"# {agent_name.replace('_', ' ').title()} Log\n**Generated**: {now.isoformat()}\n\n"
    filepath.write_text(header + content, encoding="utf-8")
    log.info("Log saved: %s", filepath)
    return str(filepath)


def prune_old_logs(logs_dir: str, keep_days: int = 7) -> None:
    """Delete log files older than keep_days to prevent unbounded growth."""
    logs_path = Path(logs_dir)
    if not logs_path.exists():
        return
    cutoff = time.time() - keep_days * 86400
    pruned = 0
    for f in logs_path.glob("*.md"):
        if f.stat().st_mtime < cutoff:
            f.unlink()
            pruned += 1
    if pruned:
        log.info("Pruned %d log file(s) older than %d days", pruned, keep_days)


# ---------------------------------------------------------------------------
# Main tick
# ---------------------------------------------------------------------------

def run_scheduler_tick(config: dict) -> None:
    state_file = config["state_file"]
    state = read_cycle_state(state_file)

    cycle_index = state.get("cycle_index", 0)
    hour_in_cycle = state.get("hour_in_cycle", 0)

    agent_name, system_prompt = get_current_profile(config, cycle_index)
    log.info("Tick — agent: %s | cycle slot: %d | hour_in_cycle: %d",
             agent_name, cycle_index, hour_in_cycle)

    mission = read_mission(config["mission_file"])

    user_message = (
        f"Current master mission context:\n\n{mission}\n\n"
        f"This is hour {hour_in_cycle + 1} of the current 5-hour agent cycle. "
        f"Produce your hourly report now."
    )

    log.info("Calling Ollama (model=%s)...", config["model"])
    output = call_ollama(
        base_url=config["ollama_url"],
        model=config["model"],
        system_prompt=system_prompt,
        user_message=user_message,
    )

    save_log(config["logs_dir"], agent_name, output)
    prune_old_logs(config["logs_dir"])

    # Advance state
    new_hour = hour_in_cycle + 1
    if new_hour >= len(config["rotation_order"]):
        # Completed the work block — reset for next cycle
        new_state = {
            "cycle_index": (cycle_index + len(config["rotation_order"])) % 1000,
            "hour_in_cycle": 0,
            "last_run_iso": datetime.now(timezone.utc).isoformat(),
            "sync_pending": True,  # signal orchestrator to run claude_sync
        }
        log.info("Work block complete — sync_pending set. Run claude_sync.py next.")
    else:
        new_state = {
            "cycle_index": cycle_index + 1,
            "hour_in_cycle": new_hour,
            "last_run_iso": datetime.now(timezone.utc).isoformat(),
            "sync_pending": False,
        }

    write_cycle_state(state_file, new_state)
    log.info("State updated: hour_in_cycle=%d, sync_pending=%s",
             new_state["hour_in_cycle"], new_state.get("sync_pending", False))


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="E-Agent scheduler daemon")
    parser.add_argument(
        "--once", action="store_true",
        help="Run a single tick and exit (for cron use)"
    )
    parser.add_argument(
        "--config", default=CONFIG_PATH,
        help="Path to config.json"
    )
    args = parser.parse_args()

    config = load_config(args.config)

    if args.once:
        run_scheduler_tick(config)
    else:
        log.info("Starting scheduler loop (hourly). Ctrl+C to stop.")
        while True:
            try:
                run_scheduler_tick(config)
            except Exception as e:
                log.error("Tick failed: %s", e, exc_info=True)
            log.info("Sleeping 1 hour...")
            time.sleep(3600)


if __name__ == "__main__":
    main()
