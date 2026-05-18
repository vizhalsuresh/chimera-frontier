FROM python:3.12-slim

# ── System deps + cloudflared ─────────────────────────────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
        curl ca-certificates \
    && curl -fsSL \
       https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 \
       -o /usr/local/bin/cloudflared \
    && chmod +x /usr/local/bin/cloudflared \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# ── Python dependencies ───────────────────────────────────────────────────────
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# ── Application code ──────────────────────────────────────────────────────────
COPY miraie/ ./miraie/
COPY entrypoint.sh .
RUN chmod +x entrypoint.sh

# Logs directory (overridden by volume mount at runtime)
RUN mkdir -p /app/miraie/logs

# ── Runtime ───────────────────────────────────────────────────────────────────
ENV MIRAIE_PORT=8001
EXPOSE 8001

ENTRYPOINT ["./entrypoint.sh"]
