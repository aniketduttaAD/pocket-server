# Cloudflare Setup Guide

Complete Cloudflare configuration for your phone server. Do this **after** Termux base setup and **before** going public.

## Prerequisites

- Domain `aniketdutta.space` registered
- Cloudflare account (free tier works)
- `cloudflared` installed on phone (via `scripts/setup.sh`)

---

## Step 1: Add domain to Cloudflare

1. Log in to [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Click **Add a site** → enter `aniketdutta.space`
3. Select **Free** plan
4. Cloudflare shows two nameservers (e.g. `ada.ns.cloudflare.com`)
5. At your domain registrar, replace nameservers with Cloudflare's
6. Wait until Cloudflare shows **Active** (can take up to 24 hours, usually minutes)

---

## Step 2: Create tunnel (on phone in Termux)

```bash
# Authorize cloudflared with your Cloudflare account
~/cloudflared tunnel login
# Opens browser — log in and select aniketdutta.space

# Create named tunnel
~/cloudflared tunnel create phone-tunnel
# Note the Tunnel ID (UUID) printed — save it!

# Route DNS for admin services
~/cloudflared tunnel route dns phone-tunnel dash.aniketdutta.space
~/cloudflared tunnel route dns phone-tunnel media.aniketdutta.space
```

Set the tunnel ID in dashboard env:

```bash
nano ~/dash/.env
# TUNNEL_ID=your-uuid-here
```

Verify config exists at `~/.cloudflared/config.yml`:

```yaml
tunnel: phone-tunnel
credentials-file: /data/data/com.termux/files/home/.cloudflared/<UUID>.json
ingress:
  - hostname: dash.aniketdutta.space
    service: http://127.0.0.1:3000
  - hostname: media.aniketdutta.space
    service: http://127.0.0.1:8080
  - service: http_status:404
```

Start tunnel:

```bash
sv start cloudflared
# or manually: ~/cloudflared tunnel run phone-tunnel
```

Verify:

```bash
curl -I https://dash.aniketdutta.space
```

---

## Step 3: Cloudflare Access (REQUIRED for admin)

This ensures **nobody** can access dash or media without your identity — not on your Wi‑Fi, not on the internet.

1. Go to [Cloudflare Zero Trust](https://one.dash.cloudflare.com/)
2. Navigate to **Access → Applications → Add an application**
3. Select **Self-hosted**
4. Application name: `Phone Dashboard`
5. Session duration: 24 hours
6. Application domain:
   - Subdomain: `dash`
   - Domain: `aniketdutta.space`
7. Add policy:
   - Policy name: `Allow me only`
   - Action: **Allow**
   - Include: **Emails** → your email address
8. Save application
9. Repeat for `media.aniketdutta.space`

**Result:** Visiting `https://dash.aniketdutta.space` shows Cloudflare login first, then dashboard login.

Public app subdomains (`app1.aniketdutta.space`, etc.) can stay open if you want public access to those apps.

---

## Step 4: WAF rate limiting (recommended)

Protects against high-traffic / DDoS-style attacks before they reach your phone.

1. Cloudflare Dashboard → **Security → WAF**
2. **Create rule** → **Rate limiting rule**
3. Rule name: `Protect admin subdomains`
4. Expression:
   ```
   (http.host eq "dash.aniketdutta.space") or (http.host eq "media.aniketdutta.space")
   ```
5. Requests: **100 per 1 minute** per IP
6. Action: **Block**
7. Deploy

Optional: add a **Managed ruleset** (Cloudflare Free includes basic WAF).

Create a second rule for public app routes:

1. Rule name: `Protect public app subdomains`
2. Expression:
   ```
   (http.host wildcard "*.aniketdutta.space")
   and not (http.host eq "dash.aniketdutta.space")
   and not (http.host eq "media.aniketdutta.space")
   ```
3. Start with **300 requests per minute per IP**
4. Action: **Managed Challenge** or **Block**
5. Tune per app if a legitimate app needs more traffic

---

## Step 5: Add app subdomains

When you deploy a new project, the dashboard assigns a unique port from `PROJECT_PORT_START` to `PROJECT_PORT_END` (default `3001-3999`). Do not reuse ports manually.

```bash
# On phone — or via dashboard Domains tab
~/cloudflared tunnel route dns phone-tunnel app1.aniketdutta.space
```

Update `~/.cloudflared/config.yml` ingress to the allocated project port:

```yaml
  - hostname: app1.aniketdutta.space
    service: http://127.0.0.1:3001
```

Restart tunnel:

```bash
sv restart cloudflared
```

The dashboard **Domains** tab automates this when you add a route. If you enter a project name, it uses the stored project port and rejects mismatches.

---

## How access works

```
You (anywhere) → Cloudflare DNS → Cloudflare Access (email check)
              → Cloudflare Tunnel → 127.0.0.1:3000 on phone

Public user → app1.aniketdutta.space → Cloudflare WAF/rate-limit
            → Cloudflare Tunnel → 127.0.0.1:<project-port> on phone

Neighbor on Wi‑Fi → http://192.168.x.x:3000 → CONNECTION REFUSED
                    (dashboard binds to 127.0.0.1 only)
```

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Tunnel not connecting | `sv restart cloudflared`; check `~/cloudflared.log` |
| DNS not resolving | Wait 5 min; verify CNAME in Cloudflare DNS tab |
| 502 Bad Gateway | Service not running: `pm2 list`; start dash |
| Access loop | Clear cookies; check Access policy includes your email |
| `tunnel login` fails | Use phone browser; copy URL to desktop if needed |

---

## Security checklist

- [ ] Domain on Cloudflare with proxy enabled (orange cloud)
- [ ] Tunnel created and running
- [ ] `TUNNEL_ID` set in `~/dash/.env`
- [ ] Cloudflare Access on `dash.*` and `media.*`
- [ ] WAF rate limiting on admin subdomains
- [ ] WAF/rate limiting on public app subdomains
- [ ] Each app subdomain maps to the correct allocated `127.0.0.1:<port>`
- [ ] `BIND_HOST=127.0.0.1` in dashboard `.env`
- [ ] Default admin password changed
- [ ] `bash scripts/verify.sh` passes on phone
