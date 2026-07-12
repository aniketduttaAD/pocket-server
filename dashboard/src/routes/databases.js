const express = require('express');
const db = require('../lib/db');
const postgres = require('../lib/postgres');
const cloudflared = require('../lib/cloudflared');
const config = require('../config');
const { sanitizeName, generatePassword } = require('../lib/shell');
const { jsonError } = require('../middleware/validate');

const router = express.Router();

function persistDatabaseRow(row) {
  db.prepare(
    `INSERT OR REPLACE INTO databases (dbname, username, password_enc, connection_url, local_connection_url, host, provider)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    row.dbname,
    row.username,
    row.password_enc,
    row.connection_url,
    row.local_connection_url,
    row.host,
    row.provider || 'postgres'
  );
}

function enrichStoredRow(row) {
  if (!row?.password_enc || !row.username || !row.dbname) {
    return publicDatabaseRow(row);
  }

  const urls = postgres.buildConnectionUrls(row.username, row.password_enc, row.dbname);
  const needsUpdate =
    !row.local_connection_url ||
    !row.connection_url ||
    row.host !== urls.host ||
    row.connection_url !== urls.remoteConnectionUrl;

  if (needsUpdate) {
    row.connection_url = urls.remoteConnectionUrl;
    row.local_connection_url = urls.localConnectionUrl;
    row.host = urls.host;
    persistDatabaseRow(row);
  }

  return publicDatabaseRow(row);
}

function publicDatabaseRow(row) {
  if (!row) return row;
  const { password_enc, ...safe } = row;
  return safe;
}

router.get('/status', async (req, res) => {
  const pg = await postgres.listDatabases();
  const tailscale = config.database.remoteMode === 'tailscale';
  res.json({
    ok: pg.ok,
    provider: 'postgres',
    publicHost: config.database.publicHost,
    publicPort: config.database.publicPort,
    remoteMode: config.database.remoteMode,
    tunnelConfigured: tailscale || cloudflared.dbTunnelConfigured(),
    postgres: pg.ok,
    error: pg.error || null,
  });
});

router.get('/', async (req, res) => {
  const raw = db
    .prepare('SELECT id, dbname, username, connection_url, local_connection_url, host, provider, created_at FROM databases ORDER BY created_at DESC')
    .all();

  const stored = raw.map((row) => enrichStoredRow(row));

  let live = { ok: false, databases: [] };
  try {
    live = await postgres.listDatabases();
  } catch (err) {
    live = { ok: false, error: err.message, databases: [] };
  }

  const tailscale = config.database.remoteMode === 'tailscale';
  res.json({
    stored,
    live,
    provider: 'postgres',
    publicHost: config.database.publicHost,
    publicPort: config.database.publicPort,
    remoteMode: config.database.remoteMode,
    tunnelConfigured: tailscale || cloudflared.dbTunnelConfigured(),
    usage: {
      remote: tailscale
        ? `Tailscale — connect directly to ${config.database.publicHost}:${config.database.publicPort}`
        : `Cloudflare — run cloudflared access tcp on client, then connect locally`,
      local: 'Apps on this phone — use 127.0.0.1 URL',
    },
  });
});

router.post('/create', async (req, res) => {
  try {
    const pgCheck = await postgres.listDatabases();
    if (!pgCheck.ok) {
      return jsonError(res, 503, pgCheck.error || 'PostgreSQL is not running on this phone');
    }

    if (config.database.remoteMode !== 'tailscale') {
      await cloudflared.ensureDbTunnel();
    }

    let { dbname, username, password } = req.body;
    dbname = sanitizeName(dbname, 'db');
    username = sanitizeName(username || dbname, 'user');
    password = password || generatePassword();

    const result = await postgres.createDatabase(dbname, username, password);
    if (!result.ok) {
      return jsonError(res, 500, result.error || 'Failed to create database');
    }

    persistDatabaseRow({
      dbname,
      username,
      password_enc: result.password,
      connection_url: result.connectionUrl,
      local_connection_url: result.localConnectionUrl,
      host: result.host,
      provider: 'postgres',
    });

    res.json({
      ok: true,
      dbname,
      username,
      password: result.password,
      host: result.host,
      provider: 'postgres',
      connectionUrl: result.connectionUrl,
      connection_url: result.connectionUrl,
      remoteConnectionUrl: result.remoteConnectionUrl,
      localConnectionUrl: result.localConnectionUrl,
      local_connection_url: result.localConnectionUrl,
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
