const express = require('express');
const db = require('../lib/db');
const postgres = require('../lib/postgres');
const cloudflared = require('../lib/cloudflared');
const config = require('../config');
const { sanitizeName, generatePassword } = require('../lib/shell');
const { jsonError } = require('../middleware/validate');

const router = express.Router();

router.get('/status', async (req, res) => {
  const pg = await postgres.listDatabases();
  res.json({
    ok: pg.ok,
    provider: 'postgres',
    publicHost: config.database.publicHost,
    publicPort: config.database.publicPort,
    tunnelConfigured: cloudflared.dbTunnelConfigured(),
    postgres: pg.ok,
    error: pg.error || null,
  });
});

router.get('/', async (req, res) => {
  const stored = db
    .prepare('SELECT id, dbname, username, connection_url, local_connection_url, host, provider, created_at FROM databases ORDER BY created_at DESC')
    .all();

  let live = { ok: false, databases: [] };
  try {
    live = await postgres.listDatabases();
  } catch (err) {
    live = { ok: false, error: err.message, databases: [] };
  }

  res.json({
    stored,
    live,
    provider: 'postgres',
    publicHost: config.database.publicHost,
    publicPort: config.database.publicPort,
    tunnelConfigured: cloudflared.dbTunnelConfigured(),
    usage: {
      remote: `Apps on Mac, Vercel, etc. — use the remote URL (${config.database.publicHost})`,
      local: 'Apps running on this phone — use the local URL (127.0.0.1) for lower latency',
    },
  });
});

router.post('/create', async (req, res) => {
  try {
    const pgCheck = await postgres.listDatabases();
    if (!pgCheck.ok) {
      return jsonError(res, 503, pgCheck.error || 'PostgreSQL is not running on this phone');
    }

    await cloudflared.ensureDbTunnel();

    let { dbname, username, password } = req.body;
    dbname = sanitizeName(dbname, 'db');
    username = sanitizeName(username || dbname, 'user');
    password = password || generatePassword();

    const result = await postgres.createDatabase(dbname, username, password);
    if (!result.ok) {
      return jsonError(res, 500, result.error || 'Failed to create database');
    }

    db.prepare(
      `INSERT OR REPLACE INTO databases (dbname, username, password_enc, connection_url, local_connection_url, host, provider)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      dbname,
      username,
      result.password,
      result.connectionUrl,
      result.localConnectionUrl,
      result.host,
      'postgres'
    );

    res.json({
      ok: true,
      dbname,
      username,
      password: result.password,
      host: result.host,
      provider: 'postgres',
      connectionUrl: result.connectionUrl,
      remoteConnectionUrl: result.remoteConnectionUrl,
      localConnectionUrl: result.localConnectionUrl,
    });
  } catch (err) {
    jsonError(res, 400, err.message);
  }
});

router.delete('/:dbname', async (req, res) => {
  try {
    const dbname = sanitizeName(req.params.dbname, 'db');
    const row = db.prepare('SELECT username FROM databases WHERE dbname = ?').get(dbname);
    const result = await postgres.deleteDatabase(dbname, row?.username);
    db.prepare('DELETE FROM databases WHERE dbname = ?').run(dbname);
    res.json(result);
  } catch (err) {
    jsonError(res, 400, err.message);
  }
});

module.exports = router;
