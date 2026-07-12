# Phone Setup (Termux)

## One-command setup

```bash
git clone <your-repo-url> ~/phone-server
cd ~/phone-server/scripts
bash setup.sh
```

## What setup installs

| Component | How |
|-----------|-----|
| Node.js, PM2, PostgreSQL | `pkg install` |
| cloudflared | `pkg install cloudflared` (or `tur-repo` first) — **not** GitHub download |
| Media server | Node.js on `127.0.0.1:8080` |
| Dashboard | `~/dash` on `127.0.0.1:3000` |
| Tunnel | PM2 + `~/.cloudflared/config.yml` |

## Media folder path

**Use:** `~/storage/shared` (recommended)

**Avoid:** `/storage/emulated/0` or typos like `/stoage/...` — often permission denied in Termux.

Run `termux-setup-storage` and tap **Allow** before choosing a path.

## Cloudflare tunnel

Setup opens the login URL in your phone browser when possible. If not:

```bash
cloudflared tunnel login
cloudflared tunnel create phone-tunnel
```

Tunnel config must route both hostnames:

```yaml
ingress:
  - hostname: dash.yourdomain.com
    service: http://127.0.0.1:3000
  - hostname: media.yourdomain.com
    service: http://127.0.0.1:8080
  - service: http_status:404
```

Start tunnel:

```bash
pm2 start $(which cloudflared) --name tunnel --interpreter none -- \
  tunnel --config ~/.cloudflared/config.yml run phone-tunnel
pm2 save
```

## Verify

```bash
pm2 list          # dash, media, tunnel = online
bash ~/phone-server/scripts/verify.sh
curl http://127.0.0.1:3000/api/health
```

## After reboot

```bash
pg_ctl -D ~/postgres-data start
pm2 resurrect
```
