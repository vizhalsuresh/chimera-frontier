#!/usr/bin/env python3
"""
claude_sync.py — E-Agent Claude CLI mastermind sync.

Compiles the last N sub-agent log files into a summary, sends it to the
Claude Code CLI (`claude --print`), then rewrites master_mission.md with
the response. Run this after every 4-agent work block (hour 5 of each cycle).
"""

import json
import logging
import os
import re
import subprocess
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [claude_sync] %(levelname)s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger(__name__)

CONFIG_PATH = os.environ.get("EAGENT_CONFIG", "/root/agents/config.json")


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

def load_config(path: str = CONFIG_PATH) -> dict:
    with open(path) as f:
        return json.load(f)


# ---------------------------------------------------------------------------
# Log collection
# ---------------------------------------------------------------------------

def collect_recent_logs(logs_dir: str, count: int = 4) -> list[tuple[str, str]]:
    """Return [(filename, content)] for the `count` most recent .md log files."""
    logs_path = Path(logs_dir)
    if not logs_path.exists():
        log.warning("Logs directory does not exist: %s", logs_dir)
        return []

    files = sorted(
        logs_path.glob("*.md"),
        key=lambda f: f.stat().st_mtime,
        reverse=True,
    )[:count]

    result = []
    for f in reversed(files):  # chronological order
        content = f.read_text(encoding="utf-8")
        result.append((f.name, content))
    log.info("Collected %d log file(s) for sync", len(result))
    return result


def compile_summary(logs: list[tuple[str, str]]) -> str:
    """Combine log files into a single markdown document."""
    if not logs:
        return "No sub-agent logs available for this cycle."

    parts = ["# Sub-Agent Cycle Summary\n"]
    for filename, content in logs:
        parts.append(f"\n---\n## Log: {filename}\n\n{content}")
    return "\n".join(parts)


# ---------------------------------------------------------------------------
# Prompt construction
# ---------------------------------------------------------------------------

def build_claude_prompt(summary: str, mission: str) -> str:
    return f"""You are the Mastermind orchestrator for a personal AI agent system called E-Agent.

## Your Task
Review the sub-agent reports from the last work cycle and update the Master Mission file.

## Current Master Mission
{mission}

## Sub-Agent Reports from This Cycle
{summary}

## Instructions
Based on the sub-agent reports above:
1. Mark completed objectives as done
2. Add any new objectives or insights surfaced by the agents
3. Update the "Active Context" section with today's date and a 2-sentence summary
4. Prioritize the objective list (most important first)
5. Add any critical "Notes for Sub-Agents" for the next cycle

Return ONLY the updated master_mission.md content in this exact format:

# Master Mission

## Current Objectives
- [ ] or [x] for each objective

## Active Context
Last updated: [ISO datetime]
[2-sentence summary of current situation]

## Sub-Agent Instructions
[Instructions for next cycle based on what you learned]

## Completed Items
[List of completed objectives with completion date]

## Notes
This file is automatically rewritten by `claude_sync.py` every 5 hours.
Manual edits will be overwritten on next sync — use the `/sync` endpoint or `claude_sync.py` directly to update.
"""


# ---------------------------------------------------------------------------
# Claude CLI invocation
# ---------------------------------------------------------------------------

def call_claude_cli(prompt: str, timeout: int = 300) -> str:
    """
    Write prompt to a temp file and invoke `claude --print -p "$(cat ...)"`.
    Uses a temp file to avoid ARG_MAX shell limits on large prompts.
    Returns stdout as a string.
    """
    # Write prompt to temp file
    with tempfile.NamedTemporaryFile(
        mode="w",
        suffix=".txt",
        prefix="eagent_prompt_",
        delete=False,
        encoding="utf-8",
    ) as tmp:
        tmp.write(prompt)
        tmp_path = tmp.name

    log.info("Prompt written to temp file: %s (%d chars)", tmp_path, len(prompt))

    try:
        # Build shell command: read prompt from file, pass to claude
        cmd = f'claude --print -p "$(cat {tmp_path})"'
        log.info("Invoking Claude CLI...")
        result = subprocess.run(
            cmd,
            shell=True,
            capture_output=True,
            text=True,
            timeout=timeout,
        )

        if result.returncode != 0:
            log.error("Claude CLI exited %d\nstderr: %s", result.returncode, result.stderr)
            raise RuntimeError(
                f"claude CLI failed (exit {result.returncode}): {result.stderr[:500]}"
            )

        return result.stdout

    finally:
        try:
            os.unlink(tmp_path)
            log.debug("Temp file cleaned up: %s", tmp_path)
        except OSError:
            pass


