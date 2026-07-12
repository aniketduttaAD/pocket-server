#!/usr/bin/env node
/**
 * Media library for Termux (127.0.0.1 only).
 * Env: MEDIA_HOST, MEDIA_PORT, MEDIA_ROOT, MEDIA_USER, MEDIA_PASS, MEDIA_MAX_UPLOAD_MB (default 10240)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { execFile } = require('child_process');
const { pipeline } = require('stream/promises');
const crypto = require('crypto');
const os = require('os');

const HOST = process.env.MEDIA_HOST || '127.0.0.1';
const PORT = parseInt(process.env.MEDIA_PORT || '8080', 10);
const ROOT = path.resolve(process.env.MEDIA_ROOT || path.join(process.env.HOME || '', 'storage/shared'));
const USER = process.env.MEDIA_USER || 'admin';
const PASS = process.env.MEDIA_PASS || '';
const MAX_UPLOAD_BYTES = parseInt(process.env.MEDIA_MAX_UPLOAD_MB || '10240', 10) * 1024 * 1024;
const CHUNK_SIZE = 48 * 1024 * 1024; // stay under Cloudflare ~100MB per request
const UPLOAD_TMP = path.join(os.tmpdir(), 'media-uploads');

fs.mkdirSync(UPLOAD_TMP, { recursive: true });

const MIME = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp', '.ico': 'image/x-icon', '.avif': 'image/avif',
  '.heic': 'image/heic', '.heif': 'image/heif',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.m4v': 'video/x-m4v', '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
  '.flac': 'audio/flac', '.m4a': 'audio/mp4', '.aac': 'audio/aac',
  '.pdf': 'application/pdf', '.txt': 'text/plain', '.md': 'text/markdown',
  '.json': 'application/json', '.csv': 'text/csv', '.zip': 'application/zip',
};

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.ico', '.avif', '.heic', '.heif']);
const VIDEO_EXT = new Set(['.mp4', '.webm', '.mov', '.m4v', '.mkv', '.avi']);
const AUDIO_EXT = new Set(['.mp3', '.wav', '.ogg', '.flac', '.m4a', '.aac']);
const DOC_EXT = new Set(['.pdf', '.txt', '.md', '.json', '.csv']);

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

function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
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
  if (IMAGE_EXT.has(ext)) return 'image';
  if (VIDEO_EXT.has(ext)) return 'video';
  if (AUDIO_EXT.has(ext)) return 'audio';
  if (ext === '.pdf') return 'pdf';
  if (DOC_EXT.has(ext)) return 'text';
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

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('Payload too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function parseMultipart(buffer, boundary) {
  const delim = Buffer.from(`--${boundary}`);
  const parts = [];
  let start = buffer.indexOf(delim) + delim.length + 2;

  while (start < buffer.length) {
    const end = buffer.indexOf(delim, start);
    if (end === -1) break;
    const part = buffer.slice(start, end - 2);
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd === -1) break;
    const headers = part.slice(0, headerEnd).toString();
    const body = part.slice(headerEnd + 4);
    const nameMatch = /name="([^"]+)"/.exec(headers);
    const fileMatch = /filename="([^"]+)"/.exec(headers);
    if (nameMatch) {
      parts.push({
        name: nameMatch[1],
        filename: fileMatch ? path.basename(fileMatch[1]) : null,
        data: body,
      });
    }
    start = end + delim.length + 2;
  }
  return parts;
}

function uniqueName(dir, name) {
  const ext = path.extname(name);
  const base = path.basename(name, ext);
  let candidate = name;
  let n = 1;
  while (fs.existsSync(path.join(dir, candidate))) {
    candidate = `${base} (${n})${ext}`;
    n += 1;
  }
  return candidate;
}

function sanitizeFilename(name) {
  const base = path.basename(name).replace(/[^\w.\- ()[\]]+/g, '_');
  return base && !base.startsWith('.') ? base : null;
}

function streamToFile(req, targetPath, maxBytes) {
  return new Promise((resolve, reject) => {
    let received = 0;
    let aborted = false;
    const ws = fs.createWriteStream(targetPath);

    const fail = (err) => {
      if (aborted) return;
      aborted = true;
      req.destroy();
      ws.destroy();
      fs.unlink(targetPath, () => {});
      reject(err);
    };

    req.on('data', (chunk) => {
      received += chunk.length;
      if (received > maxBytes) {
        fail(new Error('File exceeds upload limit'));
      }
    });
    req.on('error', fail);
    ws.on('error', fail);
    ws.on('finish', () => {
      if (!aborted) resolve(received);
    });

    req.pipe(ws);
  });
}

function handleStreamUpload(req, res, absDir, filename) {
  const safeName = sanitizeFilename(filename);
  if (!safeName) {
    return sendJson(res, 400, { error: 'Invalid filename' });
  }

  const finalName = uniqueName(absDir, safeName);
  const target = path.join(absDir, finalName);
  if (!target.startsWith(ROOT)) {
    return sendJson(res, 403, { error: 'Forbidden path' });
  }

  const cl = parseInt(req.headers['content-length'] || '0', 10);
  if (cl > MAX_UPLOAD_BYTES) {
    return sendJson(res, 413, { error: `Max upload size is ${formatSize(MAX_UPLOAD_BYTES)}` });
  }

  streamToFile(req, target, MAX_UPLOAD_BYTES)
    .then((size) => sendJson(res, 200, { ok: true, name: finalName, size }))
    .catch((err) => {
      if (err.message.includes('limit')) {
        return sendJson(res, 413, { error: err.message });
      }
      sendJson(res, 500, { error: err.message || 'Upload failed' });
    });
}

function uploadManifestPath(uploadId) {
  return path.join(UPLOAD_TMP, uploadId, 'manifest.json');
}

function uploadChunkDir(uploadId) {
  return path.join(UPLOAD_TMP, uploadId);
}

async function handleUploadInit(req, res) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    return sendJson(res, 400, { error: 'Invalid JSON' });
  }

  const dirPath = body.dir || '/';
  const absDir = safePath(dirPath.endsWith('/') ? dirPath : `${dirPath}/`);
  if (!absDir) return sendJson(res, 403, { error: 'Invalid folder' });

  let st;
  try {
    st = fs.statSync(absDir);
  } catch {
    return sendJson(res, 404, { error: 'Folder not found' });
  }
  if (!st.isDirectory()) return sendJson(res, 400, { error: 'Not a folder' });

  const filename = sanitizeFilename(body.filename || '');
  if (!filename) return sendJson(res, 400, { error: 'Invalid filename' });

  const totalSize = parseInt(body.totalSize, 10) || 0;
  const totalChunks = parseInt(body.totalChunks, 10) || 0;
  if (totalSize <= 0 || totalSize > MAX_UPLOAD_BYTES) {
    return sendJson(res, 413, { error: `Max upload size is ${formatSize(MAX_UPLOAD_BYTES)}` });
  }
  if (totalChunks <= 0 || totalChunks > 10000) {
    return sendJson(res, 400, { error: 'Invalid chunk count' });
  }

  const uploadId = crypto.randomBytes(12).toString('hex');
  const dir = uploadChunkDir(uploadId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(uploadManifestPath(uploadId), JSON.stringify({
    dir: dirPath,
    filename,
    totalSize,
    totalChunks,
    received: {},
    created: Date.now(),
  }));

  return sendJson(res, 200, { ok: true, uploadId, chunkSize: CHUNK_SIZE });
}

async function handleUploadChunk(req, res, uploadId, chunkIndex) {
  const dir = uploadChunkDir(uploadId);
  const manifestFile = uploadManifestPath(uploadId);
  if (!fs.existsSync(manifestFile)) {
    return sendJson(res, 404, { error: 'Upload session not found' });
  }

  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  const idx = parseInt(chunkIndex, 10);
  if (Number.isNaN(idx) || idx < 0 || idx >= manifest.totalChunks) {
    return sendJson(res, 400, { error: 'Invalid chunk index' });
  }

  const chunkPath = path.join(dir, String(idx));
  try {
    const size = await streamToFile(req, chunkPath, CHUNK_SIZE + 1024 * 1024);
    manifest.received[String(idx)] = size;
    fs.writeFileSync(manifestFile, JSON.stringify(manifest));
    return sendJson(res, 200, { ok: true, chunk: idx, size });
  } catch (err) {
    fs.unlink(chunkPath, () => {});
    return sendJson(res, 500, { error: err.message || 'Chunk upload failed' });
  }
}

async function mergeUploadChunks(uploadId) {
  const manifestFile = uploadManifestPath(uploadId);
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  const dir = uploadChunkDir(uploadId);

  for (let i = 0; i < manifest.totalChunks; i += 1) {
    const cp = path.join(dir, String(i));
    if (!fs.existsSync(cp)) {
      throw new Error(`Missing chunk ${i}`);
    }
  }

  const absDir = safePath(manifest.dir.endsWith('/') ? manifest.dir : `${manifest.dir}/`);
  if (!absDir) throw new Error('Invalid folder');

  const finalName = uniqueName(absDir, manifest.filename);
  const target = path.join(absDir, finalName);
  if (!target.startsWith(ROOT)) throw new Error('Forbidden path');

  const ws = fs.createWriteStream(target);
  for (let i = 0; i < manifest.totalChunks; i += 1) {
    await pipeline(fs.createReadStream(path.join(dir, String(i))), ws, { end: false });
  }
  await new Promise((resolve, reject) => {
    ws.end((err) => (err ? reject(err) : resolve()));
  });

  const st = fs.statSync(target);
  fs.rm(dir, { recursive: true, force: true }, () => {});
  return { name: finalName, size: st.size, path: `${manifest.dir}${encodeURIComponent(finalName)}` };
}

async function handleUploadComplete(req, res) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return sendJson(res, 400, { error: 'Invalid JSON' });
  }

  const uploadId = body.uploadId;
  if (!uploadId || !/^[a-f0-9]+$/.test(uploadId)) {
    return sendJson(res, 400, { error: 'Invalid upload id' });
  }

  try {
    const result = await mergeUploadChunks(uploadId);
    return sendJson(res, 200, { ok: true, ...result });
  } catch (err) {
    return sendJson(res, 400, { error: err.message || 'Could not finalize upload' });
  }
}

/** Legacy multipart — small multi-file only; large files use PUT/chunks from client */
async function handleUpload(req, res, absDir, webPath) {
  const ct = req.headers['content-type'] || '';
  const m = /boundary=(.+)/i.exec(ct);
  if (!m) {
    return sendJson(res, 400, { error: 'Expected multipart/form-data' });
  }

  const cl = parseInt(req.headers['content-length'] || '0', 10);
  if (cl > 100 * 1024 * 1024) {
    return sendJson(res, 413, { error: 'Use single-file upload for files over 100MB' });
  }

  let buffer;
  try {
    buffer = await readBody(req, 100 * 1024 * 1024);
  } catch (err) {
    return sendJson(res, 413, { error: err.message || 'Upload too large' });
  }

  const parts = parseMultipart(buffer, m[1].trim());
  const saved = [];

  for (const part of parts) {
    if (!part.filename || !part.data.length) continue;
    const safeName = sanitizeFilename(part.filename);
    if (!safeName) continue;
    const finalName = uniqueName(absDir, safeName);
    const target = path.join(absDir, finalName);
    if (!target.startsWith(ROOT)) continue;
    fs.writeFileSync(target, part.data);
    saved.push({ name: finalName, path: `${webPath}${encodeURIComponent(finalName)}`, size: part.data.length });
  }

  if (!saved.length) {
    return sendJson(res, 400, { error: 'No files received' });
  }

  return sendJson(res, 200, { ok: true, files: saved, count: saved.length });
}

