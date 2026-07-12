# Security

See [README.md](../README.md) Part 5 for the security model overview.

## Cloudflare Access (required)

Protect admin subdomains before going public. Full steps: [CLOUDFLARE.md](CLOUDFLARE.md)

- `dash.aniketdutta.space`
- `media.aniketdutta.space`

Public app subdomains (`app1.*`, etc.) can remain open.

## Public app routes

Project subdomains are public by default:

- Each project gets one unique local port from `PROJECT_PORT_START` to `PROJECT_PORT_END`
- The dashboard rejects duplicate ports and mismatched domain mappings
- Cloudflare Tunnel maps `appX.aniketdutta.space` to `127.0.0.1:<allocated-port>`
- Protect public app routes with Cloudflare WAF/rate limiting

## Localhost-only binding

Production dashboard and File Browser bind to `127.0.0.1` only:

```env
BIND_HOST=127.0.0.1
```

Cloudflare Tunnel connects via `localhost`. LAN neighbors cannot reach services directly.

## Dashboard authentication

- Change `ADMIN_PASSWORD` immediately
- Use 64+ char `SESSION_SECRET`: `openssl rand -hex 32`
- Hash password optionally:

```bash
node -e "console.log(require('bcryptjs').hashSync('your-password', 10))"
```

## Rate limiting

Built into dashboard:

- Login: 5 attempts / 15 minutes per IP
- API: 100 requests / minute per IP

Plus Cloudflare WAF rate limiting on admin hostnames (recommended).

## Command execution

Allowlisted presets only — no raw shell.

## PostgreSQL

**Self-hosted on the phone** with remote and local connection strings. See [DATABASES.md](DATABASES.md).

- Remote URL: `db.<domain>:5432` via Cloudflare TCP tunnel
- Local URL: `127.0.0.1:5432` for apps on the phone
- Postgres stays on localhost; not exposed on LAN

## SSH on phone

SSH is optional and not required for setup. If enabled for debugging, disable when done:

```bash
pkill sshd
```

Prefer Tailscale for remote access without exposing LAN.

## Backups

```bash
bash ~/phone-server/scripts/backup.sh
```

## Pre-production checklist

- [ ] Cloudflare Access on dash + media
- [ ] WAF rate limiting configured
- [ ] WAF/rate limiting configured for public app subdomains
- [ ] No two projects share the same port
- [ ] `BIND_HOST=127.0.0.1`
- [ ] `NODE_ENV=production`
- [ ] Strong admin password + session secret
- [ ] `TUNNEL_ID` set
- [ ] File Browser password changed
- [ ] `pm2 save` after services stable
- [ ] Battery optimization disabled for Termux
- [ ] `bash scripts/verify.sh` passes
