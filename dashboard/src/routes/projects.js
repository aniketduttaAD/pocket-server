const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const unzipper = require('unzipper');
const db = require('../lib/db');
const pm2 = require('../lib/pm2');
const config = require('../config');
const {
  sanitizeName,
  sanitizeHostname,
  runCommand,
} = require('../lib/shell');
const { safeProjectPath, jsonError } = require('../middleware/validate');
const cloudflared = require('../lib/cloudflared');
const { allocateProjectPort, nextAvailablePort, getUsedPorts } = require('../lib/ports');

const router = express.Router();

const storage = multer.diskStorage({
  destination: config.paths.uploads,
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: config.upload.maxSizeMb * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!config.upload.allowedExtensions.includes(ext)) {
      return cb(new Error('Only .zip uploads allowed'));
    }
    cb(null, true);
  },
});

router.get('/', (req, res) => {
  const projects = db.prepare('SELECT * FROM projects ORDER BY created_at DESC').all();
  res.json({ projects });
});

router.get('/ports', (req, res) => {
  const used = Array.from(getUsedPorts()).sort((a, b) => a - b);
  res.json({
    range: config.projects,
    next: nextAvailablePort(),
    used,
  });
});

async function mapProjectDomain({ subdomain, projectName, port }) {
  if (!subdomain) return null;
  const hostname = sanitizeHostname(subdomain, config.baseDomain);
  const target = config.tunnel.id ? `${config.tunnel.id}.cfargotunnel.com` : '';

  await cloudflared.addIngressRule(hostname, port);
  db.prepare(
    `INSERT OR REPLACE INTO domains (hostname, service_name, port, target, status)
     VALUES (?, ?, ?, ?, 'pending')`
  ).run(hostname, projectName, port, target);

  return { hostname, port, target };
}

function resolveProjectPort(projectName, inputPort) {
  const existing = db.prepare('SELECT * FROM projects WHERE name = ?').get(projectName);
  if ((inputPort === undefined || inputPort === null || String(inputPort).trim() === '') && existing?.port) {
    return Number(existing.port);
  }
  return allocateProjectPort(inputPort, { projectName, serviceName: projectName });
}

