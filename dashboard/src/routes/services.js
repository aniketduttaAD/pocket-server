const express = require('express');
const pm2 = require('../lib/pm2');
const db = require('../lib/db');
const { jsonError } = require('../middleware/validate');

const router = express.Router();

router.get('/', async (req, res) => {
  const result = await pm2.listProcesses();
  const projects = db.prepare('SELECT * FROM projects ORDER BY name').all();
  const domains = db.prepare('SELECT * FROM domains ORDER BY hostname').all();

  const domainMap = Object.fromEntries(domains.map((d) => [d.service_name, d]));

  const services = result.processes.map((p) => ({
    ...p,
    domain: domainMap[p.name] || null,
    project: projects.find((pr) => pr.name === p.name) || null,
  }));

  res.json({
    ok: result.ok,
    services,
    pm2Error: result.error || null,
  });
});

router.post('/start', async (req, res) => {
  const { name } = req.body;
  if (!name || !/^[a-z0-9][a-z0-9-_]{0,62}$/i.test(name)) {
    return jsonError(res, 400, 'Invalid service name');
  }

  const project = db.prepare('SELECT * FROM projects WHERE name = ?').get(name);
  if (project?.command) {
    const result = await pm2.startService(name, project.command, project.dir);
    await pm2.savePm2();
    return res.json(result);
  }

  const result = await pm2.startService(name, name);
  res.json(result);
});

router.post('/stop', async (req, res) => {
  const { name } = req.body;
  if (!name) return jsonError(res, 400, 'Name required');
  const result = await pm2.stopService(name);
  res.json(result);
});

router.post('/restart', async (req, res) => {
  const { name } = req.body;
  if (!name) return jsonError(res, 400, 'Name required');
  const result = await pm2.restartService(name);
  res.json(result);
});

router.delete('/:name', async (req, res) => {
  const { name } = req.params;
  if (!name) return jsonError(res, 400, 'Name required');
  const result = await pm2.deleteService(name);
  await pm2.savePm2();
  res.json(result);
});

router.get('/:name/logs', async (req, res) => {
  const { name } = req.params;
  const lines = parseInt(req.query.lines || '100', 10);
  const result = await pm2.getLogs(name, Math.min(lines, 500));
  res.json(result);
});

router.get('/health/all', async (req, res) => {
  const projects = db.prepare('SELECT * FROM projects WHERE port IS NOT NULL').all();
  const domains = db.prepare('SELECT * FROM domains').all();
  const checks = [];

  const all = [
    ...projects.map((p) => ({ name: p.name, url: `http://localhost:${p.port}` })),
    ...domains
      .filter((d) => d.port)
      .map((d) => ({ name: d.service_name, url: `http://localhost:${d.port}` })),
  ];

  const seen = new Set();
  for (const item of all) {
    if (seen.has(item.name)) continue;
    seen.add(item.name);
    let status = 'unknown';
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const r = await fetch(item.url, { signal: controller.signal });
      clearTimeout(timeout);
      status = r.ok ? 'up' : 'down';
    } catch {
      status = 'down';
    }
    checks.push({ name: item.name, url: item.url, status });
  }

  res.json({ checks });
});

module.exports = router;
