const bcrypt = require('bcryptjs');
const config = require('../config');

function requireAuth(req, res, next) {
  if (req.session?.authenticated) {
    return next();
  }
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  return res.redirect('/login.html');
}

async function verifyLogin(username, password) {
  if (username !== config.adminUser) return false;
  const stored = config.adminPassword;
  if (stored.startsWith('$2')) {
    return bcrypt.compare(password, stored);
  }
  return password === stored;
}

function hashPassword(password) {
  return bcrypt.hashSync(password, 10);
}

module.exports = {
  requireAuth,
  verifyLogin,
  hashPassword,
};
