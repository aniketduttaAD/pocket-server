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
const ROOT = path.resolve(process.env.MEDIA_ROOT || path.join(process.env.HOME || '', 'storage/shared'));
const USER = process.env.MEDIA_USER || 'admin';
const PASS = process.env.MEDIA_PASS || '';

const MIME = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp', '.ico': 'image/x-icon', '.avif': 'image/avif',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.m4v': 'video/x-m4v', '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
  '.flac': 'audio/flac', '.m4a': 'audio/mp4', '.aac': 'audio/aac',
  '.pdf': 'application/pdf', '.txt': 'text/plain', '.md': 'text/markdown',
  '.json': 'application/json', '.csv': 'text/csv',
};

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

function mimeType(filePath) {
  return MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

function fileKind(name) {
  const ext = path.extname(name).toLowerCase();
  if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.ico', '.avif'].includes(ext)) return 'image';
  if (['.mp4', '.webm', '.mov', '.m4v', '.mkv'].includes(ext)) return 'video';
  if (['.mp3', '.wav', '.ogg', '.flac', '.m4a', '.aac'].includes(ext)) return 'audio';
  if (ext === '.pdf') return 'pdf';
  if (['.txt', '.md', '.json', '.csv', '.log'].includes(ext)) return 'text';
  return 'file';
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function hrefPath(webPath) {
  return webPath.split('/').map((p) => encodeURIComponent(p)).join('/').replace(/^%2F/, '/');
}

const CSS = `
:root{--bg:#f8f9fb;--surface:#fff;--border:#e2e6ed;--text:#1a1d24;--muted:#6b7280;--accent:#2563eb;--radius:10px}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,-apple-system,sans-serif;background:var(--bg);color:var(--text);line-height:1.5;min-height:100vh}
a{color:var(--accent);text-decoration:none}
a:hover{text-decoration:underline}
.wrap{max-width:960px;margin:0 auto;padding:1rem 1.25rem 2rem}
.top{display:flex;align-items:center;gap:.75rem;margin-bottom:1.25rem;flex-wrap:wrap}
.top h1{font-size:1.0625rem;font-weight:600;flex:1;min-width:0;word-break:break-word}
.btn{display:inline-flex;align-items:center;gap:.35rem;padding:.45rem .8rem;border-radius:8px;font-size:.8125rem;font-weight:500;border:1px solid var(--border);background:var(--surface);color:var(--text);cursor:pointer;text-decoration:none}
.btn:hover{background:#f1f3f6;text-decoration:none}
.btn.primary{background:var(--accent);border-color:var(--accent);color:#fff}
.btn.primary:hover{background:#1d4ed8}
.breadcrumb{font-size:.8125rem;color:var(--muted);margin-bottom:1rem;word-break:break-all}
.breadcrumb a{color:var(--muted)}
.breadcrumb a:hover{color:var(--accent)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:.75rem}
.card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:.875rem;display:flex;flex-direction:column;gap:.5rem;transition:box-shadow .15s}
.card:hover{box-shadow:0 2px 8px rgba(0,0,0,.06)}
.card-icon{font-size:1.5rem;line-height:1}
.card-name{font-size:.875rem;font-weight:500;word-break:break-word}
.card-meta{font-size:.75rem;color:var(--muted)}
.card-actions{display:flex;gap:.375rem;flex-wrap:wrap;margin-top:auto}
.row{display:flex;align-items:center;gap:.75rem;padding:.625rem .875rem;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);margin-bottom:.5rem}
.row:hover{box-shadow:0 1px 4px rgba(0,0,0,.04)}
.row-icon{font-size:1.25rem;flex-shrink:0}
.row-info{flex:1;min-width:0}
.row-name{font-size:.875rem;font-weight:500;word-break:break-word}
.row-meta{font-size:.75rem;color:var(--muted)}
.row-actions{display:flex;gap:.375rem;flex-shrink:0}
.viewer{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;margin-bottom:1rem}
.viewer-toolbar{display:flex;align-items:center;gap:.5rem;padding:.75rem 1rem;border-bottom:1px solid var(--border);flex-wrap:wrap}
.viewer-toolbar h2{font-size:.9375rem;font-weight:600;flex:1;min-width:0;word-break:break-word}
.viewer-body{padding:1rem;display:flex;justify-content:center;align-items:center;background:#fafbfc;min-height:200px}
.viewer-body img{max-width:100%;max-height:75vh;height:auto;border-radius:6px}
.viewer-body video,.viewer-body audio{width:100%;max-width:100%;border-radius:6px;outline:none}
.viewer-body iframe,.viewer-body pre{width:100%;max-height:70vh;border:none;background:var(--surface);padding:1rem;border-radius:6px;overflow:auto;font-size:.8125rem}
.empty{text-align:center;padding:3rem 1rem;color:var(--muted)}
@media(max-width:600px){.grid{grid-template-columns:1fr}.row{flex-wrap:wrap}.row-actions{width:100%}}
`;

function pageShell(title, body, crumbs = '') {
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>${CSS}</style>
</head><body>
<div class="wrap">
${crumbs}
${body}
</div>
</body></html>`;
}

function breadcrumbs(webPath) {
  const parts = webPath.split('/').filter(Boolean);
  let html = '<nav class="breadcrumb"><a href="/">Home</a>';
  let acc = '';
  for (const p of parts) {
    acc += `/${encodeURIComponent(p)}`;
    html += ` / <a href="${acc}/">${esc(decodeURIComponent(p))}</a>`;
  }
  html += '</nav>';
  return html;
}

function kindIcon(kind) {
  if (kind === 'image') return '🖼';
  if (kind === 'video') return '🎬';
  if (kind === 'audio') return '🎵';
  if (kind === 'pdf') return '📕';
  if (kind === 'text') return '📝';
  return '📄';
}

function listDir(abs, webPath) {
  const entries = fs.readdirSync(abs, { withFileTypes: true });
  entries.sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const cards = [];
  const rows = [];

  if (webPath !== '/') {
    const parent = webPath.replace(/\/[^/]+\/?$/, '') || '/';
    rows.push(`<a class="row" href="${parent}"><span class="row-icon">⬆</span><span class="row-info"><span class="row-name">Parent folder</span></span></a>`);
  }

  for (const e of entries) {
    const name = e.name;
    const nextPath = `${webPath.replace(/\/$/, '')}/${encodeURIComponent(name)}`;
    if (e.isDirectory()) {
      rows.push(`<a class="row" href="${nextPath}/"><span class="row-icon">📁</span><span class="row-info"><span class="row-name">${esc(name)}</span><span class="row-meta">Folder</span></span></a>`);
      continue;
    }

    let size = '';
    try {
      size = formatSize(fs.statSync(path.join(abs, name)).size);
    } catch (_) { /* ignore */ }

    const kind = fileKind(name);
    const icon = kindIcon(kind);
    const canView = kind !== 'file';
    const viewBtn = canView
      ? `<a class="btn primary small" href="${nextPath}">View</a>`
      : '';
    const dlBtn = `<a class="btn small" href="${nextPath}?download=1">Download</a>`;

    cards.push(`<div class="card">
      <span class="card-icon">${icon}</span>
      <span class="card-name">${esc(name)}</span>
      <span class="card-meta">${size || 'File'}</span>
      <div class="card-actions">${viewBtn}${dlBtn}</div>
    </div>`);
  }

  const body = entries.length === 0 && webPath === '/'
    ? '<div class="empty"><p>No files yet</p></div>'
    : `${rows.join('')}<div class="grid">${cards.join('')}</div>`;

  const crumbs = breadcrumbs(webPath.endsWith('/') ? webPath.slice(0, -1) || '/' : webPath);
  return pageShell(`Media — ${webPath}`, `
<div class="top"><h1>${esc(decodeURIComponent(webPath === '/' ? 'Media' : webPath.split('/').filter(Boolean).pop() || 'Media'))}</h1></div>
${body}`, crumbs);
}

function viewerPage(abs, webPath, kind) {
  const name = path.basename(abs);
  const rawUrl = `${webPath}?raw=1`;
  const dlUrl = `${webPath}?download=1`;
  const parent = webPath.replace(/\/[^/]+$/, '') || '/';
  let media = '';

  if (kind === 'image') {
    media = `<img src="${rawUrl}" alt="${esc(name)}" loading="lazy">`;
  } else if (kind === 'video') {
    media = `<video controls playsinline preload="metadata" src="${rawUrl}">Your browser does not support video.</video>`;
  } else if (kind === 'audio') {
    media = `<audio controls preload="metadata" src="${rawUrl}">Your browser does not support audio.</audio>`;
  } else if (kind === 'pdf') {
    media = `<iframe src="${rawUrl}" title="${esc(name)}"></iframe>`;
  } else if (kind === 'text') {
    media = `<iframe src="${rawUrl}" title="${esc(name)}"></iframe>`;
  }

  const body = `
<div class="viewer">
  <div class="viewer-toolbar">
    <h2>${esc(name)}</h2>
    <a class="btn" href="${parent}">Back</a>
    <a class="btn primary" href="${dlUrl}">Download</a>
  </div>
  <div class="viewer-body">${media}</div>
</div>`;

  const dirPath = webPath.replace(/\/[^/]+$/, '') || '/';
  return pageShell(name, body, breadcrumbs(dirPath));
}

function serveFile(req, res, abs, download) {
  fs.stat(abs, (err, st) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }

    const type = mimeType(abs);
    const filename = path.basename(abs);
    const headers = {
      'Content-Type': type,
      'Accept-Ranges': 'bytes',
    };

    if (download) {
      headers['Content-Disposition'] = `attachment; filename="${filename.replace(/"/g, '')}"`;
    } else {
      headers['Content-Disposition'] = `inline; filename="${filename.replace(/"/g, '')}"`;
    }

    const range = req.headers.range;
    if (range && (type.startsWith('video/') || type.startsWith('audio/'))) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (m) {
        const start = m[1] ? parseInt(m[1], 10) : 0;
        const end = m[2] ? parseInt(m[2], 10) : st.size - 1;
        if (start >= st.size || end >= st.size) {
          res.writeHead(416, { 'Content-Range': `bytes */${st.size}` });
          return res.end();
        }
        headers['Content-Range'] = `bytes ${start}-${end}/${st.size}`;
        headers['Content-Length'] = end - start + 1;
        res.writeHead(206, headers);
        return fs.createReadStream(abs, { start, end }).pipe(res);
      }
    }

    headers['Content-Length'] = st.size;
    res.writeHead(200, headers);
    fs.createReadStream(abs).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  if (!authOk(req)) return send401(res);

  const u = new URL(req.url, `http://${HOST}`);
  const abs = safePath(u.pathname);
  if (!abs) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    return res.end('Forbidden');
  }

  const raw = u.searchParams.has('raw');
  const download = u.searchParams.has('download');

  fs.stat(abs, (err, st) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }

    if (st.isDirectory()) {
      const webPath = u.pathname.endsWith('/') ? u.pathname : `${u.pathname}/`;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(listDir(abs, webPath));
    }

    if (raw || download) {
      return serveFile(req, res, abs, download);
    }

    const kind = fileKind(path.basename(abs));
    if (kind === 'file') {
      return serveFile(req, res, abs, true);
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(viewerPage(abs, u.pathname, kind));
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Media server http://${HOST}:${PORT} root=${ROOT}`);
});
