#!/usr/bin/env node
/**
 * Media library for Termux (127.0.0.1 only).
 * Env: MEDIA_HOST, MEDIA_PORT, MEDIA_ROOT, MEDIA_USER, MEDIA_PASS, MEDIA_MAX_UPLOAD_MB
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const { HOST, PORT, ROOT, PASS, MAX_UPLOAD_BYTES, UPLOAD_TMP } = require('./lib/config');
const { formatSize } = require('./lib/util');
const { authOk, send401 } = require('./lib/auth');
const { safePath, fileKind, siblingNav } = require('./lib/paths');
const {
  handleStreamUpload,
  handleUploadInit,
  handleUploadChunk,
  handleUploadComplete,
  handleUpload,
} = require('./lib/upload');
const { serveFile, serveAsset } = require('./lib/serve');
const { serveTranscoded } = require('./lib/transcode');
const { handleBulkDownload } = require('./lib/bulk');
const { handleSave } = require('./lib/save');
const { sendJson, readJsonBody } = require('./lib/util');
const { listDir } = require('./views/browse');
const { viewerPage } = require('./views/viewer');

if (!PASS) {
  console.error('MEDIA_PASS is required');
  process.exit(1);
}

fs.mkdirSync(ROOT, { recursive: true });
fs.mkdirSync(UPLOAD_TMP, { recursive: true });

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${HOST}`);

  if (u.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end('{"ok":true}');
  }

  if (u.pathname.startsWith('/__assets/')) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'Content-Type': 'text/plain' });
      return res.end('Method not allowed');
    }
    return serveAsset(req, res, u.pathname);
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
  const transcode = u.searchParams.has('transcode');
  const isUpload = u.searchParams.has('upload');
  const isSave = u.searchParams.has('save');

  if (req.method === 'PUT' && isSave) {
    return handleSave(req, res, abs);
  }

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
      listDir(abs, webPath).then((html) => {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
      }).catch((e) => {
        console.error('listDir error:', e);
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Error reading directory');
      });
      return;
    }

    if (transcode) {
      return serveTranscoded(req, res, abs);
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
