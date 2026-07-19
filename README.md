# Phone Server

Turn a spare Android phone into a personal cloud server — admin dashboard, file manager, **self-hosted PostgreSQL** with standalone remote URLs (via ngrok), and unlimited app subdomains — accessible from **anywhere** via Cloudflare Tunnel.

**Everything runs on Android (Termux).** One control script — no Mac required.

## What you get

| URL | Service |
|-----|---------|
| `https://dash.aniketdutta.space` | Admin dashboard |
| `https://media.aniketdutta.space` | Media file browser |
| `https://memory.aniketdutta.space` | Photo Memory Engine (AI search, faces, chat) |
| `https://app1.aniketdutta.space` | Your deployed apps |

## Setup (Android / Termux)

```bash
pkg install git
git clone <your-repo-url> ~/phone-server
cd ~/phone-server
bash scripts/phone.sh setup
```

The wizard installs Node.js, PM2, PostgreSQL, cloudflared, media server, dashboard, and tunnel.

**Prompts:** domain, admin password, media password, media folder (`~/storage/shared` recommended).

### Commands (all in one)

```bash
bash scripts/phone.sh setup              # first-time / update install
bash scripts/start.sh                    # after phone reboot
bash scripts/clean.sh                    # wipe everything except Cloudflare, then rebuild
bash scripts/phone.sh verify             # health checks
bash scripts/phone.sh backup             # backup data
bash scripts/phone.sh ngrok              # expose Postgres via ngrok
bash scripts/phone.sh postgres-tailscale # Postgres over Tailscale
bash scripts/phone.sh memory setup       # Memory Engine install
bash scripts/phone.sh memory pm2         # register Memory Engine with PM2
```

### After setup

1. **Cloudflare Access** — [Zero Trust](https://one.dash.cloudflare.com/) → Access → add `dash.*`, `media.*`, and `memory.*` (your email only).
2. **Verify:** `bash ~/phone-server/scripts/phone.sh verify` and `pm2 list` (expect `dash`, `media`, `tunnel` online).
3. **Test** from mobile data: `https://dash.<domain>` and `https://media.<domain>`.

### Memory Engine (photo AI)

```bash
termux-setup-storage
# Ensure memory-engine data exists (memory.db)

bash ~/phone-server/scripts/phone.sh memory setup
bash ~/phone-server/scripts/phone.sh memory pm2
pm2 list    # expect: memory
```

Open http://127.0.0.1:8765 or https://memory.\<domain\>.

### After phone reboot

```bash
bash ~/phone-server/scripts/start.sh
```

Or install [Termux:Boot](https://f-droid.org/packages/com.termux.boot/) and put that line in `~/.termux/boot/start-phone-server.sh`.

### Clean rebuild

Wipes dash, media, postgres, PM2, projects — **keeps `~/.cloudflared/`** (tunnel login + DNS config), then runs setup again:

```bash
bash ~/phone-server/scripts/clean.sh
```

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `unexpected e_type: 2` on cloudflared | Don't use GitHub binary. Run `rm -f ~/cloudflared` then `pkg install tur-repo && pkg install cloudflared` |
| Media path permission denied | Use `~/storage/shared` not `/storage/emulated/*`. Run `termux-setup-storage` first |
| Tunnel PM2 errored | Check `~/.cloudflared/config.yml` — media must be `http://127.0.0.1:8080`. Restart tunnel via `pm2` |
| Login page blank / CSP errors | `bash ~/phone-server/scripts/phone.sh setup` (choose update) or rsync dashboard → `~/dash` then `pm2 restart dash` |
| Dashboard 502 | `pm2 restart dash`; check `pm2 logs dash` |
| LAN can access dashboard | Set `BIND_HOST=127.0.0.1` in `~/dash/.env`, restart dash |

---

Private use. Change default passwords before going live.
