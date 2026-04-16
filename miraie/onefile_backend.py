#!/usr/bin/env python3
"""
onefile_backend.py

Single backend entrypoint for Miraie.
Uses the existing FastAPI app from web.py and exposes all routes, including:
- /onefile (single-file frontend)
- /api/*    (existing backend APIs)
"""

import os

import uvicorn

from web import app


if __name__ == "__main__":
    port = int(os.environ.get("MIRAIE_PORT", 8001))
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="warning")
