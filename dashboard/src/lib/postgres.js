const { runCommand } = require('./shell');
const config = require('../config');
const ngrok = require('./ngrok');

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

async function resolveRemoteEndpoint() {
  if (config.database.remoteMode === 'ngrok') {
    const endpoint = await ngrok.getTcpEndpoint();
    if (endpoint.ok) {
      return { host: endpoint.host, port: endpoint.port, mode: 'ngrok' };
    }
    throw new Error(endpoint.error || 'ngrok TCP tunnel is not running');
  }

  return {
    host: config.database.publicHost,
    port: config.database.publicPort,
    mode: config.database.remoteMode,
  };
}

async function buildConnectionUrls(username, password, dbname) {
  const encPass = encodeURIComponent(password);
  const localHost = config.postgres.host;
  const localPort = config.postgres.port;
  const remote = await resolveRemoteEndpoint();

  const localConnectionUrl =
    `postgresql://${username}:${encPass}@${localHost}:${localPort}/${dbname}`;
  const remoteConnectionUrl =
    `postgresql://${username}:${encPass}@${remote.host}:${remote.port}/${dbname}?sslmode=prefer`;

  return {
    connectionUrl: remoteConnectionUrl,
    remoteConnectionUrl,
    localConnectionUrl,
    host: remote.host,
    remotePort: remote.port,
    remoteMode: remote.mode,
    provider: 'postgres',
  };
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

  const schemaSql = `GRANT ALL ON SCHEMA public TO ${username};`;
  await runCommand('psql', [...psqlArgs(), '-d', dbname, '-c', schemaSql]);

  const urls = await buildConnectionUrls(username, password, dbname);
  return { ok: true, dbname, username, password, ...urls };
}

async function deleteDatabase(dbname, username) {
  const safeDb = dbname.replace(/'/g, "''");
  const safeUser = username ? username.replace(/'/g, "''") : null;

  const terminateSql = `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${safeDb}';`;
  await runCommand('psql', [...psqlArgs(), '-c', terminateSql]);

  const drop = await runCommand('dropdb', [...psqlBaseArgs(), dbname]);
  if (!drop.ok && !drop.stderr?.includes('does not exist')) {
    return { ok: false, error: drop.error || drop.stderr };
  }

  if (safeUser) {
    const dropRoleSql = `DROP ROLE IF EXISTS ${username};`;
    await runCommand('psql', [...psqlArgs(), '-c', dropRoleSql]);
  }

  return { ok: true };
}

module.exports = {
  listDatabases,
  createDatabase,
  deleteDatabase,
  buildConnectionUrls,
  resolveRemoteEndpoint,
};
