const express = require('express');
const db = require('../lib/db');
const postgres = require('../lib/postgres');
const { sanitizeName, generatePassword } = require('../lib/shell');
const { jsonError } = require('../middleware/validate');

const router = express.Router();

router.get('/', async (req, res) => {
  const stored = db.prepare('SELECT id, dbname, username, connection_url, created_at FROM databases ORDER BY created_at DESC').all();
  const live = await postgres.listDatabases();
  res.json({ stored, live });
});

router.post('/create', async (req, res) => {
  try {
    let { dbname, username, password } = req.body;
    dbname = sanitizeName(dbname, 'db');
    username = sanitizeName(username || dbname, 'user');
    password = password || generatePassword();

    const result = await postgres.createDatabase(dbname, username, password);
    if (!result.ok) {
      return jsonError(res, 500, result.error || 'Failed to create database');
    }

    db.prepare(
      `INSERT OR REPLACE INTO databases (dbname, username, password_enc, connection_url)
       VALUES (?, ?, ?, ?)`
    ).run(dbname, username, password, result.connectionUrl);

    res.json({
      ok: true,
      dbname,
      username,
      password,
      connectionUrl: result.connectionUrl,
    });
  } catch (err) {
    jsonError(res, 400, err.message);
  }
});

router.delete('/:dbname', async (req, res) => {
  try {
    const dbname = sanitizeName(req.params.dbname, 'db');
    const result = await postgres.deleteDatabase(dbname);
    db.prepare('DELETE FROM databases WHERE dbname = ?').run(dbname);
    res.json(result);
  } catch (err) {
    jsonError(res, 400, err.message);
  }
});

module.exports = router;
