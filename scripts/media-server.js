#!/usr/bin/env node
/**
 * Lightweight media file server for Termux (127.0.0.1 only).
 * Env: MEDIA_HOST, MEDIA_PORT, MEDIA_ROOT, MEDIA_USER, MEDIA_PASS
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const HOST = process.env.MEDIA_HOST || '127.0.0.1';
const PORT = parseInt(process.env.MEDIA_PORT || '8080', 10);
const ROOT = path.resolve(process.env.MEDIA_ROOT || '/storage/emulated/0');
const USER = process.env.MEDIA_USER || 'admin';
const PASS = process.env.MEDIA_PASS || '';

if (!PASS) {
  console.error('MEDIA_PASS is required');
  process.exit(1);
}

function authOk(req) {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Basic ')) return false;
  const decoded = Buffer.from(h.slice(6), 'base64').toString();
  const i = decoded.indexOf(':');
  if (i < 0) return false;
  return decoded.slice(0, i) === USER && decoded.slice(i + 1) === PASS;
}

function send401(res) {
  res.writeHead(401, {
    'WWW-Authenticate': 'Basic realm="Media"',
    'Content-Type': 'text/plain; charset=utf-8',
  });
  res.end('Authentication required');
}

function safePath(reqPath) {
  const decoded = decodeURIComponent(reqPath.split('?')[0]);
  const joined = path.normalize(path.join(ROOT, decoded.replace(/^\//, '')));
  if (!joined.startsWith(ROOT)) return null;
  return joined;
}

function htmlPage(title, body) {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
body{font-family:system-ui,sans-serif;margin:1rem;background:#111;color:#eee}
a{color:#6cf;text-decoration:none;display:block;padding:.35rem 0}
a:hover{text-decoration:underline}
header{margin-bottom:1rem;font-size:.9rem;color:#aaa}
</style></head><body>
<header>${title}</header>
${body}
</body></html>`;
}

function listDir(abs, webPath) {
  const entries = fs.readdirSync(abs, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  let items = '';
  if (webPath !== '/') {
    const parent = webPath.replace(/\/[^/]+\/?$/, '') || '/';
    items += `<a href="${parent}">../</a>`;
  }
  for (const e of entries) {
    const next = `${webPath.replace(/\/$/, '')}/${encodeURIComponent(e.name)}`;
    items += `<a href="${next}">${e.isDirectory() ? '📁 ' : '📄 '}${e.name}</a>`;
  }
  return htmlPage(`Media — ${webPath}`, items);
}

const server = http.createServer((req, res) => {
  if (!authOk(req)) return send401(res);

  const u = new URL(req.url, `http://${HOST}`);
  const abs = safePath(u.pathname);
  if (!abs) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    return res.end('Forbidden');
  }

  fs.stat(abs, (err, st) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    if (st.isDirectory()) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(listDir(abs, u.pathname.endsWith('/') ? u.pathname : `${u.pathname}/`));
    }
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${path.basename(abs)}"`,
    });
    fs.createReadStream(abs).pipe(res);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Media server http://${HOST}:${PORT} root=${ROOT}`);
});