function handleBulkDownload(req, res, paths) {
  if (!Array.isArray(paths) || !paths.length) {
    return sendJson(res, 400, { error: 'No files selected' });
  }

  const files = [];
  for (const p of paths.slice(0, 100)) {
    const abs = safePath(p);
    if (!abs) continue;
    try {
      const st = fs.statSync(abs);
      if (st.isFile()) files.push(abs);
    } catch (_) { /* skip */ }
  }

  if (!files.length) {
    return sendJson(res, 400, { error: 'No valid files' });
  }

  if (files.length === 1) {
    return serveFile(req, res, files[0], true);
  }

  const tmpZip = path.join(os.tmpdir(), `media-bulk-${Date.now()}.zip`);
  const args = ['-j', tmpZip, ...files];

  execFile('zip', args, (err) => {
    if (err) {
      return sendJson(res, 501, {
        error: 'zip not available — install: pkg install zip',
        fallback: files.map((f) => {
          const rel = f.slice(ROOT.length) || '/';
          return `${rel}?download=1`;
        }),
      });
    }

    res.writeHead(200, {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="media-${files.length}-files.zip"`,
    });
    const stream = fs.createReadStream(tmpZip);
    stream.pipe(res);
    stream.on('close', () => {
      fs.unlink(tmpZip, () => {});
    });
  });
}

const CSS = `
:root{--page:#f7f8fa;--surface:#fff;--border:#e5e7eb;--border-strong:#d1d5db;--text:#0f172a;--muted:#64748b;--primary:#2563eb;--primary-dark:#1d4ed8;--accent:#eff6ff;--radius:14px;--font:Inter,system-ui,-apple-system,sans-serif;--bulk-h:56px}
@media(prefers-color-scheme:dark){:root{--page:#0d1117;--surface:#161b22;--border:#21262d;--border-strong:#30363d;--text:#e6edf3;--muted:#8b949e;--accent:#1c2333}}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:var(--font);background:var(--page);color:var(--text);line-height:1.55;min-height:100vh;-webkit-font-smoothing:antialiased;padding-bottom:calc(var(--bulk-h) + 1rem)}
a{color:inherit;text-decoration:none}
.shell{max-width:1400px;margin:0 auto;padding:.75rem 1rem 2rem}
.topnav{background:var(--surface);border-bottom:1px solid var(--border);padding:.65rem 1rem;position:sticky;top:0;z-index:30;display:flex;align-items:center;gap:.5rem}
.topnav-title{font-size:.875rem;font-weight:700;flex:1}
.header{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:1rem;margin-bottom:1rem;box-shadow:0 1px 3px rgba(0,0,0,.04)}
.header-top{display:flex;align-items:flex-start;gap:.75rem;flex-wrap:wrap;margin-bottom:.75rem}
.header-top h1{font-size:1.05rem;font-weight:700;flex:1;min-width:0;letter-spacing:-.025em}
.count{color:var(--muted);font-size:.75rem;font-weight:500}
.breadcrumb{display:flex;flex-wrap:wrap;gap:.2rem;font-size:.75rem;color:var(--muted);margin-bottom:.75rem;align-items:center}
.breadcrumb a{color:var(--muted);padding:.15rem .3rem;border-radius:5px}
.breadcrumb a:hover{background:rgba(100,116,139,.1);color:var(--text)}
.breadcrumb span{color:var(--border-strong)}
.toolbar{display:flex;gap:.5rem;flex-wrap:wrap;align-items:center}
.toolbar-row{display:flex;gap:.5rem;flex-wrap:wrap;width:100%;margin-top:.5rem}
.search{flex:1;min-width:140px;background:var(--page);border:1px solid var(--border-strong);border-radius:8px;padding:.45rem .65rem;font-size:.8125rem;color:var(--text);font-family:var(--font)}
.search:focus{outline:2px solid rgba(37,99,235,.25);border-color:var(--primary)}
.select,.search{font-family:var(--font)}
.select{background:var(--page);border:1px solid var(--border-strong);border-radius:8px;padding:.45rem .55rem;font-size:.8125rem;color:var(--text)}
.btn{display:inline-flex;align-items:center;justify-content:center;padding:.4rem .75rem;border-radius:8px;font-size:.8125rem;font-weight:600;border:1px solid var(--border-strong);background:var(--surface);color:var(--text);cursor:pointer;gap:.35rem;white-space:nowrap;font-family:var(--font);transition:all .12s}
.btn:hover{background:var(--page)}
.btn.primary{background:var(--primary);border-color:var(--primary);color:#fff}
.btn.primary:hover{background:var(--primary-dark)}
.btn.ghost{background:transparent;border-color:transparent}
.btn.sm{padding:.3rem .55rem;font-size:.75rem}
.btn.active{background:var(--accent);border-color:var(--primary);color:var(--primary)}
.btn:disabled{opacity:.45;cursor:not-allowed}
.upload-zone{border:2px dashed var(--border-strong);border-radius:10px;padding:1rem;text-align:center;background:var(--page);margin-top:.75rem;display:none}
.upload-zone.open{display:block}
.upload-zone.dragover{border-color:var(--primary);background:var(--accent)}
.upload-zone p{font-size:.8125rem;color:var(--muted);margin-bottom:.5rem}
.upload-progress{height:4px;background:var(--border);border-radius:2px;margin-top:.5rem;overflow:hidden;display:none}
.upload-progress bar{display:block;height:100%;background:var(--primary);width:0%;transition:width .2s}
.section{margin-bottom:1.25rem}
.section-label{font-size:.65rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);margin-bottom:.625rem;display:flex;align-items:center;gap:.5rem}
.section-label::after{content:'';flex:1;height:1px;background:var(--border)}
.folder-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:.5rem}
.folder-card{display:flex;align-items:center;gap:.625rem;padding:.75rem;background:var(--surface);border:1px solid var(--border);border-radius:10px;min-width:0}
.folder-card:hover{border-color:var(--border-strong);box-shadow:0 2px 8px rgba(0,0,0,.05)}
.folder-icon{width:36px;height:36px;border-radius:8px;background:var(--accent);color:var(--primary);display:flex;align-items:center;justify-content:center;font-size:1rem;flex-shrink:0}
.folder-name{font-size:.8125rem;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:.5rem}
.gallery.list-view{display:block}
.gallery.list-view .media-item{margin-bottom:.375rem}
.media-item{position:relative;background:var(--surface);border:1px solid var(--border);border-radius:10px;overflow:hidden;transition:border-color .12s,box-shadow .12s}
.media-item:hover{border-color:var(--border-strong);box-shadow:0 3px 12px rgba(0,0,0,.08)}
.media-item.hidden{display:none!important}
.media-item.list-mode{display:flex;align-items:center;gap:.75rem;padding:.625rem .75rem;aspect-ratio:auto}
.media-item.list-mode .tile-link{display:flex;align-items:center;gap:.75rem;width:100%;height:auto}
.media-item.list-mode .tile-thumb{width:52px;height:52px;border-radius:8px;flex-shrink:0;aspect-ratio:1}
.media-item.list-mode .tile-overlay{position:static;background:none;color:var(--text);padding:0;flex:1;min-width:0}
.media-item.list-mode .tile-actions{position:static;display:flex;gap:.35rem;flex-shrink:0;padding:0}
.tile-link{display:block;width:100%;height:100%;position:relative;color:inherit}
.tile.grid-mode .tile-link{aspect-ratio:1}
.tile-thumb{width:100%;height:100%;object-fit:cover;display:block;background:var(--page)}
.tile-video-bg{display:flex;align-items:center;justify-content:center;width:100%;height:100%;min-height:100px;background:linear-gradient(160deg,#1e1b4b,#0f172a);aspect-ratio:16/10}
.play-btn{width:48px;height:48px;border-radius:50%;background:rgba(255,255,255,.15);border:2px solid rgba(255,255,255,.35);display:flex;align-items:center;justify-content:center;color:#fff;font-size:1.1rem;padding-left:3px}
.tile-overlay{position:absolute;inset:auto 0 0 0;padding:.4rem .55rem;background:linear-gradient(transparent,rgba(0,0,0,.78));color:#fff;font-size:.65rem;line-height:1.25}
.media-item.list-mode .tile-name{color:var(--text)}
.media-item.list-mode .tile-meta{color:var(--muted)}
.tile-name{display:block;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tile-meta{opacity:.85;font-size:.6rem}
.tile-actions{position:absolute;top:.35rem;right:.35rem;display:flex;gap:.25rem;opacity:0;transition:opacity .12s}
.media-item:hover .tile-actions,.media-item.selected .tile-actions{opacity:1}
.icon-btn{width:28px;height:28px;border-radius:6px;border:none;background:rgba(0,0,0,.55);color:#fff;font-size:.75rem;cursor:pointer;display:flex;align-items:center;justify-content:center}
.icon-btn:hover{background:rgba(0,0,0,.75)}
.pick{position:absolute;top:.35rem;left:.35rem;z-index:2}
.pick input{width:18px;height:18px;accent-color:var(--primary);cursor:pointer}
.media-item.selected{outline:2px solid var(--primary);outline-offset:-2px}
.empty{padding:2.5rem 1rem;text-align:center;color:var(--muted);background:var(--surface);border:1.5px dashed var(--border);border-radius:10px}
.viewer-shell{max-width:1100px;margin:0 auto;padding:.75rem 1rem 2rem}
.viewer-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden}
.viewer-bar{display:flex;align-items:center;gap:.5rem;padding:.75rem 1rem;border-bottom:1px solid var(--border);flex-wrap:wrap}
.viewer-bar h2{font-size:.875rem;font-weight:700;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.viewer-body{background:#000;display:flex;align-items:center;justify-content:center;min-height:240px}
.viewer-body img{max-width:100%;max-height:85vh;display:block}
.viewer-body video{width:100%;max-height:85vh;display:block;background:#000}
.viewer-body audio{width:100%;padding:1.25rem;background:var(--page)}
.viewer-body iframe{width:100%;min-height:70vh;border:none;background:#fff}
.viewer-body pre{padding:1rem;background:var(--page);color:var(--text);max-height:70vh;overflow:auto;width:100%;font-size:.8125rem;white-space:pre-wrap;word-break:break-word}
.modal{position:fixed;inset:0;background:rgba(0,0,0,.94);z-index:100;display:none;align-items:center;justify-content:center;padding:.75rem}
.modal.open{display:flex}
.modal video,.modal img{max-width:min(96vw,1200px);max-height:82vh;border-radius:6px}
.modal-ui{position:fixed;inset:0;pointer-events:none}
.modal-top{display:flex;justify-content:space-between;align-items:center;padding:.75rem 1rem;color:#fff;pointer-events:auto;gap:.5rem}
.modal-title{font-size:.8125rem;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}
.modal-nav{position:absolute;top:50%;transform:translateY(-50%);width:42px;height:42px;border-radius:50%;border:1px solid rgba(255,255,255,.25);background:rgba(255,255,255,.08);color:#fff;font-size:1.2rem;cursor:pointer;pointer-events:auto;display:flex;align-items:center;justify-content:center}
.modal-nav.prev{left:.75rem}.modal-nav.next{right:.75rem}
.modal-nav:disabled{opacity:.2;cursor:default}
.bulk-bar{position:fixed;bottom:0;left:0;right:0;height:var(--bulk-h);background:var(--surface);border-top:1px solid var(--border);display:flex;align-items:center;gap:.75rem;padding:0 1rem;z-index:40;transform:translateY(100%);transition:transform .2s;box-shadow:0 -4px 20px rgba(0,0,0,.08)}
.bulk-bar.open{transform:translateY(0)}
.bulk-count{font-size:.8125rem;font-weight:600;flex:1}
.toast-msg{position:fixed;bottom:calc(var(--bulk-h) + .75rem);left:50%;transform:translateX(-50%) translateY(20px);background:var(--text);color:var(--page);padding:.5rem 1rem;border-radius:8px;font-size:.8125rem;opacity:0;transition:all .2s;z-index:50;pointer-events:none}
.toast-msg.show{opacity:1;transform:translateX(-50%) translateY(0)}
.transfer-eye-btn{position:relative;width:36px;height:36px;border-radius:8px;border:1px solid var(--border-strong);background:var(--surface);cursor:pointer;font-size:1rem;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.transfer-eye-btn:hover{background:var(--page)}
.transfer-eye-btn.has-active{border-color:var(--primary);box-shadow:0 0 0 2px rgba(37,99,235,.15)}
.transfer-badge{position:absolute;top:-4px;right:-4px;min-width:16px;height:16px;padding:0 4px;border-radius:999px;background:var(--primary);color:#fff;font-size:.625rem;font-weight:700;display:none;align-items:center;justify-content:center;line-height:16px}
.transfer-badge.show{display:flex}
.transfer-panel{position:fixed;top:0;right:0;width:min(380px,100vw);height:100vh;background:var(--surface);border-left:1px solid var(--border);z-index:200;transform:translateX(100%);transition:transform .22s ease;display:flex;flex-direction:column;box-shadow:-8px 0 30px rgba(0,0,0,.12)}
.transfer-panel.open{transform:translateX(0)}
.transfer-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:199;opacity:0;pointer-events:none;transition:opacity .2s}
.transfer-backdrop.open{opacity:1;pointer-events:auto}
.transfer-head{display:flex;align-items:center;gap:.5rem;padding:.85rem 1rem;border-bottom:1px solid var(--border)}
.transfer-head h3{font-size:.875rem;font-weight:700;flex:1}
.transfer-list{flex:1;overflow-y:auto;padding:.5rem}
.transfer-item{padding:.65rem .75rem;border:1px solid var(--border);border-radius:10px;margin-bottom:.5rem;background:var(--page)}
.transfer-item.done{border-color:#22c55e33;background:rgba(34,197,94,.06)}
.transfer-item.error{border-color:#ef444433;background:rgba(239,68,68,.06)}
.transfer-row{display:flex;align-items:center;gap:.5rem;margin-bottom:.35rem}
.transfer-icon{font-size:.875rem;width:20px;text-align:center;flex-shrink:0}
.transfer-name{font-size:.75rem;font-weight:600;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.transfer-status{font-size:.625rem;font-weight:700;text-transform:uppercase;color:var(--muted);flex-shrink:0}
.transfer-item.done .transfer-status{color:#16a34a}
.transfer-item.error .transfer-status{color:#dc2626}
.transfer-bar{height:5px;background:var(--border);border-radius:3px;overflow:hidden}
.transfer-bar>span{display:block;height:100%;background:var(--primary);width:0%;transition:width .15s}
.transfer-meta{display:flex;justify-content:space-between;margin-top:.3rem;font-size:.625rem;color:var(--muted)}
.transfer-empty{padding:2rem 1rem;text-align:center;color:var(--muted);font-size:.8125rem}
.topnav-actions{display:flex;align-items:center;gap:.35rem}
@media(max-width:640px){
  .shell{padding:.5rem .65rem 1.5rem}
  .gallery{grid-template-columns:repeat(auto-fill,minmax(100px,1fr))}
  .folder-grid{grid-template-columns:1fr 1fr}
  .toolbar-row .btn{flex:1;min-width:calc(50% - .25rem)}
  .tile-actions{opacity:1}
  .modal-nav{display:none}
}
`;

const CLIENT_JS = `
(function(){
  const $=function(s,r){return(r||document).querySelector(s)};
  const $$=function(s,r){return Array.from((r||document).querySelectorAll(s))};
  const CHUNK_SIZE=48*1024*1024;
  const CHUNK_THRESHOLD=80*1024*1024;
  const MAX_BLOB_DL=250*1024*1024;

  const toast=function(msg){const t=$('#toast');if(!t)return;t.textContent=msg;t.classList.add('show');clearTimeout(toast._t);toast._t=setTimeout(function(){t.classList.remove('show');},3200);};

  function fmtBytes(n){
    n=+n||0;
    if(n<1024)return n+' B';
    if(n<1048576)return(n/1024).toFixed(1)+' KB';
    if(n<1073741824)return(n/1048576).toFixed(1)+' MB';
    return(n/1073741824).toFixed(2)+' GB';
  }
  function fmtSpeed(bps){
    if(!bps||bps<1)return '';
    return fmtBytes(bps)+'/s';
  }
  function pct(done,total){return total?Math.min(100,Math.round((done/total)*100)):0;}

  const webPath=$('#page-data')?.dataset.webPath||'/';
  const search=$('#search');
  const filterKind=$('#filter-kind');
  const sortBy=$('#sort-by');
  const uploadZone=$('#upload-zone');
  const fileInput=$('#file-input');
  const bulkBar=$('#bulk-bar');
  const bulkCount=$('#bulk-count');
  const selected=new Set();
  const transfers=[];
  let reloadPending=false;

  function saveTransfers(){
    try{sessionStorage.setItem('mediaTransfers',JSON.stringify(transfers.slice(0,50)));}catch(e){}
  }
  function loadTransfers(){
    try{
      const raw=sessionStorage.getItem('mediaTransfers');
      if(raw){JSON.parse(raw).forEach(function(t){if(t.status==='active')t.status='error',t.error='Interrupted';transfers.push(t);});}
    }catch(e){}
  }

  function activeCount(){return transfers.filter(function(t){return t.status==='active';}).length;}

  function updateBadge(){
    const badge=$('#transfer-badge');
    const btn=$('#transfer-toggle');
    const n=activeCount();
    if(!badge)return;
    if(n>0){badge.textContent=String(n);badge.classList.add('show');btn?.classList.add('has-active');}
    else{badge.classList.remove('show');btn?.classList.remove('has-active');}
  }

  function renderTransfers(){
    const list=$('#transfer-list');
    if(!list)return;
    if(!transfers.length){list.innerHTML='<div class="transfer-empty">No uploads or downloads yet</div>';updateBadge();return;}
    list.innerHTML=transfers.map(function(t){
      const p=pct(t.done,t.total);
      const st=t.status==='active'?(p+'%'):(t.status==='done'?'Done':(t.error||'Failed'));
      return '<div class="transfer-item '+t.status+'" data-id="'+t.id+'">'+
        '<div class="transfer-row"><span class="transfer-icon">'+(t.type==='upload'?'↑':'↓')+'</span>'+
        '<span class="transfer-name" title="'+t.name.replace(/"/g,'&quot;')+'">'+t.name+'</span>'+
        '<span class="transfer-status">'+st+'</span></div>'+
        '<div class="transfer-bar"><span style="width:'+p+'%"></span></div>'+
        '<div class="transfer-meta"><span>'+fmtBytes(t.done)+(t.total?' / '+fmtBytes(t.total):'')+'</span>'+
        '<span>'+(t.status==='active'&&t.speed?fmtSpeed(t.speed):'')+'</span></div></div>';
    }).join('');
    updateBadge();
    saveTransfers();
  }

  function addTransfer(item){
    transfers.unshift(item);
    if(transfers.length>80)transfers.length=80;
    renderTransfers();
    openTransferPanel();
  }

  function setTransfer(id,patch){
    const t=transfers.find(function(x){return x.id===id;});
    if(!t)return;
    Object.assign(t,patch);
    renderTransfers();
  }

  function openTransferPanel(){
    $('#transfer-panel')?.classList.add('open');
    $('#transfer-backdrop')?.classList.add('open');
  }
  function closeTransferPanel(){
    $('#transfer-panel')?.classList.remove('open');
    $('#transfer-backdrop')?.classList.remove('open');
  }

  $('#transfer-toggle')?.addEventListener('click',function(){
    if($('#transfer-panel')?.classList.contains('open'))closeTransferPanel();else openTransferPanel();
  });
  $('#transfer-close')?.addEventListener('click',closeTransferPanel);
  $('#transfer-backdrop')?.addEventListener('click',closeTransferPanel);
  $('#transfer-clear')?.addEventListener('click',function(){
    for(var i=transfers.length-1;i>=0;i--){if(transfers[i].status!=='active')transfers.splice(i,1);}
    renderTransfers();
  });

  function xhrPut(url,blob,onProgress){
    return new Promise(function(resolve,reject){
      var xhr=new XMLHttpRequest();
      var lastDone=0,lastT=Date.now();
      xhr.upload.onprogress=function(e){
        if(e.lengthComputable&&onProgress){
          var now=Date.now(),dt=(now-lastT)/1000;
          var speed=0;
          if(dt>0.35){speed=(e.loaded-lastDone)/dt;lastDone=e.loaded;lastT=now;}
          onProgress(e.loaded,e.total,speed);
        }
      };
      xhr.onload=function(){
        if(xhr.status>=200&&xhr.status<300){
          try{resolve(JSON.parse(xhr.responseText||'{}'));}catch(e){resolve({ok:true});}
        }else{
          try{reject(new Error(JSON.parse(xhr.responseText).error||('HTTP '+xhr.status)));}catch(e){reject(new Error('HTTP '+xhr.status));}
        }
      };
      xhr.onerror=function(){reject(new Error('Connection reset — try again or use chunked upload'));}
      xhr.ontimeout=function(){reject(new Error('Upload timed out'));}
      xhr.timeout=0;
      xhr.open('PUT',url);
      xhr.setRequestHeader('Content-Type','application/octet-stream');
      xhr.send(blob);
    });
  }

  function xhrGetBlob(url,onProgress){
    return new Promise(function(resolve,reject){
      var xhr=new XMLHttpRequest();
      var lastDone=0,lastT=Date.now();
      xhr.open('GET',url);
      xhr.responseType='blob';
      xhr.onprogress=function(e){
        if(e.lengthComputable&&onProgress){
          var now=Date.now(),dt=(now-lastT)/1000,speed=0;
          if(dt>0.35){speed=(e.loaded-lastDone)/dt;lastDone=e.loaded;lastT=now;}
          onProgress(e.loaded,e.total,speed);
        }
      };
      xhr.onload=function(){
        if(xhr.status>=200&&xhr.status<300)resolve(xhr.response);
        else reject(new Error('Download failed (HTTP '+xhr.status+')'));
      };
      xhr.onerror=function(){reject(new Error('Connection reset during download'));};
      xhr.send();
    });
  }

  async function uploadDirect(file,t){
    var url=(webPath.endsWith('/')?webPath:webPath+'/')+encodeURIComponent(file.name)+'?upload=1';
    await xhrPut(url,file,function(done,total,speed){
      setTransfer(t.id,{done:done,total:total,speed:speed});
    });
    setTransfer(t.id,{status:'done',done:file.size,total:file.size,speed:0});
  }

  async function uploadChunked(file,t){
    var totalChunks=Math.ceil(file.size/CHUNK_SIZE);
    var initRes=await fetch('/__upload/init',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({dir:webPath,filename:file.name,totalSize:file.size,totalChunks:totalChunks})});
    var initData=await initRes.json();
    if(!initRes.ok)throw new Error(initData.error||'Chunk init failed');
    var uploadId=initData.uploadId;
    for(var i=0;i<totalChunks;i++){
      var start=i*CHUNK_SIZE;
      var chunk=file.slice(start,start+CHUNK_SIZE);
      var chunkUrl='/__upload/chunk/'+uploadId+'/'+i;
      await xhrPut(chunkUrl,chunk,function(done){
        setTransfer(t.id,{done:start+done,total:file.size});
      });
    }
    var doneRes=await fetch('/__upload/complete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({uploadId:uploadId})});
    var doneData=await doneRes.json();
    if(!doneRes.ok)throw new Error(doneData.error||'Finalize failed');
    setTransfer(t.id,{status:'done',done:file.size,total:file.size,speed:0});
  }

  async function uploadOne(file){
    var id='u-'+Date.now()+'-'+Math.random().toString(36).slice(2,7);
    var t={id:id,name:file.name,type:'upload',total:file.size,done:0,speed:0,status:'active',error:null};
    addTransfer(t);
    try{
      if(file.size>CHUNK_THRESHOLD)await uploadChunked(file,t);
      else await uploadDirect(file,t);
      reloadPending=true;
    }catch(e){
      setTransfer(id,{status:'error',error:e.message||'Upload failed',speed:0});
      throw e;
    }
  }

  async function uploadFiles(files){
    if(!files.length)return;
    openTransferPanel();
    var ok=0,fail=0;
    for(var i=0;i<files.length;i++){
      try{await uploadOne(files[i]);ok++;}
      catch(e){fail++;}
    }
    if(fileInput)fileInput.value='';
    if(ok)toast('Uploaded '+ok+' file(s)'+(fail?(', '+fail+' failed'):''));
    else toast(fail+' upload(s) failed');
    if(reloadPending&&ok)setTimeout(function(){location.reload();},800);
  }

  async function downloadTracked(url,name,sizeHint){
    var id='d-'+Date.now()+'-'+Math.random().toString(36).slice(2,7);
    var t={id:id,name:name,type:'download',total:sizeHint||0,done:0,speed:0,status:'active',error:null};
    addTransfer(t);
    try{
      if(sizeHint>MAX_BLOB_DL&&window.showSaveFilePicker){
        var handle=await window.showSaveFilePicker({suggestedName:name});
        var writable=await handle.createWritable();
        var res=await fetch(url);
        if(!res.ok)throw new Error('Download failed');
        var total=+(res.headers.get('content-length')||sizeHint||0);
        if(total)setTransfer(id,{total:total});
        var reader=res.body.getReader();
        var done=0,lastDone=0,lastT=Date.now();
        while(true){
          var chunk=await reader.read();
          if(chunk.done)break;
          await writable.write(chunk.value);
          done+=chunk.value.length;
          var now=Date.now(),dt=(now-lastT)/1000,speed=0;
          if(dt>0.35){speed=(done-lastDone)/dt;lastDone=done;lastT=now;}
          setTransfer(id,{done:done,total:total||done,speed:speed});
        }
        await writable.close();
      }else{
        var blob=await xhrGetBlob(url,function(done,total,speed){
          setTransfer(id,{done:done,total:total||sizeHint||0,speed:speed});
        });
        var a=document.createElement('a');
        a.href=URL.createObjectURL(blob);
        a.download=name;
        a.click();
        URL.revokeObjectURL(a.href);
      }
      setTransfer(id,{status:'done',speed:0});
      toast('Downloaded '+name);
    }catch(e){
      if(e.name!=='AbortError'){
        setTransfer(id,{status:'error',error:e.message||'Download failed',speed:0});
        window.open(url+'?download=1','_blank');
        toast('Fallback download opened for '+name);
      }else setTransfer(id,{status:'error',error:'Cancelled',speed:0});
    }
  }

  function applyFilters(){
    const term=(search?.value||'').trim().toLowerCase();
    const kind=filterKind?.value||'all';
    const items=$$('.media-item');
    items.forEach(function(el){
      const name=(el.dataset.name||'').toLowerCase();
      const k=el.dataset.kind||'';
      const matchTerm=!term||name.includes(term);
      const matchKind=kind==='all'||k===kind;
      el.classList.toggle('hidden',!(matchTerm&&matchKind));
    });
    sortVisible();
  }

  function sortVisible(){
    const mode=sortBy?.value||'name-asc';
    $$('.gallery').forEach(function(gallery){
      const items=$$('.media-item',gallery).filter(function(el){return !el.classList.contains('hidden');});
      items.sort(function(a,b){
        if(mode==='name-asc') return a.dataset.name.localeCompare(b.dataset.name);
        if(mode==='name-desc') return b.dataset.name.localeCompare(a.dataset.name);
        if(mode==='size-desc') return (+b.dataset.size)-(+a.dataset.size);
        if(mode==='date-desc') return (+b.dataset.mtime)-(+a.dataset.mtime);
        return 0;
      });
      items.forEach(function(el){gallery.appendChild(el);});
    });
  }

  function setView(mode){
    $$('.gallery').forEach(function(g){
      g.classList.toggle('list-view',mode==='list');
    });
    $$('.media-item').forEach(function(el){
      el.classList.toggle('list-mode',mode==='list');
    });
    $$('[data-view]').forEach(function(b){b.classList.toggle('active',b.dataset.view===mode);});
  }

  search?.addEventListener('input',applyFilters);
  filterKind?.addEventListener('change',applyFilters);
  sortBy?.addEventListener('change',applyFilters);
  $$('[data-view]').forEach(function(btn){
    btn.addEventListener('click',function(){setView(btn.dataset.view);});
  });

  function updateBulk(){
    const n=selected.size;
    bulkBar?.classList.toggle('open',n>0);
    if(bulkCount) bulkCount.textContent=n+' selected';
    $$('.media-item').forEach(function(el){
      el.classList.toggle('selected',selected.has(el.dataset.path));
      const cb=$('.pick input',el);
      if(cb) cb.checked=selected.has(el.dataset.path);
    });
  }

  $$('.pick input').forEach(function(cb){
    cb.addEventListener('click',function(e){e.stopPropagation();});
    cb.addEventListener('change',function(){
      const item=cb.closest('.media-item');
      const p=item?.dataset.path;
      if(!p)return;
      if(cb.checked) selected.add(p); else selected.delete(p);
      updateBulk();
    });
  });

  $('#select-all')?.addEventListener('click',function(){
    $$('.media-item:not(.hidden)').forEach(function(el){
      if(el.dataset.path) selected.add(el.dataset.path);
    });
    updateBulk();
  });
  $('#clear-select')?.addEventListener('click',function(){selected.clear();updateBulk();});

  $('#bulk-download')?.addEventListener('click',async function(){
    const paths=Array.from(selected);
    if(!paths.length)return;
    var id='d-bulk-'+Date.now();
    addTransfer({id:id,name:paths.length+' files.zip',type:'download',total:0,done:0,speed:0,status:'active',error:null});
    try{
      const res=await fetch('/__bulk',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({paths:paths})});
      if(res.headers.get('content-type')?.includes('application/json')){
        const data=await res.json();
        if(data.fallback){
          setTransfer(id,{status:'done',name:paths.length+' files (individual)'});
          for(var i=0;i<data.fallback.length;i++){
            (function(u,idx){
              setTimeout(function(){
                var el=$('[data-path="'+paths[idx]+'"]');
                downloadTracked(u,el?.dataset?.name||('file-'+idx),+(el?.dataset?.size||0));
              },idx*400);
            })(data.fallback[i],i);
          }
          return;
        }
        throw new Error(data.error||'Download failed');
      }
      var total=+(res.headers.get('content-length')||0);
      if(total)setTransfer(id,{total:total});
      var reader=res.body.getReader();
      var chunks=[],done=0;
      while(true){
        var part=await reader.read();
        if(part.done)break;
        chunks.push(part.value);
        done+=part.value.length;
        setTransfer(id,{done:done,total:total||done});
      }
      var blob=new Blob(chunks,{type:'application/zip'});
      var a=document.createElement('a');
      a.href=URL.createObjectURL(blob);
      a.download='media-'+paths.length+'-files.zip';
      a.click();
      URL.revokeObjectURL(a.href);
      setTransfer(id,{status:'done',done:done,total:done,speed:0});
      toast('Zip download started');
    }catch(e){
      setTransfer(id,{status:'error',error:e.message||'Download failed'});
      toast(e.message||'Download failed');
    }
  });

  function toggleUpload(show){
    uploadZone?.classList.toggle('open',show);
  }
  $('#upload-btn')?.addEventListener('click',function(){toggleUpload(!uploadZone?.classList.contains('open'));});
  $('#upload-cancel')?.addEventListener('click',function(){toggleUpload(false);});

  fileInput?.addEventListener('change',function(){uploadFiles(Array.from(fileInput.files||[]));});
  uploadZone?.addEventListener('dragover',function(e){e.preventDefault();uploadZone.classList.add('dragover');});
  uploadZone?.addEventListener('dragleave',function(){uploadZone.classList.remove('dragover');});
  uploadZone?.addEventListener('drop',function(e){
    e.preventDefault();uploadZone.classList.remove('dragover');
    uploadFiles(Array.from(e.dataTransfer?.files||[]));
  });

  $$('[data-dl]').forEach(function(btn){
    btn.addEventListener('click',function(e){
      e.preventDefault();e.stopPropagation();
      var url=btn.dataset.dl;
      var name=btn.dataset.name||itemNameFromUrl(url);
      var size=+(btn.dataset.size||0);
      if(!size){
        var item=btn.closest('.media-item');
        size=+(item?.dataset?.size||0);
        if(!btn.dataset.name&&item)name=item.dataset.name||name;
      }
      downloadTracked(url,name,size);
    });
  });
  function itemNameFromUrl(url){try{return decodeURIComponent(url.split('/').pop().split('?')[0]);}catch(e){return 'download';}}

  const images=JSON.parse($('#gallery-data')?.textContent||'[]');
  const videos=JSON.parse($('#video-data')?.textContent||'[]');
  const imgModal=$('#img-modal');
  const vidModal=$('#vid-modal');

  if(imgModal&&images.length){
    let idx=0;
    const img=imgModal.querySelector('img');
    const title=imgModal.querySelector('.modal-title');
    const prev=imgModal.querySelector('.modal-nav.prev');
    const next=imgModal.querySelector('.modal-nav.next');
    function show(i){
      idx=(i+images.length)%images.length;
      const it=images[idx];
      img.src=it.raw; title.textContent=it.name;
      const dl=imgModal.querySelector('[data-dl]');
      if(dl){dl.dataset.dl=it.view+'?download=1';dl.dataset.size='0';}
      prev.disabled=images.length<2; next.disabled=images.length<2;
    }
    function openAt(i){show(i);imgModal.classList.add('open');document.body.style.overflow='hidden';}
    function close(){imgModal.classList.remove('open');document.body.style.overflow='';img.src='';}
    $$('[data-lightbox]').forEach(function(el){
      el.addEventListener('click',function(e){e.preventDefault();openAt(parseInt(el.dataset.index,10)||0);});
    });
    imgModal.querySelector('[data-close]')?.addEventListener('click',close);
    prev?.addEventListener('click',function(){show(idx-1);});
    next?.addEventListener('click',function(){show(idx+1);});
    imgModal.addEventListener('click',function(e){if(e.target===imgModal)close();});
    document.addEventListener('keydown',function(e){
      if(!imgModal.classList.contains('open'))return;
      if(e.key==='Escape')close();
      if(e.key==='ArrowLeft')show(idx-1);
      if(e.key==='ArrowRight')show(idx+1);
    });
    imgModal.querySelector('[data-dl]')?.addEventListener('click',function(e){
      e.preventDefault();e.stopPropagation();
      const it=images[idx];
      downloadTracked(it.view+'?download=1',it.name,0);
    });
  }

  if(vidModal&&videos.length){
    let vidx=0;
    const video=vidModal.querySelector('video');
    const vtitle=vidModal.querySelector('.modal-title');
    function vshow(i){
      vidx=(i+videos.length)%videos.length;
      const it=videos[vidx];
      video.src=it.raw; vtitle.textContent=it.name;
      const dl=vidModal.querySelector('[data-dl]');
      if(dl) dl.dataset.dl=it.view+'?download=1';
    }
    function vopen(i){vshow(i);vidModal.classList.add('open');document.body.style.overflow='hidden';video.play().catch(function(){});}
    function vclose(){vidModal.classList.remove('open');document.body.style.overflow='';video.pause();video.src='';}
    $$('[data-videobox]').forEach(function(el){
      el.addEventListener('click',function(e){e.preventDefault();vopen(parseInt(el.dataset.index,10)||0);});
    });
    vidModal.querySelector('[data-close]')?.addEventListener('click',vclose);
    vidModal.addEventListener('click',function(e){if(e.target===vidModal)vclose();});
    document.addEventListener('keydown',function(e){if(vidModal.classList.contains('open')&&e.key==='Escape')vclose();});
    vidModal.querySelector('[data-dl]')?.addEventListener('click',function(e){
      e.preventDefault();e.stopPropagation();
      const it=videos[vidx];
      downloadTracked(it.view+'?download=1',it.name,0);
    });
  }

  loadTransfers();
  renderTransfers();
  applyFilters();
})();
`;

function transferPanelHtml() {
  return `<div id="transfer-backdrop" class="transfer-backdrop"></div>
<aside id="transfer-panel" class="transfer-panel" aria-label="Transfer queue">
  <div class="transfer-head">
    <h3>Transfers</h3>
    <button type="button" class="btn sm" id="transfer-clear">Clear done</button>
    <button type="button" class="btn sm" id="transfer-close">Close</button>
  </div>
  <div class="transfer-list" id="transfer-list"></div>
</aside>`;
}

function topnavHtml() {
  return `<div class="topnav">
  <span class="topnav-title">📁 Media Library</span>
  <div class="topnav-actions">
    <button type="button" id="transfer-toggle" class="transfer-eye-btn" title="View uploads &amp; downloads" aria-label="View transfers">👁<span id="transfer-badge" class="transfer-badge"></span></button>
  </div>
</div>`;
}

function pageShell(title, body, extra = '') {
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(title)}</title>
<style>${CSS}</style>
</head><body>
${topnavHtml()}
${body}
${extra}
${transferPanelHtml()}
<div id="toast" class="toast-msg"></div>
<script>${CLIENT_JS}</script>
</body></html>`;
}

function breadcrumbs(webPath) {
  const parts = webPath.split('/').filter(Boolean);
  let html = '<nav class="breadcrumb"><a href="/">Home</a>';
  let acc = '';
  for (const p of parts) {
    acc += `/${encodeURIComponent(p)}`;
    html += `<span>/</span><a href="${acc}/">${esc(decodeURIComponent(p))}</a>`;
  }
  html += '</nav>';
  return html;
}

function mediaTile(item, galleryData, videoData) {
  const isImage = item.kind === 'image';
  const isVideo = item.kind === 'video';
  const pick = `<label class="pick" onclick="event.stopPropagation()"><input type="checkbox" aria-label="Select"></label>`;

  if (isImage) {
    const imgIdx = galleryData.length;
    galleryData.push({ name: item.name, raw: `${item.nextPath}?raw=1`, view: item.nextPath, index: imgIdx });
    return `<article class="media-item tile grid-mode" data-name="${esc(item.name)}" data-kind="image" data-path="${esc(item.nextPath)}" data-size="${item.sizeBytes}" data-mtime="${item.mtime}">
      ${pick}
      <a class="tile-link" href="${item.nextPath}" data-lightbox data-index="${imgIdx}">
        <img class="tile-thumb" src="${item.nextPath}?raw=1" alt="${esc(item.name)}" loading="lazy" decoding="async">
        <div class="tile-overlay"><span class="tile-name">${esc(item.name)}</span><span class="tile-meta">${item.size}</span></div>
      </a>
      <div class="tile-actions">
        <button type="button" class="icon-btn" data-dl="${item.nextPath}?download=1" title="Download">⬇</button>
      </div>
    </article>`;
  }

  if (isVideo) {
    videoData.push({ name: item.name, raw: `${item.nextPath}?raw=1`, view: item.nextPath, index: videoData.length });
    return `<article class="media-item tile grid-mode" data-name="${esc(item.name)}" data-kind="video" data-path="${esc(item.nextPath)}" data-size="${item.sizeBytes}" data-mtime="${item.mtime}">
      ${pick}
      <a class="tile-link" href="${item.nextPath}" data-videobox data-index="${videoData.length - 1}">
        <div class="tile-video-bg"><span class="play-btn">▶</span></div>
        <div class="tile-overlay"><span class="tile-name">${esc(item.name)}</span><span class="tile-meta">${item.size}</span></div>
      </a>
      <div class="tile-actions">
        <button type="button" class="icon-btn" data-dl="${item.nextPath}?download=1" title="Download">⬇</button>
      </div>
    </article>`;
  }

  const icon = { audio: '🎵', pdf: '📄', text: '📝', file: '📦' }[item.kind] || '📦';
  return `<article class="media-item tile grid-mode" data-name="${esc(item.name)}" data-kind="${item.kind}" data-path="${esc(item.nextPath)}" data-size="${item.sizeBytes}" data-mtime="${item.mtime}">
    ${pick}
    <a class="tile-link" href="${item.nextPath}">
      <div class="tile-video-bg" style="background:var(--accent);min-height:80px"><span style="font-size:2rem">${icon}</span></div>
      <div class="tile-overlay"><span class="tile-name">${esc(item.name)}</span><span class="tile-meta">${item.size}</span></div>
    </a>
    <div class="tile-actions">
      <button type="button" class="icon-btn" data-dl="${item.nextPath}?download=1" title="Download">⬇</button>
    </div>
  </article>`;
}

function listDir(abs, webPath) {
  const entries = fs.readdirSync(abs, { withFileTypes: true });
  entries.sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const folders = [];
  const mediaItems = [];
  const galleryData = [];
  const videoData = [];

  for (const e of entries) {
    const name = e.name;
    const nextPath = `${webPath.replace(/\/$/, '')}/${encodeURIComponent(name)}`;
    if (e.isDirectory()) {
      folders.push({ name, href: `${nextPath}/` });
      continue;
    }

    let sizeBytes = 0;
    let mtime = 0;
    try {
      const st = fs.statSync(path.join(abs, name));
      sizeBytes = st.size;
      mtime = Math.floor(st.mtimeMs);
    } catch (_) { /* ignore */ }

    const kind = fileKind(name);
    mediaItems.push({
      name, nextPath, size: formatSize(sizeBytes), sizeBytes, kind, mtime,
    });
  }

  const folderName = webPath === '/'
    ? 'Media Library'
    : decodeURIComponent(webPath.split('/').filter(Boolean).pop() || 'Media');
  const parent = webPath !== '/'
    ? webPath.replace(/\/[^/]+\/?$/, '') || '/'
    : null;

  let body = `<div id="page-data" data-web-path="${esc(webPath)}" hidden></div>
<div class="shell">
<div class="header">
  ${breadcrumbs(webPath.endsWith('/') ? webPath.slice(0, -1) || '/' : webPath)}
  <div class="header-top">
    <h1>${esc(folderName)}</h1>
    <span class="count">${folders.length} folders · ${mediaItems.length} files</span>
    ${parent ? `<a class="btn ghost sm" href="${parent}">← Back</a>` : ''}
  </div>
  <div class="toolbar">
    <input class="search" id="search" type="search" placeholder="Search files…" autocomplete="off">
    <button type="button" class="btn primary sm" id="upload-btn">Upload</button>
  </div>
  <div class="toolbar-row">
    <select class="select" id="filter-kind" aria-label="Filter">
      <option value="all">All types</option>
      <option value="image">Photos</option>
      <option value="video">Videos</option>
      <option value="audio">Audio</option>
      <option value="pdf">PDF</option>
      <option value="text">Documents</option>
    </select>
    <select class="select" id="sort-by" aria-label="Sort">
      <option value="name-asc">Name A–Z</option>
      <option value="name-desc">Name Z–A</option>
      <option value="size-desc">Largest first</option>
      <option value="date-desc">Newest first</option>
    </select>
    <button type="button" class="btn sm active" data-view="grid">Grid</button>
    <button type="button" class="btn sm" data-view="list">List</button>
    <button type="button" class="btn sm" id="select-all">Select all</button>
  </div>
  <div class="upload-zone" id="upload-zone">
    <p>Drop files here or tap to browse — up to 10 GB per file</p>
    <input type="file" id="file-input" multiple accept="image/*,video/*,audio/*,.pdf,.txt,.md,.json,.csv,.zip,.mkv,.avi,.mov,.mp4">
    <div class="upload-progress" id="upload-progress"><bar></bar></div>
    <button type="button" class="btn sm" id="upload-cancel" style="margin-top:.5rem">Close</button>
  </div>
</div>`;

  if (!folders.length && !mediaItems.length) {
    body += '<div class="empty"><p>This folder is empty — upload files above</p></div></div>';
    body += bulkBarHtml();
    return pageShell(folderName, body);
  }

  if (folders.length) {
    body += `<div class="section"><div class="section-label">Folders</div><div class="folder-grid">
      ${folders.map((f) => `
        <a class="folder-card" href="${f.href}" data-name="${esc(f.name)}">
          <span class="folder-icon">📁</span>
          <span class="folder-name">${esc(f.name)}</span>
        </a>`).join('')}
    </div></div>`;
  }

  if (mediaItems.length) {
    body += `<div class="section"><div class="section-label">Files</div><div class="gallery" id="media-gallery">
      ${mediaItems.map((item) => mediaTile(item, galleryData, videoData)).join('')}
    </div></div>`;
  }

  body += '</div>';
  body += bulkBarHtml();

  const modals = `
<div id="img-modal" class="modal" role="dialog"><div class="modal-ui">
  <div class="modal-top"><span class="modal-title"></span>
    <button type="button" class="btn sm" data-dl>Download</button>
    <button type="button" class="btn sm" data-close>Close</button>
  </div>
  <button type="button" class="modal-nav prev">‹</button>
  <button type="button" class="modal-nav next">›</button>
</div><img alt=""></div>
<div id="vid-modal" class="modal" role="dialog"><div class="modal-ui">
  <div class="modal-top"><span class="modal-title"></span>
    <button type="button" class="btn sm" data-dl>Download</button>
    <button type="button" class="btn sm" data-close>Close</button>
  </div>
</div><video controls playsinline preload="metadata"></video></div>
<script id="gallery-data" type="application/json">${JSON.stringify(galleryData)}</script>
<script id="video-data" type="application/json">${JSON.stringify(videoData)}</script>`;

  return pageShell(folderName, body, modals);
}

function bulkBarHtml() {
  return `<div class="bulk-bar" id="bulk-bar">
  <span class="bulk-count" id="bulk-count">0 selected</span>
  <button type="button" class="btn primary sm" id="bulk-download">Download zip</button>
  <button type="button" class="btn sm" id="clear-select">Clear</button>
</div>`;
}

function viewerPage(abs, webPath, kind, siblings) {
  const name = path.basename(abs);
  const rawUrl = `${webPath}?raw=1`;
  const dlUrl = `${webPath}?download=1`;
  const parent = webPath.replace(/\/[^/]+$/, '') || '/';
  let fileSize = 0;
  try {
    fileSize = fs.statSync(abs).size;
  } catch { /* ignore */ }
  let media = '';

  if (kind === 'image') {
    media = `<img src="${rawUrl}" alt="${esc(name)}">`;
  } else if (kind === 'video') {
    media = `<video controls playsinline preload="metadata" src="${rawUrl}">Your browser does not support video.</video>`;
  } else if (kind === 'audio') {
    media = `<audio controls preload="metadata" src="${rawUrl}">Your browser does not support audio.</audio>`;
  } else if (kind === 'pdf') {
    media = `<iframe src="${rawUrl}" title="${esc(name)}"></iframe>`;
  } else if (kind === 'text') {
    try {
      const text = fs.readFileSync(abs, 'utf8').slice(0, 500000);
      media = `<pre>${esc(text)}</pre>`;
    } catch {
      media = `<iframe src="${rawUrl}" title="${esc(name)}"></iframe>`;
    }
  }

  const nav = siblings || { prev: null, next: null };

  const body = `<div class="viewer-shell">
  ${breadcrumbs(parent === '/' ? '' : parent)}
  <div class="viewer-card">
    <div class="viewer-bar">
      <h2>${esc(name)}</h2>
      ${nav.prev ? `<a class="btn sm" href="${nav.prev}">← Prev</a>` : ''}
      ${nav.next ? `<a class="btn sm" href="${nav.next}">Next →</a>` : ''}
      <a class="btn sm" href="${parent}">Folder</a>
      <button type="button" class="btn primary sm" data-dl="${dlUrl}" data-name="${esc(name)}" data-size="${fileSize}">Download</button>
    </div>
    <div class="viewer-body">${media}</div>
  </div>
</div>`;

  return pageShell(name, body);
}

function siblingNav(absDir, currentName, webDir) {
  try {
    const entries = fs.readdirSync(absDir, { withFileTypes: true })
      .filter((e) => e.isFile() && fileKind(e.name) !== 'file')
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b));
    const idx = entries.indexOf(currentName);
    if (idx < 0) return { prev: null, next: null };
    const base = webDir.replace(/\/$/, '') || '';
    return {
      prev: idx > 0 ? `${base}/${encodeURIComponent(entries[idx - 1])}` : null,
      next: idx < entries.length - 1 ? `${base}/${encodeURIComponent(entries[idx + 1])}` : null,
    };
  } catch {
    return { prev: null, next: null };
  }
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

async function readJsonBody(req) {
  const buf = await readBody(req, 1024 * 1024);
  return JSON.parse(buf.toString());
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${HOST}`);

  if (u.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end('{"ok":true}');
  }

  if (!authOk(req)) return send401(res);

  if (u.pathname === '/__upload/init' && req.method === 'POST') {
    return handleUploadInit(req, res);
  }

  if (u.pathname === '/__upload/complete' && req.method === 'POST') {
    return handleUploadComplete(req, res);
  }

  const chunkMatch = /^\/__upload\/chunk\/([a-f0-9]+)\/(\d+)$/.exec(u.pathname);
  if (chunkMatch && req.method === 'PUT') {
    return handleUploadChunk(req, res, chunkMatch[1], chunkMatch[2]);
  }

  if (u.pathname === '/__bulk' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      return handleBulkDownload(req, res, body.paths);
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  const abs = safePath(u.pathname);
  if (!abs) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    return res.end('Forbidden');
  }

  const raw = u.searchParams.has('raw');
  const download = u.searchParams.has('download');
  const isUpload = u.searchParams.has('upload');

  if (req.method === 'PUT' && isUpload) {
    const filename = decodeURIComponent(path.basename(u.pathname));
    const absDir = path.dirname(abs);
    if (!absDir.startsWith(ROOT)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      return res.end('Forbidden');
    }
    return handleStreamUpload(req, res, absDir, filename);
  }

  if (req.method === 'POST') {
    return fs.stat(abs, async (err, st) => {
      if (err || !st.isDirectory()) {
        return sendJson(res, 404, { error: 'Upload folder not found' });
      }
      const webPath = u.pathname.endsWith('/') ? u.pathname : `${u.pathname}/`;
      return handleUpload(req, res, abs, webPath);
    });
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain' });
    return res.end('Method not allowed');
  }

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

    const webDir = u.pathname.replace(/\/[^/]+$/, '') || '/';
    const siblings = siblingNav(path.dirname(abs), path.basename(abs), webDir);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(viewerPage(abs, u.pathname, kind, siblings));
  });
});

server.timeout = 0;
server.keepAliveTimeout = 0;
server.headersTimeout = 0;
if (typeof server.requestTimeout !== 'undefined') server.requestTimeout = 0;

server.listen(PORT, HOST, () => {
  console.log(`Media server http://${HOST}:${PORT} root=${ROOT} maxUpload=${formatSize(MAX_UPLOAD_BYTES)}`);
});
