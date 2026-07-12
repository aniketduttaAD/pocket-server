# Phone Server

Turn a spare Android phone into a personal cloud server — admin dashboard, file manager, PostgreSQL, and unlimited app subdomains — accessible from **anywhere** via Cloudflare Tunnel, **not** from your local Wi‑Fi.

**Everything runs on Android (Termux).** There is one setup script — no Mac required.

## What you get

| URL | Service |
|-----|---------|
| `https://dash.aniketdutta.space` | Admin dashboard |
| `https://media.aniketdutta.space` | File manager (photos, docs, code) |
| `https://app1.aniketdutta.space` | Your deployed apps |
| `https://app2.aniketdutta.space` | More apps… |

Access rules:

- `dash.*` and `media.*` are **admin-only** behind Cloudflare Access plus dashboard/File Browser login.
- `app1.*`, `app2.*`, etc. are **public app routes** by default.
- Every project gets a unique local port from `3001`–`3999`; dashboard (3000), PostgreSQL (5432), and media (8080) are reserved.
- Domain mapping: `subdomain → Cloudflare Tunnel → 127.0.0.1:<port>` on the phone.

## What you need

- Android phone (no root)
- [Termux from F-Droid](https://f-droid.org/en/packages/com.termux/) (not Play Store)
- Domain on Cloudflare (e.g. `aniketdutta.space`)
- Cloudflare account (free tier OK)

## Repository layout

```
phone-server/
├── dashboard/     # Admin web app (installed to ~/dash on phone)
├── scripts/
│   ├── setup.sh   # ← Single interactive setup (run on phone)
│   ├── verify.sh  # Post-install verification
│   └── backup.sh  # Backup script
└── docs/          # Detailed guides
```

---

# Setup (Android only)

### 1. Prepare phone

1. Install **Termux from F-Droid** (not Google Play)
2. Disable **battery optimization** for Termux (Settings → Apps → Termux → Battery → Unrestricted)
3. Add your domain to Cloudflare and wait until status is **Active**

### 2. Clone repo on phone

```bash
pkg install git
git clone <your-repo-url> ~/phone-server
cd ~/phone-server/scripts
```

### 3. Run the setup wizard

```bash
bash setup.sh
```

This single script interactively:

1. Installs Node.js, PM2, PostgreSQL, File Browser, cloudflared
2. Grants storage access and creates directory layout
3. Configures PostgreSQL and File Browser (localhost-only)
4. Guides Cloudflare Tunnel setup (login → create → DNS routes)
5. Installs dashboard to `~/dash` with production `.env`
6. Starts all PM2 and Termux services
7. Runs security checks

You will be prompted for:

- Base domain (e.g. `aniketdutta.space`)
- Dashboard admin username and password
- File Browser username and password
- Cloudflare tunnel UUID (after `cloudflared tunnel login` + `create`)

### 4. Cloudflare Access (required)

After setup completes, protect admin routes:

1. [Cloudflare Zero Trust](https://one.dash.cloudflare.com/) → Access → Applications
2. Add `dash.<your-domain>` — allow only your email
3. Add `media.<your-domain>` — allow only your email

Full walkthrough: [docs/CLOUDFLARE.md](docs/CLOUDFLARE.md)

### 5. Verify

```bash
bash ~/phone-server/scripts/verify.sh
pm2 list
```

Manual checks:

- [ ] `https://dash.<domain>` works from mobile data (not home Wi‑Fi)
- [ ] Cloudflare Access prompts for your email
- [ ] `http://<phone-ip>:3000` fails from another device on same Wi‑Fi
- [ ] Dashboard → Overview → Security checklist all green

---

## First use

1. Open `https://dash.<your-domain>` from any network
2. Complete Cloudflare Access login
3. Log in to dashboard with the password you set during setup
4. **Projects tab** — upload or git-clone your first app
5. **Domains tab** — verify DNS shows `hostname → 127.0.0.1:<port>`
6. **Databases tab** — create a PostgreSQL database

### Project rules

- Leave **Port** blank to auto-assign the next free port.
- Leave **Subdomain** blank to use the project name (e.g. `notes` → `notes.<domain>`).
- Public app subdomains should use Cloudflare WAF/rate limiting, not Access.

---

## Security model

| Threat | Protection |
|--------|------------|
| Neighbor on same Wi‑Fi | `BIND_HOST=127.0.0.1` — ports not exposed on LAN |
| Random internet user | Cloudflare Access on dash + media |
| Public app abuse | Cloudflare WAF/rate limiting |
| Brute force login | Rate limiting (5 attempts / 15 min) |
| High traffic / DDoS | Cloudflare WAF rate limiting |
| Stolen session | HttpOnly + Secure + SameSite cookies |
| Command injection | Allowlisted commands only in dashboard |
| PostgreSQL exposure | Never tunneled publicly; localhost only |

See [docs/SECURITY.md](docs/SECURITY.md) for details.

---

## Maintenance

### After phone reboot

```bash
sv start postgresql
sv start cloudflared
pm2 resurrect
pm2 list
```

### Backup

```bash
bash ~/phone-server/scripts/backup.sh
```

Or trigger from dashboard → Settings → Run backup.

### Update dashboard

```bash
cd ~/phone-server
git pull
bash scripts/setup.sh   # re-runs install; preserves .env if tunnel config exists
```

Or manually:

```bash
cd ~/phone-server
git pull
rsync -a --exclude node_modules --exclude .env dashboard/ ~/dash/
cd ~/dash && npm install --production && pm2 restart dash
```

### Add a new app subdomain

1. Dashboard → Projects → create/upload app
2. Dashboard → Domains → verify mapping
3. Visit `https://<subdomain>.<domain>`

---

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

---

## Documentation

- [Cloudflare setup (detailed)](docs/CLOUDFLARE.md)
- [Phone setup reference](docs/PHONE_SETUP.md)
- [Security reference](docs/SECURITY.md)

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Termux killed by Android | Disable battery optimization |
| Tunnel down | `sv restart cloudflared`; check `~/cloudflared.log` |
| Dashboard 502 | `pm2 restart dash`; check `pm2 logs dash` |
| LAN can still access dashboard | Confirm `BIND_HOST=127.0.0.1` in `~/dash/.env`, restart dash |
| DNS pending | Dashboard → Domains → Verify; wait 5 min |
| Setup script fails on Mac | Expected — run `bash setup.sh` only on Termux |

---

## License

Private use. Change all default passwords before exposing to the internet.
