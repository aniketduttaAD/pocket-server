# Phone Setup (Termux)

All setup runs **on your Android phone** via a single interactive script.

## Prerequisites

1. Install [Termux from F-Droid](https://f-droid.org/en/packages/com.termux/) (not Play Store).
2. Disable battery optimization for Termux.
3. Domain added to Cloudflare with active nameservers.

## One-command setup

```bash
git clone <your-repo-url> ~/phone-server
cd ~/phone-server/scripts
bash setup.sh
```

The wizard installs and configures everything:

| Step | What it does |
|------|--------------|
| Packages | Node.js, PM2, PostgreSQL, Go, cloudflared deps |
| Storage | `termux-setup-storage`, creates `~/projects`, `~/uploads`, etc. |
| PostgreSQL | Init, Termux service, auto-start |
| File Browser | Build, localhost bind, PM2 service `media` |
| Cloudflare | Download binary, tunnel config, DNS routes |
| Dashboard | Copy to `~/dash`, write production `.env`, PM2 service `dash` |
| Security | Localhost bind, password checks, service status |

## Cloudflare tunnel (during setup)

When prompted, run these in a separate Termux session if not done yet:

```bash
~/cloudflared tunnel login
~/cloudflared tunnel create phone-tunnel
```

Then enter the tunnel UUID when `setup.sh` asks for it.

## After setup

1. Enable Cloudflare Access on `dash.*` and `media.*` — [CLOUDFLARE.md](CLOUDFLARE.md)
2. Run verification:

```bash
bash ~/phone-server/scripts/verify.sh
```

## Phone directory layout

```
~/dash/                    # Admin dashboard
~/projects/frontend/       # Frontend apps
~/projects/backend/        # Backend apps
~/filebrowser/             # File Browser config
~/postgres-data/           # PostgreSQL data
~/.cloudflared/            # Tunnel config
~/cloudflared              # cloudflared binary
~/uploads/                 # Project upload staging
~/backups/                 # Backups
```

## Recovery after reboot

```bash
sv start postgresql
sv start cloudflared
pm2 resurrect
pm2 list
```

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Termux killed by Android | Disable battery optimization |
| Tunnel not connecting | `sv restart cloudflared`; check `~/cloudflared.log` |
| PM2 empty after reboot | `pm2 save` then `pm2 startup` (follow printed instructions) |
| PostgreSQL won't start | `pg_ctl -D ~/postgres-data status` |
| Script says "must run on Termux" | Do not run on Mac — use phone only |
