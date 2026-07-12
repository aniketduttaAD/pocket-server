const fs = require('fs');
const path = require('path');
const config = require('../config');

const dataDir = config.paths.data;
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const storePath = path.join(dataDir, 'store.json');

const defaultStore = {
  projects: [],
  domains: [],
  databases: [],
};

function loadStore() {
  if (!fs.existsSync(storePath)) {
    return structuredClone(defaultStore);
  }
  try {
    return { ...defaultStore, ...JSON.parse(fs.readFileSync(storePath, 'utf8')) };
  } catch {
    return structuredClone(defaultStore);
  }
}

function saveStore(store) {
  fs.writeFileSync(storePath, JSON.stringify(store, null, 2));
}

function seedDomains(store) {
  if (store.domains.length > 0) return store;
  const target = config.tunnel.id
    ? `${config.tunnel.id}.cfargotunnel.com`
    : '<TUNNEL_ID>.cfargotunnel.com';
  store.domains = [
    {
      id: 1,
      hostname: `dash.${config.baseDomain}`,
      service_name: 'dash',
      port: 3000,
      status: 'pending',
      target,
      last_verified: null,
      created_at: new Date().toISOString(),
    },
    {
      id: 2,
      hostname: `media.${config.baseDomain}`,
      service_name: 'media',
      port: 8080,
      status: 'pending',
      target,
      last_verified: null,
      created_at: new Date().toISOString(),
    },
  ];
  return store;
}

let store = seedDomains(loadStore());
saveStore(store);

function nextId(list) {
  return list.length ? Math.max(...list.map((r) => r.id || 0)) + 1 : 1;
}

const db = {
  prepare(sql) {
    return {
      all(...params) {
        store = loadStore();
        if (sql.includes('FROM projects')) {
          return [...store.projects].sort((a, b) => a.name.localeCompare(b.name));
        }
        if (sql.includes('FROM domains')) {
          const sorted = [...store.domains];
          if (sql.includes('ORDER BY hostname')) sorted.sort((a, b) => a.hostname.localeCompare(b.hostname));
          if (sql.includes('ORDER BY created_at DESC')) sorted.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
          return sorted;
        }
        if (sql.includes('FROM databases')) {
          return [...store.databases].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        }
        return [];
      },
      get(...params) {
        store = loadStore();
        if (sql.includes('FROM projects WHERE name')) {
          return store.projects.find((p) => p.name === params[0]) || null;
        }
        if (sql.includes('FROM projects WHERE id')) {
          return store.projects.find((p) => p.id === params[0]) || null;
        }
        if (sql.includes('FROM domains WHERE hostname')) {
          return store.domains.find((d) => d.hostname === params[0]) || null;
        }
        if (sql.includes('SELECT id FROM projects WHERE name')) {
          const p = store.projects.find((x) => x.name === params[0]);
          return p ? { id: p.id } : null;
        }
        if (sql.includes('COUNT(*)')) {
          return { c: store.domains.length };
        }
        return null;
      },
      run(...params) {
        store = loadStore();
        if (sql.includes('INSERT INTO projects')) {
          const [name, type, dir, command, port, subdomain] = params;
          const existing = store.projects.find((p) => p.name === name);
          if (existing) {
            Object.assign(existing, { type, dir, command, port, subdomain, updated_at: new Date().toISOString() });
            saveStore(store);
            return { lastInsertRowid: existing.id };
          }
          const row = {
            id: nextId(store.projects),
            name,
            type,
            dir,
            command,
            port,
            subdomain,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
          store.projects.push(row);
          saveStore(store);
          return { lastInsertRowid: row.id };
        }
        if (sql.includes('UPDATE projects SET')) {
          const [type, dir, command, port, subdomain, name] = params;
          const p = store.projects.find((x) => x.name === name);
          if (p) Object.assign(p, { type, dir, command, port, subdomain, updated_at: new Date().toISOString() });
          saveStore(store);
          return {};
        }
        if (sql.includes('DELETE FROM projects WHERE name')) {
          store.projects = store.projects.filter((p) => p.name !== params[0]);
          saveStore(store);
          return {};
        }
        if (sql.includes('INSERT OR REPLACE INTO domains') || sql.includes('INSERT INTO domains')) {
          const [hostname, service_name, port, target, status] = params;
          const existing = store.domains.find((d) => d.hostname === hostname);
          if (existing) {
            Object.assign(existing, { service_name, port, target, status: status || existing.status });
          } else {
            store.domains.push({
              id: nextId(store.domains),
              hostname,
              service_name,
              port,
              target,
              status: status || 'pending',
              last_verified: null,
              created_at: new Date().toISOString(),
            });
          }
          saveStore(store);
          return {};
        }
        if (sql.includes('UPDATE domains SET status')) {
          const [status, hostname] = params;
          const d = store.domains.find((x) => x.hostname === hostname);
          if (d) {
            d.status = status;
            d.last_verified = new Date().toISOString();
          }
          saveStore(store);
          return {};
        }
        if (sql.includes('DELETE FROM domains WHERE service_name')) {
          store.domains = store.domains.filter((d) => d.service_name !== params[0]);
          saveStore(store);
          return {};
        }
        if (sql.includes('INSERT OR REPLACE INTO databases') || sql.includes('INSERT INTO databases')) {
          const [dbname, username, password_enc, connection_url] = params;
          const existing = store.databases.find((d) => d.dbname === dbname);
          if (existing) {
            Object.assign(existing, { username, password_enc, connection_url });
          } else {
            store.databases.push({
              id: nextId(store.databases),
              dbname,
              username,
              password_enc,
              connection_url,
              created_at: new Date().toISOString(),
            });
          }
          saveStore(store);
          return {};
        }
        if (sql.includes('DELETE FROM databases WHERE dbname')) {
          store.databases = store.databases.filter((d) => d.dbname !== params[0]);
          saveStore(store);
          return {};
        }
        saveStore(store);
        return {};
      },
    };
  },
};

module.exports = db;
