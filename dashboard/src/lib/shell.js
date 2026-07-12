const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

async function runCommand(bin, args, options = {}) {
  const { timeout = 60000, cwd } = options;
  try {
    const { stdout, stderr } = await execFileAsync(bin, args, {
      timeout,
      cwd,
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env, PATH: process.env.PATH },
    });
    return { ok: true, stdout: stdout || '', stderr: stderr || '' };
  } catch (err) {
    return {
      ok: false,
      stdout: err.stdout || '',
      stderr: err.stderr || '',
      error: err.message,
      code: err.code,
    };
  }
}

function sanitizeName(name, type = 'general') {
  const patterns = {
    project: /^[a-z0-9][a-z0-9-_]{0,62}$/i,
    db: /^[a-z][a-z0-9_]{0,62}$/i,
    user: /^[a-z][a-z0-9_]{0,62}$/i,
    service: /^[a-z0-9][a-z0-9-_]{0,62}$/i,
    general: /^[a-z0-9][a-z0-9-_.]{0,127}$/i,
  };
  const pattern = patterns[type] || patterns.general;
  if (!pattern.test(name)) {
    throw new Error(`Invalid ${type} name: ${name}`);
  }
  return name;
}

function sanitizePort(port) {
  const p = parseInt(port, 10);
  if (Number.isNaN(p) || p < 1024 || p > 65535) {
    throw new Error(`Invalid port: ${port}`);
  }
  return p;
}

function sanitizeHostname(hostname, baseDomain) {
  const full = hostname.includes('.') ? hostname : `${hostname}.${baseDomain}`;
  const escaped = baseDomain.replace(/\./g, '\\.');
  const re = new RegExp(`^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\\.${escaped}$`, 'i');
  if (!re.test(full)) {
    throw new Error(`Invalid hostname: ${hostname}`);
  }
  return full.toLowerCase();
}

function generatePassword(length = 24) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let out = '';
  for (let i = 0; i < length; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

module.exports = {
  runCommand,
  sanitizeName,
  sanitizePort,
  sanitizeHostname,
  generatePassword,
};
