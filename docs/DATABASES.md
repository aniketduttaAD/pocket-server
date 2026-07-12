# PostgreSQL databases (self-hosted)

Phone Server runs **PostgreSQL on your phone** with **local** and **remote** connection strings.

## Which services need Tailscale?

| Service | Access method | Needs Tailscale? |
|---------|---------------|------------------|
| Dashboard (`dash.*`) | Cloudflare HTTP tunnel | **No** |
| Media (`media.*`) | Cloudflare HTTP tunnel | **No** |
| App subdomains | Cloudflare HTTP tunnel | **No** |
| **PostgreSQL remote** | Tailscale **or** Cloudflare TCP | **Yes** (recommended: Tailscale) |

Only **remote database access** benefits from Tailscale. Everything else keeps using Cloudflare.

## Two connection strings

| URL | Use when |
|-----|----------|
| **Local** `postgresql://user:pass@127.0.0.1:5432/mydb` | Apps on the **phone** (PM2 / Termux) |
| **Remote** `postgresql://user:pass@100.x.x.x:5432/mydb` | Mac, laptop — over **Tailscale** (direct, no cloudflared) |

---

## Tailscale setup (recommended)

### 1. Phone — Tailscale app

You already installed the app and logged in. Open Tailscale → note your phone's **100.x.x.x** IP.

### 2. Phone — allow Postgres on Tailscale (Termux)

Postgres defaults to `127.0.0.1` only. Run once:

```bash
bash ~/pocket-server/scripts/configure-postgres-tailscale.sh
```

### 3. Phone — set dashboard env

```bash
# Replace with your phone's Tailscale IP from the app
echo "DB_PUBLIC_HOST=100.x.x.x" >> ~/dash/.env
pm2 restart dash
```

Refresh the Databases tab — remote URLs will use the Tailscale IP. Existing DBs auto-update on load.

### 4. Mac — Tailscale app

Install [Tailscale for Mac](https://tailscale.com/download), log in with the **same account**.

### 5. Test from Mac

```bash
./pg-test-standalone.sh "postgresql://USER:PASS@100.x.x.x:5432/passo?sslmode=prefer"
```

### 6. Test local on phone (Termux)

```bash
psql "postgresql://USER:PASS@127.0.0.1:5432/passo" -c "SELECT 1"
```

---

## Cloudflare TCP (alternative, not recommended)

Remote URLs with `db.yourdomain:5432` **do not work** with plain `psql`. Requires `cloudflared access tcp` on every client. Use Tailscale instead.

---

## Create databases

Dashboard → **Databases** → name → **Create** → URLs appear in **Your databases** list (not a separate card).

Password shows once in a yellow banner after create — copy it before refresh/navigating away.

## Security

- Each app gets its own database + user + password
- Postgres accepts Tailscale range (`100.64.0.0/10`) only when configured via script
- Use strong passwords; rotate by deleting and recreating in dashboard

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Create fails — Postgres | `pg_ctl -D ~/postgres-data start` |
| Local URL empty in dashboard | Deploy latest dash + refresh (auto-backfills URLs) |
| Remote URL still shows `db.domain` | Set `DB_PUBLIC_HOST=100.x.x.x` in `~/dash/.env`, then `pm2 restart dash --update-env` |
| `listen_addresses` still `localhost` | Re-run `configure-postgres-tailscale.sh` — reload alone is not enough; Postgres must restart |
| Mac can't connect via Tailscale | Same Tailscale account on both devices; run configure script |
| Local URL fails on phone | Set `PGUSER=$(whoami)` in `~/dash/.env` |
| role does not exist | Set `PGUSER=$(whoami)` in `~/dash/.env` |
