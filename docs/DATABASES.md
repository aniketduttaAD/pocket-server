# PostgreSQL databases (self-hosted)

Phone Server runs **PostgreSQL on your phone** and gives you **remote connection strings** — create a database in the dashboard, copy the URL, use it in any project from anywhere.

## Two connection strings

| URL | Use when |
|-----|----------|
| **Remote** `postgresql://user:pass@db.aniketdutta.space:5432/mydb` | Mac dev, other servers, anywhere on the internet |
| **Local** `postgresql://user:pass@127.0.0.1:5432/mydb` | Apps running **on the phone** (PM2 projects) — faster, no round-trip |

Remote access uses **Cloudflare Tunnel (TCP)** to `db.<your-domain>` → Postgres on the phone. Postgres itself stays on `127.0.0.1` (not exposed on LAN).

## Setup

### 1. PostgreSQL on phone

```bash
pg_ctl -D ~/postgres-data start
```

Setup script initializes this automatically. Ensure `PGUSER` in `~/dash/.env` matches your Termux user (`whoami`).

### 2. Database tunnel (automatic)

When you create your first database in the dashboard, it adds to `~/.cloudflared/config.yml`:

```yaml
  - hostname: db.aniketdutta.space
    service: tcp://127.0.0.1:5432
```

And routes DNS. Or add manually and `pm2 restart tunnel`.

### 3. Optional `.env` overrides

```env
DB_PUBLIC_HOST=db.aniketdutta.space
DB_PUBLIC_PORT=5432
PGUSER=u0_a759
PGDATABASE=postgres
```

### 4. Create databases

Dashboard → **Databases** → name → **Create** → copy remote or local URL.

## Example

**Remote (Mac / cloud):**

```env
DATABASE_URL=postgresql://passo:secret@db.aniketdutta.space:5432/passo?sslmode=prefer
```

**Local (app on phone):**

```env
DATABASE_URL=postgresql://passo:secret@127.0.0.1:5432/passo
```

## Security

- Each app gets its own database + user + password
- Postgres not bound to LAN — only localhost + Cloudflare tunnel
- Use strong passwords; rotate by deleting and recreating in dashboard
- Consider Cloudflare Access / firewall rules on `db.*` for extra protection

## Remote connection notes

Cloudflare TCP tunnels route Postgres through Cloudflare's network. Most standard Postgres clients connect to `db.yourdomain:5432` directly. If a client fails, try:

```bash
cloudflared access tcp --hostname db.aniketdutta.space --url 127.0.0.1:5432
# then connect to 127.0.0.1:5432 locally
```

For **Tailscale** instead of public hostname, set `DB_PUBLIC_HOST=100.x.x.x` (phone's Tailscale IP).

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Create fails — Postgres | `pg_ctl -D ~/postgres-data start` |
| Remote URL fails | Check tunnel ingress + `pm2 restart tunnel` |
| Local URL fails | Check `PGUSER` in `.env` |
| role does not exist | Set `PGUSER=$(whoami)` in `~/dash/.env` |
