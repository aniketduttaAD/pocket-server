const express = require('express');
const fs = require('fs');
const config = require('../config');
const pm2 = require('../lib/pm2');
const postgres = require('../lib/postgres');
const ngrok = require('../lib/ngrok');
const db = require('../lib/db');
const { runCommand } = require('../lib/shell');
const { nextAvailablePort, getUsedPorts } = require('../lib/ports');

const router = express.Router();

router.get('/status', async (req, res) => {
  const pm2Result = await pm2.listProcesses();
  const pgResult = await postgres.listDatabases();
  const domains = db.prepare('SELECT * FROM domains ORDER BY hostname').all();
  const projects = db.prepare('SELECT * FROM projects ORDER BY name').all();
  const storedDbs = db.prepare('SELECT * FROM databases ORDER BY created_at DESC').all();

  let tunnelRunning = false;
  const svCheck = await runCommand('sv', ['status', 'cloudflared'], { timeout: 5000 });
  if (svCheck.ok && svCheck.stdout.includes('run')) {
    tunnelRunning = true;
  } else {
    const pgrep = await runCommand('pgrep', ['-f', 'cloudflared'], { timeout: 5000 });
    tunnelRunning = pgrep.ok;
  }
  if (!tunnelRunning && pm2Result.processes.some((p) => p.name === 'tunnel' && p.status === 'online')) {
    tunnelRunning = true;
  }

  const defaultPassword = config.adminPassword === 'changeme';
  const weakSecret = config.sessionSecret.length < 32 || config.sessionSecret.includes('change');
  const localhostBind = config.bindHost === '127.0.0.1' || config.bindHost === 'localhost';
  const tunnelConfigured = Boolean(config.tunnel.id);
  const cloudflaredConfigExists = fs.existsSync(config.paths.cloudflaredConfig);
  const ngrokStatus = await ngrok.getStatus();
  const dbRemoteOk = ngrok.remoteReady(ngrokStatus);

  const checks = [
    {
      id: 'bind_localhost',
      label: 'Dashboard bound to localhost only',
      ok: localhostBind || config.isDev,
      hint: config.isDev
        ? 'Dev mode allows LAN access'
        : 'Set BIND_HOST=127.0.0.1 so LAN cannot reach dashboard',
    },
    {
      id: 'production_mode',
      label: 'Production mode enabled',
      ok: !config.isDev,
      hint: 'Set NODE_ENV=production on phone',
    },
    {
      id: 'password_changed',
      label: 'Default admin password changed',
      ok: !defaultPassword,
      hint: 'Change ADMIN_PASSWORD in .env',
    },
    {
      id: 'session_secret',
      label: 'Strong session secret configured',
      ok: !weakSecret,
      hint: 'Use a 64+ character random SESSION_SECRET',
    },
    {
      id: 'tunnel_config',
      label: 'Cloudflare tunnel configured',
      ok: tunnelConfigured && cloudflaredConfigExists,
      hint: 'Set TUNNEL_ID and ~/.cloudflared/config.yml',
    },
    {
      id: 'tunnel_running',
      label: 'Cloudflare tunnel running',
      ok: tunnelRunning,
      hint: 'Run: pm2 restart tunnel',
    },
    {
      id: 'postgres',
      label: 'PostgreSQL running on phone',
      ok: pgResult.ok,
      hint: pgResult.error || 'Run: pg_ctl -D ~/postgres-data start',
    },
    {
      id: 'db_tunnel',
      label: 'Postgres remote tunnel (ngrok)',
      ok: dbRemoteOk,
      hint: dbRemoteOk
        ? `Public TCP: ${ngrokStatus.host}:${ngrokStatus.port}`
        : ngrokStatus.error || 'Run: bash ~/pocket-server/scripts/setup-ngrok.sh',
    },
    {
      id: 'pm2',
      label: 'PM2 services active',
      ok: pm2Result.processes.length > 0,
      hint: 'Start dash and media via pm2',
    },
    {
      id: 'trust_proxy',
      label: 'Trust proxy enabled (Cloudflare)',
      ok: config.trustProxy,
      hint: 'Set TRUST_PROXY=true when behind Cloudflare',
    },
  ];

  const domainsActive = domains.filter((d) => d.status === 'active').length;

  res.json({
    summary: {
      servicesOnline: pm2Result.processes.filter((p) => p.status === 'online').length,
      servicesTotal: pm2Result.processes.length,
      domainsActive,
      domainsTotal: domains.length,
      projectsTotal: projects.length,
      databasesTotal: storedDbs.length,
      nextProjectPort: nextAvailablePort(),
    },
    security: {
      bindHost: config.bindHost,
      isDev: config.isDev,
      trustProxy: config.trustProxy,
      baseDomain: config.baseDomain,
      dbPublicHost: config.database.publicHost,
      tunnelId: config.tunnel.id ? `${config.tunnel.id.slice(0, 8)}...` : null,
      projectPortRange: `${config.projects.portStart}-${config.projects.portEnd}`,
      usedPorts: Array.from(getUsedPorts()).sort((a, b) => a - b),
    },
    checks,
    allChecksPass: checks.every((c) => c.ok),
    publicUrls: domains.map((d) => ({
      hostname: d.hostname,
      url: `https://${d.hostname}`,
      status: d.status,
      accessLevel: ['dash', 'media'].includes(d.service_name) ? 'admin' : 'public',
      localService: `http://127.0.0.1:${d.port}`,
    })),
  });
});

router.post('/backup', async (req, res) => {
  const script = `${config.paths.home}/phone-server/scripts/backup.sh`;
  const alt = `${config.paths.home}/scripts/backup.sh`;
  const target = fs.existsSync(script) ? script : alt;
  if (!fs.existsSync(target)) {
    return res.status(404).json({ error: 'Backup script not found on phone' });
  }
  const result = await runCommand('bash', [target], { timeout: 120000 });
  res.json(result);
});

module.exports = router;
