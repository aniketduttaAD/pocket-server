const path = require('path');
const fs = require('fs');
const config = require('../config');

function ensureDirs() {
  for (const dir of [
    config.paths.frontend,
    config.paths.backend,
    config.paths.uploads,
    config.paths.data,
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function safeProjectPath(type, name) {
  const base = type === 'frontend' ? config.paths.frontend : config.paths.backend;
  const resolved = path.resolve(base, name);
  if (!resolved.startsWith(path.resolve(base))) {
    throw new Error('Path traversal detected');
  }
  return resolved;
}

function jsonError(res, status, message) {
  return res.status(status).json({ error: message });
}

module.exports = {
  ensureDirs,
  safeProjectPath,
  jsonError,
};
