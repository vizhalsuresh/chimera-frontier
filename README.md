# E-Agent

Turn your old Android phone into a self-running personal AI agent box.

Local Gemma sub-agents run hourly on-device (via Ollama). Claude Code CLI acts as the Mastermind orchestrator every 5 hours, updating your mission file. A lightweight web dashboard runs at `http://localhost:8000`.

**No cloud dependency for sub-agents. Your data stays on your phone.**

---

## One-Line Install

Run this in **Termux** on your Android phone:

```bash
curl -fsSL https://raw.githubusercontent.com/vizhalsuresh/e-agent/main/setup.sh | bash
```

> Requires: Termux (from F-Droid), Android 10+, 6GB+ free storage

---

## What Gets Installed

| Component | Purpose |
|---|---|
| proot-distro Ubuntu | Linux environment inside Termux |
| Ollama + Gemma 2B | Local AI inference (~1.6GB model) |
| Claude Code CLI | Mastermind orchestrator (needs Claude Pro login) |
| FastAPI web UI | Dashboard at `http://localhost:8000` |

---

## Architecture

```
Every hour (Hours 1-4):
  scheduler.py → loads sub-agent profile → calls Ollama → saves log

Hour 5:
  claude_sync.py → compiles 4 logs → calls claude CLI → rewrites master_mission.md

Web UI:
  web_ui.py → FastAPI at :8000 → shows status, logs, mission, manual sync
```

### The 5-Hour Cycle

| Hour | Agent | Task |
|---|---|---|
| 1 | Email Sorter | Prioritize communications |
| 2 | Research Scout | Surface knowledge gaps |
| 3 | Code Reviewer | Analyze technical tasks |
| 4 | Daily Scheduler | Build 24hr task plan |
| 5 | Claude (Mastermind) | Verify, synthesize, update mission |

---

## File Structure

**Repository layout:**
```
e-agent/
├── README.md
├── setup.sh              ← one-shot bootstrap (run from Termux)
├── requirements.txt
├── config.json           ← edit model, schedule, ports
├── master_mission.md     ← Claude updates this every 5 hours
├── src/
│   ├── scheduler.py      ← hourly sub-agent daemon
│   ├── claude_sync.py    ← Claude CLI sync script
│   └── orchestrator.sh   ← cron entry point
├── web/
│   └── web_ui.py         ← FastAPI dashboard
└── profiles/
    ├── email_sorter.md
    ├── research_scout.md
    ├── code_reviewer.md
    └── daily_scheduler.md
```

**Deployed on phone** (setup.sh copies everything flat into `/root/agents/`):
```
/root/agents/
├── config.json, master_mission.md
├── scheduler.py, claude_sync.py, web_ui.py, orchestrator.sh
├── profiles/
└── logs/                 ← auto-pruned after 7 days (not in repo)
```

---

## After Install

**1. Authenticate Claude Code (one-time):**
```bash
proot-distro login ubuntu
claude   # follow login flow
```

**2. Start the system:**
```bash
proot-distro login ubuntu -- bash -c '
  ollama serve > /root/agents/logs/ollama.log 2>&1 &
  sleep 3
  python3 /root/agents/web_ui.py > /root/agents/logs/web_ui.log 2>&1 &
  echo "Open http://localhost:8000 in your browser"
'
```

**3. Test one scheduler tick:**
```bash
proot-distro login ubuntu -- python3 /root/agents/scheduler.py --once
```

**4. Open dashboard:**  
Navigate to `http://localhost:8000` in your phone browser.

---

## Configuration

Edit `/root/agents/config.json` to change:

| Key | Default | Description |
|---|---|---|
| `model` | `gemma2:2b` | Ollama model (try `gemma2:7b` if you have 8GB+ free RAM) |
| `rotation_order` | 4 agents | Order sub-agents run in |
| `web_port` | `8000` | Dashboard port |

---

## Custom Sub-Agent Profiles

Add a new `.md` file to `/root/agents/profiles/` and add its name (without `.md`) to `rotation_order` in `config.json`.

Profile format:
```markdown
# Agent Name

## Role
What this agent does.

## Responsibilities
- Bullet list

## Output Format
How to structure the response (used as system prompt).

## Constraints
What it should NOT do.
```

---

## Cron Schedule

The orchestrator runs every hour via cron inside proot Ubuntu:
```
0 * * * * /root/agents/orchestrator.sh >> /root/agents/logs/orchestrator.log 2>&1
```

For Termux:Boot auto-start, install the **Termux:Boot** app and add a startup script.

---

## Requirements

- Android 10+ (ARM64)
- Termux from [F-Droid](https://f-droid.org) (not Play Store)
- 6GB free storage (Ollama model + Ubuntu layer)
- Claude Pro account (for the 5-hour Mastermind sync)

---

## License

MIT

---

## Miraie Module (AC Automation)

The `miraie/` module is a standalone AC control stack with:

- FastAPI dashboard + REST API (`miraie/web.py`)
- MQTT command delivery (`miraie/miraie_scheduler.py`)
- Cron sync for recurring schedules (`miraie/cron_manager.py`)
- Cron-safe command runner (`miraie/send_command.py`)

### Miraie Quick Start

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python3 miraie/miraie_scheduler.py --setup --mobile "<MOBILE>" --password "<PASSWORD>"
python3 miraie/web.py
```

Open `http://localhost:8001`.

### Run Smoke Test

```bash
python3 miraie/smoke_test.py
```

This verifies:

- module compilation
- unit tests
- API sanity checks with isolated temporary data files

---

## Security Hardening Checklist

Use this before exposing the service over tunnels or internet-facing endpoints.

### Credentials and Secrets

- Never commit mobile/password/session files.
- Ensure these files remain local only:
  - `miraie/miraie_session.json`
  - `miraie/ac_state.json`
  - `miraie/miraie_schedules.json`
- Rotate Miraie password if a session file is ever leaked.

### API and Network Exposure

- Keep dashboard bound to trusted networks where possible.
- Prefer authenticated reverse-proxy access (Cloudflare Access / Tailscale ACLs).
- Do not expose unauthenticated control APIs directly to public internet.

### Host and Runtime

- Run inside a dedicated Python virtual environment.
- Keep dependencies updated (`pip install -U -r requirements.txt` in maintenance windows).
- Store logs with restricted permissions and rotate them periodically.

### Operational Safety

- Run `python3 miraie/smoke_test.py` before production deploys.
- Verify cron entries after schedule changes.
- Keep a rollback backup of `miraie/` config JSON files.

---

## GitHub Pages Documentation

If you want a public documentation site:

1. In GitHub repository settings, enable Pages with source set to `Deploy from a branch`.
2. Select branch `main` and folder `/docs`.
3. Commit `docs/index.md` from this repo (added for onboarding and security notes).

If the repo is private, GitHub Pages availability depends on your GitHub plan. For private/internal docs, keep the repository private and use a private wiki or internal docs portal.
