#!/usr/bin/env python3
"""
capture_session.py — Miraie API traffic capture tool.

Opens a visible Chromium browser. You log in to the Miraie web app,
navigate to the scheduler, create/edit a schedule — this script records
every API request and response automatically.

Output saved to: miraie/captured_requests.json
"""

import json
import sys
from datetime import datetime
from pathlib import Path

from playwright.sync_api import sync_playwright, Request, Response

MIRAIE_URL = "https://miraie-in.iothings.site/"
OUTPUT_FILE = Path(__file__).parent / "captured_requests.json"

# Keywords to flag as likely schedule-related
SCHEDULE_KEYWORDS = ["schedule", "timer", "command", "device", "appliance",
                     "control", "power", "ac", "aircon"]

captured: list[dict] = []


def is_api_request(url: str) -> bool:
    return any(k in url.lower() for k in [
        "api", "v1", "v2", "graphql", "rest", "service",
        "panasonic", "miraie", "iothings"
    ])


def on_request(request: Request) -> None:
    if not is_api_request(request.url):
        return
    entry = {
        "timestamp": datetime.now().isoformat(),
        "type": "request",
        "method": request.method,
        "url": request.url,
        "headers": dict(request.headers),
        "post_data": request.post_data,
        "is_schedule_related": any(k in request.url.lower() for k in SCHEDULE_KEYWORDS),
    }
    captured.append(entry)
    flag = " *** SCHEDULE ***" if entry["is_schedule_related"] else ""
    print(f"  [{request.method}] {request.url[:90]}{flag}")


def on_response(response: Response) -> None:
    if not is_api_request(response.url):
        return
    try:
        body = response.json()
    except Exception:
        body = None

    entry = {
        "timestamp": datetime.now().isoformat(),
        "type": "response",
        "status": response.status,
        "url": response.url,
        "headers": dict(response.headers),
        "body": body,
        "is_schedule_related": any(k in response.url.lower() for k in SCHEDULE_KEYWORDS),
    }
    captured.append(entry)


def save_results() -> None:
    OUTPUT_FILE.write_text(json.dumps(captured, indent=2), encoding="utf-8")
    total = len(captured)
    schedule_hits = sum(1 for c in captured if c.get("is_schedule_related"))
    print(f"\n{'='*60}")
    print(f"Saved {total} requests to {OUTPUT_FILE}")
    print(f"Schedule-related requests flagged: {schedule_hits}")
    print(f"{'='*60}")

    # Print a summary of schedule-related entries
    schedule_requests = [c for c in captured if c.get("is_schedule_related") and c["type"] == "request"]
    if schedule_requests:
        print("\n--- Schedule-related API calls ---")
        for r in schedule_requests:
            print(f"  {r['method']} {r['url']}")
            if r.get("post_data"):
                print(f"    Body: {r['post_data'][:200]}")
    else:
        print("\nNo schedule-related calls captured yet.")
        print("Navigate to the Scheduler section in the app and create/edit a schedule.")


def main() -> None:
    print("="*60)
    print("  Miraie API Capture Tool")
    print("="*60)
    print(f"\nOpening browser → {MIRAIE_URL}")
    print("\nInstructions:")
    print("  1. Log in to your Miraie account")
    print("  2. Navigate to the Scheduler / Timer section")
    print("  3. Create or edit a schedule (any time)")
    print("  4. Save the schedule")
    print("  5. Press Ctrl+C in this terminal when done")
    print("\nAll API requests are being captured...\n")

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=False,
            args=["--start-maximized"],
        )
        context = browser.new_context(
            viewport=None,
            # Record all network traffic
            record_har_path=str(Path(__file__).parent / "session.har"),
        )
        page = context.new_page()

        # Wire up interceptors
        page.on("request", on_request)
        page.on("response", on_response)

        try:
            page.goto(MIRAIE_URL, wait_until="domcontentloaded", timeout=15000)
        except Exception as e:
            print(f"Note: Initial load: {e}")

        print("Browser open. Waiting for you to interact... (Ctrl+C to finish)\n")

        try:
            # Keep running until user presses Ctrl+C
            page.wait_for_timeout(600_000)  # 10 minutes max
        except KeyboardInterrupt:
            pass
        finally:
            print("\nClosing browser and saving results...")
            try:
                context.close()
            except Exception:
                pass
            browser.close()

    save_results()


if __name__ == "__main__":
    main()
