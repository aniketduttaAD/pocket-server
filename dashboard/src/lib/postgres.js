const { runCommand } = require('./shell');
const config = require('../config');

async function listDatabases() {
  const result = await runCommand('psql', ['-l'], { timeout: 15000 });
  if (!result.ok) {
    return { ok: false, error: result.error || result.stderr, databases: [] };
  }

  const lines = result.stdout.split('\n').slice(4);
  const databases = [];
  for (const line of lines) {
    if (!line.trim() || line.startsWith('(')) break;
    const parts = line.split('|').map((p) => p.trim());
    if (parts[0] && !['template0', 'template1', 'postgres'].includes(parts[0])) {
      databases.push({ name: parts[0], owner: parts[1] });
    }
  }
  return { ok: true, databases };
}

async function createDatabase(dbname, username, password) {
  const createDb = await runCommand('createdb', [dbname]);
  if (!createDb.ok && !createDb.stderr.includes('already exists')) {
    return { ok: false, error: createDb.error || createDb.stderr };
  }

  const createUserSql = `CREATE USER ${username} WITH PASSWORD '${password.replace(/'/g, "''")}';`;
  const createUser = await runCommand('psql', ['-c', createUserSql]);
  if (!createUser.ok && !createUser.stderr.includes('already exists')) {
    return { ok: false, error: createUser.error || createUser.stderr };
  }

  const grantSql = `GRANT ALL PRIVILEGES ON DATABASE ${dbname} TO ${username};`;
  const grant = await runCommand('psql', ['-c', grantSql]);
  if (!grant.ok) {
    return { ok: false, error: grant.error || grant.stderr };
  }

  const url = `postgresql://${username}:${encodeURIComponent(password)}@${config.postgres.host}:${config.postgres.port}/${dbname}`;
  return { ok: true, dbname, username, password, connectionUrl: url };
}

async function deleteDatabase(dbname) {
  const terminateSql = `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${dbname.replace(/'/g, "''")}';`;
  await runCommand('psql', ['-c', terminateSql]);
  const drop = await runCommand('dropdb', [dbname]);
  return drop;
}

module.exports = {
  listDatabases,
  createDatabase,
  deleteDatabase,
};
