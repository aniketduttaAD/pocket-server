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

module.exports = { handleBulkDownload };
