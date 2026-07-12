const { runCommand } = require('./shell');
const config = require('../config');

function psqlBaseArgs() {
  const args = [];
  if (config.postgres.host) args.push('-h', config.postgres.host);
  if (config.postgres.port) args.push('-p', String(config.postgres.port));
  if (config.postgres.user) args.push('-U', config.postgres.user);
  return args;
}

function psqlArgs() {
  return [...psqlBaseArgs(), '-d', config.postgres.database];
}

async function listDatabases() {
  const result = await runCommand('psql', [...psqlArgs(), '-l'], { timeout: 15000 });
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
  const createDb = await runCommand('createdb', [...psqlBaseArgs(), dbname]);
  if (!createDb.ok && !createDb.stderr.includes('already exists')) {
    return { ok: false, error: createDb.error || createDb.stderr };
  }

  const createUserSql = `CREATE USER ${username} WITH PASSWORD '${password.replace(/'/g, "''")}';`;
  const createUser = await runCommand('psql', [...psqlArgs(), '-c', createUserSql]);
  if (!createUser.ok && !createUser.stderr.includes('already exists')) {
    return { ok: false, error: createUser.error || createUser.stderr };
  }

  const grantSql = `GRANT ALL PRIVILEGES ON DATABASE ${dbname} TO ${username};`;
  const grant = await runCommand('psql', [...psqlArgs(), '-c', grantSql]);
  if (!grant.ok) {
    return { ok: false, error: grant.error || grant.stderr };
  }

  const url = `postgresql://${username}:${encodeURIComponent(password)}@${config.postgres.host}:${config.postgres.port}/${dbname}`;
  return { ok: true, dbname, username, password, connectionUrl: url };
}

async function deleteDatabase(dbname) {
  const terminateSql = `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${dbname.replace(/'/g, "''")}';`;
  await runCommand('psql', [...psqlArgs(), '-c', terminateSql]);
  const drop = await runCommand('dropdb', [...psqlBaseArgs(), dbname]);
  return drop;
}

module.exports = {
  listDatabases,
  createDatabase,
  deleteDatabase,
};
