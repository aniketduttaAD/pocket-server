const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const path = require('path');
const config = require('./config');
const { requireAuth } = require('./middleware/auth');
const { ensureDirs } = require('./middleware/validate');
const { loginLimiter, apiLimiter } = require('./middleware/rateLimit');

const authRoutes = require('./routes/auth');
const servicesRoutes = require('./routes/services');
const projectsRoutes = require('./routes/projects');
const domainsRoutes = require('./routes/domains');
const databasesRoutes = require('./routes/databases');
const terminalRoutes = require('./routes/terminal');
const setupRoutes = require('./routes/setup');

ensureDirs();

const app = express();

if (config.trustProxy) {
  app.set('trust proxy', 1);
}

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'sha256-NcFubtw9DfouAiTFetFYhIuK3B/BtdXSA018Z+nA+Wk='", "https://static.cloudflareinsights.com"],
        scriptSrcAttr: ["'none'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'", "https://cloudflareinsights.com"],
        frameSrc: ["'none'"],
        objectSrc: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);

app.use(express.json({ limit: '2mb' }));
app.use(
  session({
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    name: 'ps.sid',
    cookie: {
      secure: !config.isDev,
      httpOnly: true,
      sameSite: config.isDev ? 'lax' : 'strict',
      maxAge: 24 * 60 * 60 * 1000,
    },
  })
);

app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

app.use('/api/auth/login', loginLimiter);
app.use('/api/auth', authRoutes);

app.use('/api', apiLimiter);
app.use('/api/services', requireAuth, servicesRoutes);
app.use('/api/projects', requireAuth, projectsRoutes);
app.use('/api/domains', requireAuth, domainsRoutes);
app.use('/api/databases', requireAuth, databasesRoutes);
app.use('/api/terminal', requireAuth, terminalRoutes);
app.use('/api/setup', requireAuth, setupRoutes);

app.get('/favicon.ico', (req, res) => {
  res.status(204).end();
});

app.use('/css', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  next();
}, express.static(path.join(__dirname, '..', 'public', 'css')));
app.use('/js', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  next();
}, express.static(path.join(__dirname, '..', 'public', 'js')));
app.get('/login.html', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(__dirname, '..', 'public', 'login.html'));
});

app.get('/', requireAuth, (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

app.listen(config.port, config.bindHost, () => {
  console.log(`Dashboard running on http://${config.bindHost}:${config.port}`);
  if (config.isDev) {
    console.log(`Login: ${config.adminUser} / (see .env)`);
  }
});
