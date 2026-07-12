const express = require('express');
const db = require('../lib/db');
const postgres = require('../lib/postgres');
const ngrok = require('../lib/ngrok');
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

async function enrichStoredRow(row) {
  if (!row?.password_enc || !row.username || !row.dbname) {
    return publicDatabaseRow(row);
  }

  try {
    const urls = await postgres.buildConnectionUrls(row.username, row.password_enc, row.dbname);
    const needsUpdate =
      config.database.remoteMode === 'ngrok' ||
      !row.local_connection_url ||
      !row.connection_url ||
      row.host !== urls.host ||
      row.connection_url !== urls.remoteConnectionUrl;

    row.connection_url = urls.remoteConnectionUrl;
    row.local_connection_url = urls.localConnectionUrl;
    row.host = urls.host;
    row.remote_port = urls.remotePort;
    delete row.remote_error;

    if (needsUpdate) {
      persistDatabaseRow(row);
    }
  } catch (err) {
    row.remote_error = err.message;
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
  const ngrokStatus = await ngrok.getStatus();
  res.json({
    ok: pg.ok,
    provider: 'postgres',
    publicHost: ngrokStatus.host || config.database.publicHost,
    publicPort: ngrokStatus.port || config.database.publicPort,
    remoteMode: config.database.remoteMode,
    ngrok: ngrokStatus,
    tunnelConfigured: ngrok.remoteReady(ngrokStatus),
    postgres: pg.ok,
    error: pg.error || null,
  });
});

router.get('/', async (req, res) => {
  const raw = db
    .prepare('SELECT id, dbname, username, connection_url, local_connection_url, host, provider, created_at FROM databases ORDER BY created_at DESC')
    .all();

  const stored = await Promise.all(raw.map((row) => enrichStoredRow(row)));

  let live = { ok: false, databases: [] };
  try {
    live = await postgres.listDatabases();
  } catch (err) {
    live = { ok: false, error: err.message, databases: [] };
  }

  const ngrokStatus = await ngrok.getStatus();
  res.json({
    stored,
    live,
    provider: 'postgres',
    publicHost: ngrokStatus.host || config.database.publicHost,
    publicPort: ngrokStatus.port || config.database.publicPort,
    remoteMode: config.database.remoteMode,
    ngrok: ngrokStatus,
    tunnelConfigured: ngrok.remoteReady(ngrokStatus),
    ngrokSync: config.database.remoteMode === 'ngrok'
      ? 'Remote URLs refresh from live ngrok endpoint on each load (every 20s on Databases tab)'
      : null,
    usage: {
      remote: config.database.remoteMode === 'ngrok'
        ? `Standalone URL via ngrok — connect from anywhere to ${ngrokStatus.host || 'ngrok host'}:${ngrokStatus.port || 'port'}`
        : 'Enable NGROK_ENABLED=true for standalone remote URLs',
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

    if (config.database.remoteMode === 'ngrok') {
      const ngrokStatus = await ngrok.getStatus();
      if (!ngrok.remoteReady(ngrokStatus)) {
        return jsonError(res, 503, ngrokStatus.error || 'Start ngrok: pm2 restart ngrok-db');
      }
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
