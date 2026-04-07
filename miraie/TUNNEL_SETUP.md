# Permanent Public URL Setup

Two options. **Tailscale Funnel is recommended** — truly free, no domain needed, same URL forever.

---

## Option A: Tailscale Funnel (Recommended — Free, Permanent)

Your permanent URL will look like:
`https://your-laptop-name.tail1a2b3c.ts.net`

### Step 1: Create a free Tailscale account
Go to https://tailscale.com and sign up (use Google or GitHub login).

### Step 2: Install Tailscale on your laptop

**Linux:**
```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```
A browser will open — log in with your Tailscale account.

**Windows:**
Download from https://tailscale.com/download/windows and install.
Then open the Tailscale tray icon and log in.

**Mac:**
```bash
brew install tailscale
sudo tailscale up
```

### Step 3: Enable Funnel (one-time)

In the Tailscale admin panel (https://login.tailscale.com/admin/acls), add this to your ACL policy:

```json
"nodeAttrs": [
  {
    "target": ["*"],
    "attr":   ["funnel"]
  }
]
```

### Step 4: Start everything
```bash
bash miraie/start.sh
```

`start.sh` automatically detects Tailscale and runs:
```bash
tailscale funnel 8001
```

Your permanent URL is shown in the terminal and stays the same forever.

---

## Option B: Cloudflare Tunnel (Free — Needs a Domain)

If you already own a domain, this gives you a clean URL like `https://miraie.yourdomain.com`.

### Step 1: Create a free Cloudflare account
Go to https://cloudflare.com and sign up.
Add your domain to Cloudflare and update your domain's nameservers to Cloudflare's.

### Step 2: Authenticate cloudflared
```bash
cloudflared tunnel login
```
A browser opens — log in with Cloudflare. This saves a certificate locally.

### Step 3: Create a named tunnel
```bash
cloudflared tunnel create miraie-scheduler
```
Copy the tunnel UUID from the output.

### Step 4: Configure the tunnel
Create `~/.cloudflared/config.yml`:
```yaml
tunnel: <PASTE-YOUR-UUID-HERE>
credentials-file: /home/YOUR_USERNAME/.cloudflared/<UUID>.json

ingress:
  - hostname: miraie.yourdomain.com
    service: http://localhost:8001
  - service: http_status:404
```

### Step 5: Add DNS record
```bash
cloudflared tunnel route dns miraie-scheduler miraie.yourdomain.com
```

### Step 6: Start with Cloudflare tunnel
```bash
export CLOUDFLARE_TUNNEL_NAME=miraie-scheduler
bash miraie/start.sh
```

---

## Fixing your laptop clone

If the `miraie/` folder is missing on your laptop, you just need to pull:

```bash
cd e-agent          # or wherever you cloned the repo
git pull
```

Then first-time setup on the laptop:
```bash
# Install Python deps
pip install fastapi uvicorn httpx paho-mqtt python-multipart certifi

# Restore your session (copy miraie_session.json from the machine that ran --setup)
# OR re-run setup:
python3 miraie/miraie_scheduler.py --setup --mobile 9043293031 --password YOUR_PASS

# Start
bash miraie/start.sh
```

---

## Which option should I use?

| | Tailscale Funnel | Cloudflare Tunnel |
|---|---|---|
| Cost | Free | Free (but need a domain ~$8/yr) |
| Domain needed | No | Yes |
| URL format | `https://laptop.tail1234.ts.net` | `https://miraie.yourdomain.com` |
| Setup time | ~5 minutes | ~15 minutes |
| Reliability | Excellent | Excellent |
| Works when laptop is off | No (both options need laptop on) | No |
