# Phone Server

Turn a spare Android phone into a personal cloud server — admin dashboard, file manager, PostgreSQL, and unlimited app subdomains — accessible from **anywhere** via Cloudflare Tunnel, **not** from your local Wi‑Fi.

**Everything runs on Android (Termux).** One setup script — no Mac required.

## What you get

| URL | Service |
|-----|---------|
| `https://dash.aniketdutta.space` | Admin dashboard |
| `https://media.aniketdutta.space` | Media file browser |
| `https://app1.aniketdutta.space` | Your deployed apps |

## Setup (Android / Termux)

```bash
pkg install git
git clone <your-repo-url> ~/phone-server
cd ~/phone-server/scripts
bash setup.sh
```

The wizard installs Node.js, PM2, PostgreSQL, cloudflared (Termux package), media server, dashboard, and tunnel.

**Prompts:** domain, admin password, media password, media folder (`~/storage/shared` recommended).

### After setup

1. **Cloudflare Access** — [Zero Trust](https://one.dash.cloudflare.com/) → Access → add `dash.*` and `media.*` (your email only). See [docs/CLOUDFLARE.md](docs/CLOUDFLARE.md).
2. **Verify:** `bash ~/phone-server/scripts/verify.sh` and `pm2 list` (expect `dash`, `media`, `tunnel` online).
3. **Test** from mobile data: `https://dash.<domain>` and `https://media.<domain>`.

### After phone reboot

```bash
pg_ctl -D ~/postgres-data start
pm2 resurrect
```

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `unexpected e_type: 2` on cloudflared | Don't use GitHub binary. Run `rm -f ~/cloudflared` then `pkg install tur-repo && pkg install cloudflared` |
| Media path permission denied | Use `~/storage/shared` not `/storage/emulated/*`. Run `termux-setup-storage` first |
| Tunnel PM2 errored | Check `~/.cloudflared/config.yml` — media must be `http://127.0.0.1:8080`, not `http_status:404`. Restart: `pm2 delete tunnel && pm2 start $(which cloudflared) --name tunnel --interpreter none -- tunnel --config ~/.cloudflared/config.yml run phone-tunnel` |
| Login page blank / CSP errors | Update dashboard: `rsync -a --exclude node_modules --exclude .env ~/phone-server/dashboard/ ~/dash/ && pm2 restart dash` |
| Cloudflare login URL not opening | Run `cloudflared tunnel login` manually; copy URL from terminal to browser |
| Dashboard 502 | `pm2 restart dash`; check `pm2 logs dash` |
| LAN can access dashboard | Set `BIND_HOST=127.0.0.1` in `~/dash/.env`, restart dash |

---

## Documentation

- [Phone setup](docs/PHONE_SETUP.md)
- [Cloudflare](docs/CLOUDFLARE.md)
- [Security](docs/SECURITY.md)

---

Private use. Change default passwords before going live.