# ---------------------------------------------------------------------------
# Response parsing
# ---------------------------------------------------------------------------

def parse_claude_response(raw: str) -> str:
    """Strip ANSI escape codes and extract the markdown content."""
    # Strip ANSI codes
    ansi_escape = re.compile(r"\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])")
    clean = ansi_escape.sub("", raw).strip()

    # If Claude wrapped it in a code fence, extract the inner content
    fence_match = re.search(r"```(?:markdown)?\n(.*?)```", clean, re.DOTALL)
    if fence_match:
        return fence_match.group(1).strip()

    # Otherwise return as-is (Claude usually returns raw markdown without fences)
    return clean


# ---------------------------------------------------------------------------
# Mission file update
# ---------------------------------------------------------------------------

def update_mission(mission_file: str, new_content: str) -> None:
    """
    Back up existing master_mission.md then overwrite with new_content.
    Backup is saved as master_mission.md.bak.<timestamp>.
    """
    mission_path = Path(mission_file)

    # Backup existing file
    if mission_path.exists():
        ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        backup_path = mission_path.with_suffix(f".md.bak.{ts}")
        backup_path.write_text(mission_path.read_text(encoding="utf-8"), encoding="utf-8")
        log.info("Backed up mission to: %s", backup_path)

    # Atomic write
    tmp_path = str(mission_path) + ".tmp"
    with open(tmp_path, "w", encoding="utf-8") as f:
        f.write(new_content)
    os.replace(tmp_path, mission_file)
    log.info("master_mission.md updated (%d chars)", len(new_content))


# ---------------------------------------------------------------------------
# State helpers
# ---------------------------------------------------------------------------

def clear_sync_pending(state_file: str) -> None:
    """Clear the sync_pending flag in cycle state after a successful sync."""
    try:
        with open(state_file) as f:
            state = json.load(f)
        state["sync_pending"] = False
        state["last_sync_iso"] = datetime.now(timezone.utc).isoformat()
        tmp = state_file + ".tmp"
        with open(tmp, "w") as f:
            json.dump(state, f, indent=2)
        os.replace(tmp, state_file)
        log.info("sync_pending cleared in cycle state")
    except (FileNotFoundError, json.JSONDecodeError) as e:
        log.warning("Could not update cycle state: %s", e)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description="E-Agent Claude CLI sync")
    parser.add_argument("--config", default=CONFIG_PATH, help="Path to config.json")
    parser.add_argument(
        "--logs-count", type=int, default=4,
        help="Number of recent log files to include in the sync (default: 4)"
    )
    args = parser.parse_args()

    config = load_config(args.config)

    log.info("Starting Claude sync...")

    # 1. Collect logs
    logs = collect_recent_logs(config["logs_dir"], count=args.logs_count)

    # 2. Build prompt
    summary = compile_summary(logs)
    mission = Path(config["mission_file"]).read_text(encoding="utf-8") \
        if Path(config["mission_file"]).exists() else "No mission file yet."
    prompt = build_claude_prompt(summary, mission)

    # 3. Call Claude CLI
    raw_response = call_claude_cli(prompt)

    # 4. Parse and write
    new_mission = parse_claude_response(raw_response)
    update_mission(config["mission_file"], new_mission)

    # 5. Clear sync flag
    clear_sync_pending(config["state_file"])

    log.info("Sync complete.")


if __name__ == "__main__":
    main()
