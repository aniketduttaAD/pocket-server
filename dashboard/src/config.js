require('dotenv').config();
const path = require('path');
const os = require('os');

const isDev = process.env.NODE_ENV !== 'production';
const homeDir = process.env.HOME_DIR || os.homedir();

module.exports = {
  port: parseInt(process.env.PORT || '3000', 10),
  bindHost: process.env.BIND_HOST || (isDev ? '0.0.0.0' : '127.0.0.1'),
  sessionSecret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  adminUser: process.env.ADMIN_USER || 'admin',
  adminPassword: process.env.ADMIN_PASSWORD || 'changeme',
  isDev,
  trustProxy: process.env.TRUST_PROXY === 'true' || !isDev,
  rateLimit: {
    loginMax: parseInt(process.env.RATE_LIMIT_LOGIN_MAX || '5', 10),
    loginWindowMs: parseInt(process.env.RATE_LIMIT_LOGIN_WINDOW_MS || '900000', 10),
    apiMax: parseInt(process.env.RATE_LIMIT_API_MAX || '100', 10),
    apiWindowMs: parseInt(process.env.RATE_LIMIT_API_WINDOW_MS || '60000', 10),
  },
  paths: {
    home: homeDir,
    frontend: process.env.PROJECTS_FRONTEND || path.join(homeDir, 'projects', 'frontend'),
    backend: process.env.PROJECTS_BACKEND || path.join(homeDir, 'projects', 'backend'),
    uploads: process.env.UPLOADS_DIR || path.join(homeDir, 'uploads'),
    data: path.join(__dirname, '..', 'data'),
    cloudflaredBin: process.env.CLOUDFLARED_BIN || path.join(homeDir, 'cloudflared'),
    cloudflaredConfig: process.env.CLOUDFLARED_CONFIG || path.join(homeDir, '.cloudflared', 'config.yml'),
  },
  tunnel: {
    name: process.env.TUNNEL_NAME || 'phone-tunnel',
    id: process.env.TUNNEL_ID || '',
  },
  baseDomain: process.env.BASE_DOMAIN || 'aniketdutta.space',
  postgres: {
    dataDir: process.env.PGDATA || path.join(homeDir, 'postgres-data'),
    host: process.env.PGHOST || '127.0.0.1',
    port: parseInt(process.env.PGPORT || '5432', 10),
    user: process.env.PGUSER || null,
  },
  projects: {
    portStart: parseInt(process.env.PROJECT_PORT_START || '3001', 10),
    portEnd: parseInt(process.env.PROJECT_PORT_END || '3999', 10),
    reservedPorts: (process.env.RESERVED_PORTS || '3000,5432,8080')
      .split(',')
      .map((p) => parseInt(p.trim(), 10))
      .filter((p) => !Number.isNaN(p)),
  },
  allowlist: {
    commands: [
      'npm install',
      'npm run build',
      'npm start',
      'npm run dev',
      'pip install -r requirements.txt',
      'python -m pip install -r requirements.txt',
    ],
  },
  upload: {
    maxSizeMb: parseInt(process.env.UPLOAD_MAX_MB || '100', 10),
    allowedExtensions: ['.zip'],
  },
};