router.post('/create', async (req, res) => {
  try {
    const { name, type, command, port, subdomain } = req.body;
    const safeName = sanitizeName(name, 'project');
    const safeType = type === 'frontend' ? 'frontend' : 'backend';
    const safePort = resolveProjectPort(safeName, port);
    const dir = safeProjectPath(safeType, safeName);

    if (fs.existsSync(dir)) {
      return jsonError(res, 409, 'Project already exists');
    }
    fs.mkdirSync(dir, { recursive: true });

    const insert = db
      .prepare(
        `INSERT INTO projects (name, type, dir, command, port, subdomain)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(safeName, safeType, dir, command || null, safePort, subdomain || null);

    let pm2Result = null;
    if (command) {
      pm2Result = await pm2.startService(safeName, command, dir);
      await pm2.savePm2();
    }

    const domain = await mapProjectDomain({ subdomain: subdomain || safeName, projectName: safeName, port: safePort });

    res.json({
      ok: true,
      project: db.prepare('SELECT * FROM projects WHERE id = ?').get(insert.lastInsertRowid),
      domain,
      pm2: pm2Result,
    });
  } catch (err) {
    jsonError(res, 400, err.message);
  }
});

router.post('/upload', upload.single('archive'), async (req, res) => {
  try {
    const { name, type, command, port, subdomain } = req.body;
    if (!req.file) return jsonError(res, 400, 'No archive uploaded');

    const safeName = sanitizeName(name, 'project');
    const safeType = type === 'frontend' ? 'frontend' : 'backend';
    const safePort = resolveProjectPort(safeName, port);
    const dir = safeProjectPath(safeType, safeName);

    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    fs.mkdirSync(dir, { recursive: true });

    await fs
      .createReadStream(req.file.path)
      .pipe(unzipper.Extract({ path: dir }))
      .promise();

    fs.unlinkSync(req.file.path);

    const existing = db.prepare('SELECT id FROM projects WHERE name = ?').get(safeName);
    if (existing) {
      db.prepare(
        `UPDATE projects SET type=?, dir=?, command=?, port=?, subdomain=?, updated_at=datetime('now') WHERE name=?`
      ).run(safeType, dir, command || null, safePort, subdomain || null, safeName);
    } else {
      db.prepare(
        `INSERT INTO projects (name, type, dir, command, port, subdomain) VALUES (?, ?, ?, ?, ?, ?)`
      ).run(safeName, safeType, dir, command || null, safePort, subdomain || null);
    }

    const domain = await mapProjectDomain({ subdomain: subdomain || safeName, projectName: safeName, port: safePort });

    res.json({
      ok: true,
      project: db.prepare('SELECT * FROM projects WHERE name = ?').get(safeName),
      domain,
      message: 'Upload extracted. Run install/build/start from dashboard when ready.',
    });
  } catch (err) {
    jsonError(res, 400, err.message);
  }
});

router.post('/clone', async (req, res) => {
  try {
    const { name, type, gitUrl, command, port, subdomain } = req.body;
    if (!gitUrl) return jsonError(res, 400, 'gitUrl required');

    const safeName = sanitizeName(name, 'project');
    const safeType = type === 'frontend' ? 'frontend' : 'backend';
    const safePort = resolveProjectPort(safeName, port);
    const dir = safeProjectPath(safeType, safeName);

    const urlPattern = /^https?:\/\/[^\s/$.?#].[^\s]*$/i;
    if (!urlPattern.test(gitUrl) || gitUrl.includes('..')) {
      return jsonError(res, 400, 'Invalid git URL');
    }

    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    fs.mkdirSync(path.dirname(dir), { recursive: true });

    const cloneResult = await runCommand('git', ['clone', '--depth', '1', gitUrl, dir], {
      timeout: 300000,
    });
    if (!cloneResult.ok) {
      return jsonError(res, 500, cloneResult.error || cloneResult.stderr || 'Git clone failed');
    }

    const existing = db.prepare('SELECT id FROM projects WHERE name = ?').get(safeName);
    if (existing) {
      db.prepare(
        `UPDATE projects SET type=?, dir=?, command=?, port=?, subdomain=?, updated_at=datetime('now') WHERE name=?`
      ).run(safeType, dir, command || null, safePort, subdomain || null, safeName);
    } else {
      db.prepare(
        `INSERT INTO projects (name, type, dir, command, port, subdomain) VALUES (?, ?, ?, ?, ?, ?)`
      ).run(safeName, safeType, dir, command || null, safePort, subdomain || null);
    }

    const domain = await mapProjectDomain({ subdomain: subdomain || safeName, projectName: safeName, port: safePort });

    res.json({
      ok: true,
      project: db.prepare('SELECT * FROM projects WHERE name = ?').get(safeName),
      domain,
      clone: cloneResult,
    });
  } catch (err) {
    jsonError(res, 400, err.message);
  }
});

router.post('/:name/install', async (req, res) => {
  try {
    const { name } = req.params;
    const project = db.prepare('SELECT * FROM projects WHERE name = ?').get(name);
    if (!project) return jsonError(res, 404, 'Project not found');

    const { preset } = req.body;
    const allowed = ['npm install', 'pip install -r requirements.txt'];
    const cmd = allowed.includes(preset) ? preset : 'npm install';
    const parts = cmd.split(' ');
    const result = await runCommand(parts[0], parts.slice(1), {
      cwd: project.dir,
      timeout: 300000,
    });
    res.json(result);
  } catch (err) {
    jsonError(res, 400, err.message);
  }
});

router.post('/:name/start', async (req, res) => {
  try {
    const { name } = req.params;
    const project = db.prepare('SELECT * FROM projects WHERE name = ?').get(name);
    if (!project) return jsonError(res, 404, 'Project not found');
    if (!project.command) return jsonError(res, 400, 'No start command configured');

    const result = await pm2.startService(name, project.command, project.dir);
    await pm2.savePm2();
    res.json(result);
  } catch (err) {
    jsonError(res, 400, err.message);
  }
});

router.post('/:name/build', async (req, res) => {
  try {
    const { name } = req.params;
    const project = db.prepare('SELECT * FROM projects WHERE name = ?').get(name);
    if (!project) return jsonError(res, 404, 'Project not found');

    const result = await runCommand('npm', ['run', 'build'], {
      cwd: project.dir,
      timeout: 300000,
    });
    res.json(result);
  } catch (err) {
    jsonError(res, 400, err.message);
  }
});

router.delete('/:name', async (req, res) => {
  try {
    const { name } = req.params;
    sanitizeName(name, 'project');
    const project = db.prepare('SELECT * FROM projects WHERE name = ?').get(name);
    if (!project) return jsonError(res, 404, 'Project not found');

    await pm2.deleteService(name);
    if (fs.existsSync(project.dir)) {
      fs.rmSync(project.dir, { recursive: true, force: true });
    }
    db.prepare('DELETE FROM projects WHERE name = ?').run(name);
    db.prepare('DELETE FROM domains WHERE service_name = ?').run(name);
    await pm2.savePm2();

    res.json({ ok: true, deleted: name });
  } catch (err) {
    jsonError(res, 400, err.message);
  }
});

module.exports = router;
