# Miraie API Capture Guide

## Goal
Intercept the HTTPS traffic from the Miraie app when creating a schedule,
so we can replicate it in Python with 5-minute granularity.

## Tools Needed
- PC or laptop (same WiFi as your phone)
- `mitmproxy` — HTTPS intercepting proxy

## Step 1: Install mitmproxy on PC

```bash
pip install mitmproxy
```

## Step 2: Start the proxy

```bash
mitmweb --listen-port 8080
```

This opens a browser UI at http://localhost:8081 where you can inspect captured requests.

## Step 3: Configure your phone to use the proxy

1. On your Android phone, go to:
   **Settings → WiFi → [Your network] → Modify → Advanced → Proxy**
2. Set **Manual proxy**:
   - Host: `<your PC's local IP>` (e.g. `192.168.1.5`)
   - Port: `8080`

## Step 4: Install the mitmproxy CA certificate on Android

1. Open the phone browser and go to: `http://mitm.it`
2. Tap **Android** → download the certificate
3. Go to **Settings → Security → Install from storage** → install `mitmproxy-ca-cert.pem`
4. If prompted, set a PIN (Android requires it for user-installed CAs)

> For Android 7+: Miraie may use certificate pinning.
> If requests don't appear, see the "Certificate Pinning Bypass" section below.

## Step 5: Capture a schedule creation

1. Open the Miraie app
2. Create a **new schedule** (set it to any 1-hour interval)
3. Save the schedule
4. Go back to the mitmweb browser on your PC
5. Look for requests to `*.panasonic.com` or `*.miraie.in` or similar

## Step 6: Save the captured request

Copy the full request (method, URL, headers, body) and save it to:
`miraie/captured_schedule_request.json`

---

## Certificate Pinning Bypass (if needed)

If Miraie pins its certificate and requests don't show up, use **HTTP Toolkit**:

```bash
# On PC — install HTTP Toolkit
# https://httptoolkit.com (free tier works)
```

HTTP Toolkit can patch the app at runtime using ADB without root.
Alternatively, use `frida` with a SSL pinning bypass script (requires USB debugging).

### Quick frida approach (USB debugging enabled):

```bash
pip install frida-tools
adb devices  # verify phone connected
frida -U -f in.panasonic.miraie -l ssl_bypass.js  # launch app with pinning disabled
```

SSL bypass script: https://codeshare.frida.re/@pcipolloni/universal-android-ssl-pinning-bypass-with-frida/
