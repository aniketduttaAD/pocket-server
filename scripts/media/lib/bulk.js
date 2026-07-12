const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { ROOT } = require('./config');
const { safePath } = require('./paths');
const { sendJson } = require('./util');
const { serveFile } = require('./serve');

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

  // Single file — serve directly with range support + correct headers
  if (files.length === 1) {
    return serveFile(req, res, files[0], true);
  }

  const tmpZip = path.join(os.tmpdir(), `media-bulk-${Date.now()}.zip`);
  // -j: junk paths (flat zip, no directory nesting)
  // -0: no compression for already-compressed media (faster, saves CPU on Termux)
  execFile('zip', ['-j', '-0', tmpZip, ...files], (err) => {
    if (err) {
      return sendJson(res, 501, {
        error: 'zip not available — install: pkg install zip',
        fallback: files.map((f) => `${f.slice(ROOT.length) || '/'}?download=1`),
      });
    }

    fs.stat(tmpZip, (statErr, zipSt) => {
      const headers = {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="media-${files.length}-files.zip"`,
        'Cache-Control': 'no-store',
      };
      // Content-Length lets the browser show accurate download progress
      if (!statErr && zipSt) headers['Content-Length'] = zipSt.size;

      res.writeHead(200, headers);

      const stream = fs.createReadStream(tmpZip);

      const cleanup = (() => {
        let done = false;
        return () => {
          if (done) return;
          done = true;
          fs.unlink(tmpZip, () => {});
        };
      })();

      stream.on('end', cleanup);
      stream.on('error', (e) => { cleanup(); if (!res.headersSent) res.destroy(e); });
      // Client disconnected mid-download — destroy stream and clean up temp file
      req.on('close', () => { stream.destroy(); cleanup(); });

      stream.pipe(res, { end: true });
    });
  });
}

module.exports = { handleBulkDownload };
