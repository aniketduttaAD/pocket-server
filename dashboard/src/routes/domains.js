const express = require('express');
const db = require('../lib/db');
const config = require('../config');
const { verifyCname } = require('../lib/dns');
const cloudflared = require('../lib/cloudflared');
const { sanitizeHostname, sanitizePort } = require('../lib/shell');
const { jsonError } = require('../middleware/validate');
const { assertPortAvailable } = require('../lib/ports');

const router = express.Router();

function routeAccessLevel(serviceName) {
  return ['dash', 'media'].includes(serviceName) ? 'admin' : 'public';
}

router.get('/', (req, res) => {
  const domains = db.prepare('SELECT * FROM domains ORDER BY hostname').all();
  res.json({
    domains: domains.map((d) => ({
      ...d,
      access_level: routeAccessLevel(d.service_name),
      local_service: `http://127.0.0.1:${d.port}`,
    })),
    tunnelId: config.tunnel.id,
    tunnelName: config.tunnel.name,
    baseDomain: config.baseDomain,
    target: config.tunnel.id
      ? `${config.tunnel.id}.cfargotunnel.com`
      : '<TUNNEL_ID>.cfargotunnel.com',
  });
});

router.post('/add', async (req, res) => {
  try {
    const { hostname, serviceName, port } = req.body;
    const full = sanitizeHostname(hostname, config.baseDomain);
    const safeService = serviceName || full.split('.')[0];
    const project = db.prepare('SELECT * FROM projects WHERE name = ?').get(safeService);
    const existingDomain = db.prepare('SELECT * FROM domains WHERE hostname = ?').get(full);

    let safePort;
    if (project) {
      if (!project.port) return jsonError(res, 400, `Project ${safeService} has no allocated port`);
      safePort = Number(project.port);
      if (port && Number(port) !== safePort) {
        return jsonError(
          res,
          400,
          `Port mismatch: project ${safeService} is allocated ${safePort}, not ${port}`
        );
      }
    } else {
      if (!port) return jsonError(res, 400, 'Port required when service is not a known project');
      safePort = ['dash', 'media'].includes(safeService)
        ? sanitizePort(port)
        : assertPortAvailable(port, { hostname: full, serviceName: safeService });
    }

    if (existingDomain && existingDomain.service_name !== safeService) {
      return jsonError(res, 409, `${full} is already mapped to ${existingDomain.service_name}`);
    }

    const target = config.tunnel.id
      ? `${config.tunnel.id}.cfargotunnel.com`
      : '<TUNNEL_ID>.cfargotunnel.com';

    db.prepare(
      `INSERT OR REPLACE INTO domains (hostname, service_name, port, target, status)
       VALUES (?, ?, ?, ?, 'pending')`
    ).run(full, safeService, safePort, target);

    const result = await cloudflared.addIngressRule(full, safePort);
    res.json({
      ok: true,
      domain: db.prepare('SELECT * FROM domains WHERE hostname = ?').get(full),
      mapping: {
        hostname: full,
        serviceName: safeService,
        localService: `http://127.0.0.1:${safePort}`,
        accessLevel: routeAccessLevel(safeService),
      },
      cloudflared: result,
      dnsRecord: {
        type: 'CNAME',
        name: full,
        target,
      },
    });
  } catch (err) {
    jsonError(res, 400, err.message);
  }
});

router.get('/verify/:hostname', async (req, res) => {
  const hostname = req.params.hostname.toLowerCase();
  const domain = db.prepare('SELECT * FROM domains WHERE hostname = ?').get(hostname);
  if (!domain) return jsonError(res, 404, 'Domain not found');

  const expected =
    domain.target ||
    (config.tunnel.id ? `${config.tunnel.id}.cfargotunnel.com` : '');
  const result = await verifyCname(hostname, expected);

  const status = result.status || 'error';
  db.prepare(
    `UPDATE domains SET status = ?, last_verified = datetime('now') WHERE hostname = ?`
  ).run(status, hostname);

  res.json({
    ...domain,
    access_level: routeAccessLevel(domain.service_name),
    local_service: `http://127.0.0.1:${domain.port}`,
    status,
    verification: result,
    dnsRecord: {
      type: 'CNAME',
      name: hostname,
      target: expected,
    },
  });
});

router.get('/verify-all', async (req, res) => {
  const domains = db.prepare('SELECT * FROM domains').all();
  const results = [];

  for (const domain of domains) {
    const expected =
      domain.target ||
      (config.tunnel.id ? `${config.tunnel.id}.cfargotunnel.com` : '');
    const result = await verifyCname(domain.hostname, expected);
    const status = result.status || 'error';
    db.prepare(
      `UPDATE domains SET status = ?, last_verified = datetime('now') WHERE hostname = ?`
    ).run(status, domain.hostname);
    results.push({
      ...domain,
      access_level: routeAccessLevel(domain.service_name),
      local_service: `http://127.0.0.1:${domain.port}`,
      status,
      verification: result,
    });
  }

  res.json({ domains: results });
});

router.get('/config', (req, res) => {
  const cfg = cloudflared.readConfig();
  res.json(cfg);
});

module.exports = router;
