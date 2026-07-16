const fs = require('fs');
const path = require('path');
const { PUBLIC_DIR } = require('./config');
const { mimeType } = require('./paths');

const ASSET_MIME = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

function serveFile(req, res, abs, download) {
  fs.stat(abs, (err, st) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }

    const type = mimeType(abs);
    const filename = path.basename(abs);
    const etag = `"${st.size}-${Math.floor(st.mtimeMs)}"`;
    const lastMod = new Date(st.mtimeMs).toUTCString();

    // Conditional request: return 304 if client has current version
    if (req.headers['if-none-match'] === etag ||
        req.headers['if-modified-since'] === lastMod) {
      res.writeHead(304);
      return res.end();
    }

    const headers = {
      'Content-Type': type,
      'Accept-Ranges': 'bytes',
      'ETag': etag,
      'Last-Modified': lastMod,
      'Cache-Control': type.startsWith('image/') ? 'public, max-age=3600, stale-while-revalidate=300' : 'no-store',
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

function serveAsset(req, res, assetPath) {
  const rel = assetPath.split('?')[0].replace(/^\/__assets\//, '').replace(/\.\./g, '');
  const abs = path.join(PUBLIC_DIR, rel);
  if (!abs.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    return res.end('Forbidden');
  }

  fs.stat(abs, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }

    const ext = path.extname(abs).toLowerCase();
    const type = ASSET_MIME[ext] || mimeType(abs);
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': st.size,
      'Cache-Control': 'public, max-age=604800, immutable',
    });
    fs.createReadStream(abs).pipe(res);
  });
}

module.exports = { serveFile, serveAsset };
