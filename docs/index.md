# E-Agent + Miraie Docs

This page is optimized for GitHub Pages onboarding.

## What This Project Includes

- `src/`: E-Agent hourly orchestration stack
- `web/`: original dashboard layer
- `miraie/`: Miraie AC automation and scheduling module

## Miraie in 60 Seconds

1. Create venv and install dependencies.
2. Run one-time Miraie setup to capture device session.
3. Start FastAPI dashboard.
4. Add schedules from UI or REST API.
5. Run smoke test before production use.

## Commands

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python3 miraie/miraie_scheduler.py --setup --mobile "<MOBILE>" --password "<PASSWORD>"
python3 miraie/web.py
python3 miraie/smoke_test.py
```

## Security Essentials

- Keep all session/state JSON files private.
- Do not expose unauthenticated control endpoints publicly.
- Use authenticated tunnel/access controls.
- Run smoke tests before deploy.

## Recommended Production Flow

1. Update dependencies in a maintenance window.
2. Run `python3 miraie/smoke_test.py`.
3. Apply schedule changes.
4. Verify cron sync and endpoint health.
5. Monitor logs and keep rollback configs ready.
