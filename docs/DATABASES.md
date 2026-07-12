# PostgreSQL databases (phone-hosted, standalone remote URL)

Phone Server runs **PostgreSQL on your phone**. Remote apps get a **real connection string** — paste it in Mac, Vercel, serverless, anywhere. **No Tailscale or cloudflared on the client.**

## How it works

| URL | Use when |
|-----|----------|
| **Local** `postgresql://user:pass@127.0.0.1:5432/mydb` | Apps on the **phone** (PM2 / Termux) |
| **Remote** `postgresql://user:pass@0.tcp.ngrok.io:12345/mydb` | **Anywhere** — Mac, cloud, serverless |

Remote access uses **ngrok TCP** running on the phone. ngrok gives a public TCP address that forwards to Postgres on `127.0.0.1:5432`.

Cloudflare HTTP tunnel (dash, media, apps) is unchanged — only Postgres remote uses ngrok.

---

## One-time setup (phone / Termux)

### 1. Postgres running

```bash
pg_ctl -D ~/postgres-data start
psql -d postgres -c "SHOW listen_addresses;"   # should be *
```

If still `localhost`:

```bash
bash ~/pocket-server/scripts/configure-postgres-tailscale.sh
```

### 2. ngrok account

1. Sign up: https://ngrok.com  
2. Copy authtoken: https://dashboard.ngrok.com/get-started/your-authtoken  
3. Add payment method (required for TCP on free tier — not charged for basic use)

### 3. Configure dashboard

Add to `~/dash/.env`:

```env
NGROK_ENABLED=true
NGROK_AUTHTOKEN=your_token_here
```

### 4. Install and start ngrok tunnel

```bash
bash ~/pocket-server/scripts/setup-ngrok.sh
pm2 restart dash --update-env
```

**Termux note:** Generic Linux ngrok binaries fail with `unexpected e_type: 2`. The setup script uses `pkg install ngrok` or a `termux-chroot` wrapper automatically.

If ngrok shows "Reconnecting", turn on your phone's **mobile hotspot** and run `pm2 restart ngrok-db`.

Check:

```bash
pm2 logs ngrok-db --lines 20
curl -s http://127.0.0.1:4040/api/tunnels | grep public_url
```

### 5. Create database in dashboard

Dashboard → **Databases** → Create → copy **Remote** URL.

Test from Mac:

```bash
./pg-test-standalone.sh "postgresql://USER:PASS@0.tcp.ngrok.io:PORT/DB?sslmode=prefer"
```

---

## Free tier — URLs change on restart

ngrok free TCP addresses change when `ngrok-db` restarts. The dashboard **auto-syncs** remote URLs:

- Backend rebuilds URLs from the live ngrok API on every `/api/databases` request
- Databases tab polls every **20 seconds** while open
- Toast notification when ngrok endpoint changes

After `pm2 restart ngrok-db`, open the Databases tab (or wait ~20s) and copy the new remote URL.

---

Free ngrok TCP URLs **change when ngrok restarts**. For a fixed host/port, use a reserved TCP address on a paid ngrok plan:

```env
NGROK_TCP_HOST=0.tcp.ngrok.io
NGROK_TCP_PORT=12345
```

Dashboard uses these instead of querying the live API.

---

## Which services need ngrok?

| Service | Tunnel |
|---------|--------|
| Dashboard, media, app subdomains | Cloudflare (unchanged) |
| **Postgres remote** | **ngrok TCP on phone** |

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Create fails — ngrok | `pm2 restart ngrok-db`, check `NGROK_AUTHTOKEN` |
| Remote URL empty | ngrok not running — run setup-ngrok.sh |
| Local works, remote fails | Confirm ngrok tunnel: `curl http://127.0.0.1:4040/api/tunnels` |
| URL changed after restart | Expected on free tier — refresh dashboard or use paid reserved TCP |
| `unexpected e_type: 2` | Re-run `setup-ngrok.sh` — uses termux-chroot, not direct Linux binary |
| ngrok stuck Reconnecting | Turn on mobile hotspot, then `pm2 restart ngrok-db` |
| `listen_addresses` localhost | Re-run configure-postgres-tailscale.sh |
